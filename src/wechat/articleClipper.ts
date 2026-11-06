/**
 * 网页文章剪藏：抓取文章页（公众号或普通网页）→ defuddle 提取正文并转 Markdown → 存为笔记。
 * 图片可选下载到本地附件目录。
 */

import type { App, TFile } from "obsidian";
import { normalizePath } from "obsidian";
import { parseHTML } from "linkedom";
import { Defuddle, type DefuddleResponse } from "defuddle/node";
import { httpGetBuffer, httpGetText } from "./http";
import { detectImageExt, saveBinaryAttachment } from "./media";

const MAX_ARTICLE_IMAGES = 50;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;

/** 图片下载用的请求头：无 UA 会被图床（尤其 mmbiz.qpic.cn）拒绝，导致全部下载失败。 */
const IMAGE_DOWNLOAD_HEADERS: Record<string, string> = {
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
	Accept: "image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5",
};

/** 按图床域名构造下载请求头：微信图床要求微信域 Referer（或不发送 Referer）。 */
function imageDownloadHeaders(url: string): Record<string, string> {
	if (/(^|\.)mmbiz\.qpic\.cn$/i.test(new URL(url).hostname)) {
		return { ...IMAGE_DOWNLOAD_HEADERS, Referer: "https://mp.weixin.qq.com/" };
	}
	return IMAGE_DOWNLOAD_HEADERS;
}

/** 下载内容是否为已知图片格式（防止把图床 200 返回的 HTML 错误页存成假图片）。 */
function isImageBuffer(buf: Buffer): boolean {
	if (buf.length < 12) {
		return false;
	}
	const head4 = buf.subarray(0, 4).toString("latin1");
	return (
		buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || // PNG
		(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) || // JPEG
		head4 === "GIF8" || // GIF
		(head4 === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") || // WebP
		head4 === "BM" || // BMP
		buf.subarray(4, 8).toString("latin1") === "ftyp" // ISO BMFF（AVIF/HEIC）
	);
}

/** 文章页抓取用的浏览器请求头：无 UA 会被微信风控判定为异常环境，返回验证页。 */
const ARTICLE_FETCH_HEADERS: Record<string, string> = {
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
	Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
	"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

export interface ClipContext {
	app: App;
	/** 文章笔记保存目录。 */
	articleFolder: string;
	/** 图片本地化时的附件目录；空 = 库默认附件位置。 */
	attachmentFolder: string;
	localiseImages: boolean;
}

export interface ClipResult {
	file: TFile;
	title: string;
	author: string;
	publishTime: string | null;
	imageCount: number;
}

const NAMED_ENTITIES: Record<string, string> = {
	nbsp: " ",
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	"#39": "'",
	hellip: "…",
	mdash: "—",
	ndash: "–",
	ldquo: "\u201c",
	rdquo: "\u201d",
	lsquo: "\u2018",
	rsquo: "\u2019",
	middot: "·",
	brvbar: "¦",
	ensp: " ",
	emsp: " ",
};

function decodeEntities(input: string): string {
	return input
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeFromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(Number.parseInt(dec, 10)))
		.replace(/&([a-zA-Z]+|#39);/g, (full, name: string) => NAMED_ENTITIES[name] ?? full);
}

function safeFromCodePoint(code: number): string {
	try {
		return String.fromCodePoint(code);
	} catch {
		return "";
	}
}

function extractAttr(tag: string, name: string): string | null {
	const match = tag.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
	if (!match) {
		return null;
	}
	return decodeEntities(match[1] ?? match[2] ?? "");
}

/** 公众号作者（#js_name / og:article:author）；通用网页用 og:site_name 兜底。 */
function extractAuthor(html: string): string {
	const og = html.match(/<meta\b[^>]*property=["']og:article:author["'][^>]*>/i)?.[0];
	if (og) {
		const content = extractAttr(og, "content");
		if (content?.trim()) {
			return content.trim();
		}
	}
	const jsName = html.match(/<[^>]*id\s*=\s*["']js_name["'][^>]*>([\s\S]*?)<\//i);
	if (jsName?.[1]) {
		const text = decodeEntities(jsName[1].replace(/<[^>]+>/g, "")).trim();
		if (text) {
			return text;
		}
	}
	const site = html.match(/<meta\b[^>]*property=["']og:site_name["'][^>]*>/i)?.[0];
	if (site) {
		const content = extractAttr(site, "content");
		if (content?.trim()) {
			return content.trim();
		}
	}
	return "";
}

/** 提取并规范化发布时间为 "YYYY-MM-DD HH:mm"；找不到返回 null。 */
function extractPublishTime(html: string): string | null {
	const og = html.match(/<meta\b[^>]*property=["']article:published_time["'][^>]*>/i)?.[0];
	if (og) {
		const content = extractAttr(og, "content");
		if (content) {
			const date = new Date(content);
			if (!Number.isNaN(date.getTime())) {
				return formatDateTime(date);
			}
		}
	}
	const node = html.match(/<[^>]*id\s*=\s*["']publish_time["'][^>]*>([^<]*)</i);
	if (node?.[1]?.trim()) {
		const normalized = normalizeCnDate(node[1].trim());
		if (normalized) {
			return normalized;
		}
	}
	const varTime = html.match(/(?:oriCreateTime|createTime)\s*[:=]\s*["']([^"']+)["']/);
	if (varTime?.[1]) {
		const normalized = normalizeCnDate(varTime[1].trim());
		if (normalized) {
			return normalized;
		}
	}
	return null;
}

function normalizeCnDate(input: string): string | null {
	const m = input.match(
		/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?\s*(\d{1,2})?:?(\d{2})?/,
	);
	if (!m) {
		const iso = new Date(input);
		return Number.isNaN(iso.getTime()) ? null : formatDateTime(iso);
	}
	const pad = (n: string) => n.padStart(2, "0");
	const hh = m[4] ? pad(m[4]) : "00";
	const mm = m[5] ?? "00";
	return `${m[1]!}-${pad(m[2]!)}-${pad(m[3]!)} ${hh}:${mm}`;
}

function formatDateTime(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** ISO 日期（schema.org / meta）→ "YYYY-MM-DD HH:mm"；无效返回 null。 */
function fromIsoDate(value: string): string | null {
	if (!value) {
		return null;
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : formatDateTime(date);
}

/** 从 body 移除可执行/嵌入类元素；head 不动（meta / ld+json 供元数据提取）。 */
const STRIP_ELEMENTS_SELECTOR = "script,style,iframe,frame,object,embed";
/** 可能携带脚本 URL 的属性。 */
const URL_ATTRS = new Set(["href", "src", "xlink:href"]);

/**
 * 就地净化 body 子树：移除危险元素、on* 事件属性与 javascript: URL。
 * DOMPurify 无法绑定 linkedom window（实测静默 no-op），故在内存 DOM 上
 * 自行遍历；配合 defuddle 输出侧的 isDangerousUrl 检查形成双层防御。
 */
function sanitizeBody(body: Element): void {
	for (const el of body.querySelectorAll(STRIP_ELEMENTS_SELECTOR)) {
		el.remove();
	}
	for (const el of body.querySelectorAll("*")) {
		for (const attr of Array.from(el.attributes)) {
			const name = attr.name.toLowerCase();
			if (
				name.startsWith("on") ||
				(URL_ATTRS.has(name) && /^\s*javascript:/i.test(attr.value))
			) {
				el.removeAttribute(attr.name);
			}
		}
	}
}

/**
 * 懒加载图片（微信等站点）的真实 URL 存放在 data-src，src 缺失或为占位符
 * （1px 图 / data:URI）；defuddle 与 turndown 只读 src/srcset，
 * 不预处理会把正文图片整批丢掉。
 */
function resolveLazyImages(root: Element): void {
	for (const img of root.querySelectorAll("img")) {
		let real = (img.getAttribute("data-src") ?? "").trim();
		if (real.startsWith("//")) {
			real = `https:${real}`;
		}
		if (!/^https?:\/\//i.test(real)) {
			continue;
		}
		if (/^https?:\/\//i.test(img.getAttribute("src") ?? "")) {
			continue; // src 已是真实地址
		}
		img.setAttribute("src", real);
		if (!/^https?:\/\//i.test(img.getAttribute("srcset") ?? "")) {
			img.removeAttribute("srcset"); // 占位 srcset 优先级高于 src，需移除
		}
	}
}

/**
 * 微信文章页的固定 UI 部件（小说阅读器入口、二维码、弹窗、底部工具条等），
 * 全部与正文无关。部分页面变体下 defuddle 的自动检测 / 隐藏内容兜底路径
 * 会把它们误判进正文，故在任何提取发生前无条件物理移除。
 */
const WECHAT_FURNITURE_SELECTOR = [
	"#js_novel_card", // 「在小说阅读器读本章」卡片
	"#js_tags_preview_toast", // 「预览时标签不可点」提示
	"#js_pc_qr_code", // 「微信扫一扫 关注该公众号」二维码
	"#js_pc_weapp_code", // 「微信扫一扫 使用小程序」浮层
	"#js_minipro_dialog", // 「取消 / 允许」小程序授权弹窗
	"#js_alert_panel", // 「知道了」系统弹窗
	"#js_temp_bottom_area", // 「不喜欢」底部工具区
	"#content_bottom_area", // 底部留言/菜单区
	"#js_name", // 公众号昵称（页面头部）
	"#profileBt", // 公众号昵称按钮
	"#js_author_name", // 作者行（含 #js_author_name_text 子节点）
	".rich_media_tool_area", // 点赞/在看工具条
	".weui-desktop-popover", // 桌面端浮层（含二维码弹层）
	".outer_dialog", // 通用外层弹窗
	".weui-dialog__wrp", // weui 弹窗容器
].join(", ");

function stripWechatFurniture(root: Element): void {
	for (const el of root.querySelectorAll(WECHAT_FURNITURE_SELECTOR)) {
		el.remove();
	}
}

/**
 * defuddle 提取正文（obsidian-clipper 的核心引擎）。
 * 全程使用 linkedom 的内存 DOM：不触碰渲染进程的真实 document / DOMParser，
 * 避免插件代码干扰 Obsidian 自身的 DOM 与 CSSOM。
 * 公众号正文固定在 #js_content（class 兜底 .rich_media_content）；
 * 根节点命中但内容过短（空壳变体）时回退自动检测；其余网页直接自动检测。
 */
async function extractArticle(html: string, url: string): Promise<DefuddleResponse> {
	const { document } = parseHTML(html);
	sanitizeBody(document.body);
	stripWechatFurniture(document.body);
	resolveLazyImages(document.body);
	if (document.querySelector("#js_content, .rich_media_content")) {
		const pinned = await Defuddle(document, url, {
			markdown: true,
			contentSelector: "#js_content, .rich_media_content",
		});
		if (pinned.content.replace(/\s/g, "").length >= 20) {
			return pinned;
		}
	}
	return Defuddle(document, url, { markdown: true });
}

/** 归一化标题文本（忽略空白、标点与 markdown 标记），用于重复判断。 */
function normalizeTitleText(input: string): string {
	return input.replace(/[\s#*_[\]()`「」『』“”"'’‘:：,，。!！?？·—–-]/g, "").toLowerCase();
}

/**
 * 去掉正文开头与文章标题重复的标题行：剪藏模板自身会写入 `# 标题`，
 * 部分页面变体下 defuddle 又会把页面 H1 一并捞进正文，导致笔记出现两个相同标题。
 */
function dropLeadingTitleHeadings(markdown: string, title: string): string {
	const target = normalizeTitleText(title);
	if (!target) {
		return markdown;
	}
	const lines = markdown.split("\n");
	let i = 0;
	while (i < lines.length) {
		const line = (lines[i] ?? "").trim();
		if (!line) {
			i += 1;
			continue;
		}
		const heading = line.match(/^#{1,6}\s+(.+)$/);
		if (heading && normalizeTitleText(heading[1] ?? "") === target) {
			lines.splice(i, 1);
			continue; // 变体下可能连续重复多个
		}
		break; // 第一个非空行不是重复标题则停止
	}
	return lines.join("\n").replace(/^\s+/, "");
}

/** 把正文里的远程图片下载到本地并替换链接。 */
async function localiseImages(markdown: string, ctx: ClipContext, stamp: string): Promise<{ markdown: string; count: number }> {
	const urlRe = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
	const urls: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = urlRe.exec(markdown)) !== null) {
		const url = match[2];
		if (url && !urls.includes(url)) {
			urls.push(url);
		}
	}
	if (!urls.length) {
		return { markdown, count: 0 };
	}

	let count = 0;
	let next = markdown;
	for (const url of urls.slice(0, MAX_ARTICLE_IMAGES)) {
		try {
			const data = await httpGetBuffer(url, {
				timeoutMs: IMAGE_DOWNLOAD_TIMEOUT_MS,
				followRedirects: 3,
				headers: imageDownloadHeaders(url),
			});
			if (!isImageBuffer(data)) {
				throw new Error(`响应不是图片（${data.length} 字节，可能被图床拦截）`);
			}
			const name = `Article-${stamp}-${count + 1}.${detectImageExt(data)}`;
			const file = await saveBinaryAttachment(ctx.app, name, data, ctx.attachmentFolder);
			const encoded = encodeURI(file.path.replace(/\\/g, "/"));
			next = next.split(`(${url})`).join(`(${encoded})`);
			count += 1;
		} catch (err) {
		console.warn("[wechat] article image download failed:", url, err);
	}
	}
	// 下载失败或超出数量上限的远程图片降级为普通链接：
	// Obsidian 不渲染远程 ![]()（显示为空白），普通链接至少可点击在浏览器查看。
	next = next.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_m, alt: string, url: string) =>
		`[${alt || "图片"}](${url})`,
	);
	return { markdown: next, count };
}

function sanitizeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim();
}

function yamlValue(value: string): string {
	if (/[:#]/.test(value) || value.startsWith("\"") || value.startsWith("'")) {
		return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return value;
}

/** 抓取并保存文章（公众号或普通网页），返回保存结果。 */
export async function clipWechatArticle(url: string, ctx: ClipContext): Promise<ClipResult> {
	const { status, text } = await httpGetText(url, {
		timeoutMs: 30_000,
		followRedirects: 5,
		headers: ARTICLE_FETCH_HEADERS,
	});
	if (status < 200 || status >= 400 || !text) {
		throw new Error(`文章页请求失败 (HTTP ${status})`);
	}
	// 微信风控验证页：提前报错，避免把「环境异常」存成垃圾笔记
	if (/环境异常|完成验证后即可继续访问/.test(text)) {
		throw new Error("微信拦截了本次访问（环境异常），请稍后重试，或先在手机微信中打开该文章");
	}

	const result = await extractArticle(text, url);
	const title = result.title.trim() || "未命名文章";
	const author = result.author.trim() || extractAuthor(text);
	const publishTime = extractPublishTime(text) ?? fromIsoDate(result.published);

	let markdown = result.content.trim();
	if (markdown.replace(/\s/g, "").length < 20) {
		throw new Error("未找到文章正文（页面结构可能已变更或需要验证）");
	}
	// 模板会写入 `# 标题`，剥掉 defuddle 捞进正文的重复标题行
	markdown = dropLeadingTitleHeadings(markdown, title);
	let imageCount = 0;
	if (ctx.localiseImages) {
		const stamp = publishTime?.replace(/[-: ]/g, "").slice(0, 8) ?? formatDateTime(new Date()).replace(/[-: ]/g, "").slice(0, 8);
		const localised = await localiseImages(markdown, ctx, stamp);
		markdown = localised.markdown;
		imageCount = localised.count;
	}

	const dateBase = publishTime?.slice(0, 10) ?? formatDateTime(new Date()).slice(0, 10);
	const safeTitle = sanitizeFileName(title).slice(0, 60) || "未命名文章";
	const folder = ctx.articleFolder.trim();
	if (folder) {
		await ctx.app.vault.createFolder(normalizePath(folder)).catch(() => undefined);
	}

	const baseName = `${dateBase}-${safeTitle}`;
	let targetPath = normalizePath(folder ? `${folder}/${baseName}.md` : `${baseName}.md`);
	if (ctx.app.vault.getAbstractFileByPath(targetPath)) {
		let n = 1;
		while (ctx.app.vault.getAbstractFileByPath(normalizePath(folder ? `${folder}/${baseName}-${n}.md` : `${baseName}-${n}.md`))) {
			n += 1;
		}
		targetPath = normalizePath(folder ? `${folder}/${baseName}-${n}.md` : `${baseName}-${n}.md`);
	}

	const frontmatter = [
		"---",
		`title: ${yamlValue(title)}`,
		author ? `author: ${yamlValue(author)}` : null,
		`source: ${yamlValue(url)}`,
		publishTime ? `published: ${publishTime}` : null,
		result.wordCount > 0 ? `words: ${result.wordCount}` : null,
		`clipped: ${formatDateTime(new Date())}`,
		"---",
		"",
	]
		.filter((line): line is string => line !== null)
		.join("\n");

	const note = `${frontmatter}\n# ${title}\n\n${markdown}\n`;
	const file = await ctx.app.vault.create(targetPath, note);
	return { file, title, author, publishTime, imageCount };
}
