/**
 * 网页文章剪藏：抓取文章页（公众号或普通网页）→ 原生 DOMParser 提取正文并转 Markdown → 存为笔记。
 * 不依赖 defuddle/linkedom 等重型库（约 3.8MB），公众号走固定容器精确提取，
 * 其他网站走常见语义容器启发式；HTML→Markdown 为内置的轻量序列化器。
 * 图片可选下载到本地附件目录。
 */

import type { App, TFile } from "obsidian";
import { normalizePath } from "obsidian";
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

interface ExtractedArticle {
	title: string;
	/** HTML→Markdown 后的正文。 */
	content: string;
	wordCount: number;
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
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => safeFromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(Number.parseInt(dec, 10)))
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

/** 从 body 移除可执行/嵌入类元素；head 不动（meta 供元数据提取）。 */
const STRIP_ELEMENTS_SELECTOR = "script,style,iframe,frame,object,embed,noscript,link,meta[http-equiv]";
/** 可能携带脚本 URL 的属性。 */
const URL_ATTRS = new Set(["href", "src", "xlink:href"]);

/**
 * 就地净化 body 子树：移除危险元素、on* 事件属性与 javascript: URL。
 * DOMParser 是内存文档，不进入渲染树，这里只做输出前的基本净化。
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
 * （1px 图 / data:URI）；不预处理会把正文图片整批丢掉。
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
 * 全部与正文无关，在任何提取发生前无条件物理移除。
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

/** 通用网页正文容器的常见语义选择器，按优先级尝试。 */
const GENERIC_CONTENT_SELECTORS = [
	"article",
	"main",
	"[role=main]",
	".post-content",
	".entry-content",
	".article-content",
	".article-body",
	"#article",
	"#content",
	".markdown-body",
	".topic-content",
	"#main",
];

/** 元素直接持有的纯文本长度（含子元素，不含子孙块的空白）。 */
function textLength(el: Element): number {
	return (el.textContent ?? "").replace(/\s+/g, "").length;
}

/**
 * 通用网页正文定位：按优先级找语义容器，取文本量达标的第一个；
 * 全部落空时取文本量最大的候选，最后兜底 body。
 */
function findGenericContent(body: Element): Element {
	const candidates: Element[] = [];
	for (const selector of GENERIC_CONTENT_SELECTORS) {
		for (const el of body.querySelectorAll(selector)) {
			candidates.push(el);
		}
	}
	let best: Element | null = null;
	let bestLen = 0;
	for (const el of candidates) {
		const len = textLength(el);
		if (len >= 200) {
			return el; // 语义容器 + 足够文本，直接采用（选择器本身即优先级）
		}
		if (len > bestLen) {
			best = el;
			bestLen = len;
		}
	}
	if (best && bestLen >= 100) {
		return best;
	}
	return body;
}

/** 标题：og:title → 公众号 #activity-name → <title>。 */
function extractTitle(doc: Document): string {
	const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
	if (og?.trim()) {
		return og.trim();
	}
	const activity = doc.querySelector("#activity-name")?.textContent?.trim();
	if (activity) {
		return activity;
	}
	return doc.title?.trim() ?? "";
}

/**
 * 提取正文：公众号固定容器优先（结构稳定、几乎 100% 准确），
 * 容器缺失或内容过短（空壳变体）时回退通用启发式。
 */
function extractContent(doc: Document): { root: Element; isWechat: boolean } {
	const pinned = doc.querySelector("#js_content, .rich_media_content");
	if (pinned && textLength(pinned) >= 20) {
		return { root: pinned, isWechat: true };
	}
	return { root: findGenericContent(doc.body), isWechat: false };
}

/* ---------------------------------------------------------------------------
 * HTML → Markdown 轻量序列化器
 * ------------------------------------------------------------------------- */

const SKIP_TAGS = new Set([
	"script", "style", "iframe", "frame", "object", "embed", "noscript",
	"form", "input", "button", "select", "textarea", "svg", "canvas", "audio", "video", "nav", "aside", "footer", "header",
]);

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** 行内文本：压缩空白。中文之间不需要空格，保留必要分隔。 */
function inlineText(node: Node): string {
	let out = "";
	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			out += (child.textContent ?? "").replace(/\s+/g, " ");
		} else if (child.nodeType === Node.ELEMENT_NODE) {
			out += inlineElement(child as Element);
		}
	}
	return out;
}

function inlineElement(el: Element): string {
	const tag = el.tagName.toLowerCase();
	if (SKIP_TAGS.has(tag)) {
		return "";
	}
	switch (tag) {
		case "br":
			return "\n";
		case "strong":
		case "b": {
			const inner = inlineText(el).trim();
			return inner ? `**${inner}**` : "";
		}
		case "em":
		case "i": {
			const inner = inlineText(el).trim();
			return inner ? `*${inner}*` : "";
		}
		case "del":
		case "s": {
			const inner = inlineText(el).trim();
			return inner ? `~~${inner}~~` : "";
		}
		case "code": {
			const text = (el.textContent ?? "").trim();
			return text ? (text.includes("`") ? `\`\`${text}\`\`` : `\`${text}\``) : "";
		}
		case "a": {
			const href = (el.getAttribute("href") ?? "").trim();
			const text = inlineText(el).trim();
			if (!/^https?:\/\//i.test(href)) {
				return text;
			}
			return text ? `[${text}](${href})` : "";
		}
		case "img": {
			const src = (el.getAttribute("src") ?? el.getAttribute("data-src") ?? "").trim();
			if (!/^https?:\/\//i.test(src)) {
				return "";
			}
			const alt = (el.getAttribute("alt") ?? "").trim() || "图片";
			return `\n\n![${alt}](${src})\n\n`;
		}
		default:
			return inlineText(el);
	}
}

/** 渲染一个元素为若干个 Markdown 块（块间以空行分隔）。 */
function renderBlocks(el: Element, depth = 0): string {
	const parts: string[] = [];
	for (const child of Array.from(el.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = (child.textContent ?? "").replace(/\s+/g, " ").trim();
			if (text) {
				parts.push(text);
			}
			continue;
		}
		if (child.nodeType !== Node.ELEMENT_NODE) {
			continue;
		}
		const node = child as Element;
		const tag = node.tagName.toLowerCase();
		if (SKIP_TAGS.has(tag)) {
			continue;
		}
		if (HEADING_TAGS.has(tag)) {
			const level = Math.min(Number(tag[1]), 6);
			parts.push(`${"#".repeat(level)} ${inlineText(node).trim()}`);
		} else if (tag === "p") {
			const text = inlineText(node).trim();
			if (text) {
				parts.push(text);
			}
		} else if (tag === "pre") {
			const code = (node.textContent ?? "").replace(/\s+$/, "");
			parts.push("```\n" + code + "\n```");
		} else if (tag === "blockquote") {
			const inner = renderBlocks(node, depth + 1).trim();
			if (inner) {
				parts.push(inner.split("\n").map((line) => `> ${line}`.trim()).join("\n"));
			}
		} else if (tag === "hr") {
			parts.push("---");
		} else if (tag === "ul" || tag === "ol") {
			parts.push(renderList(node, tag === "ol", 1));
		} else if (tag === "table") {
			const table = renderTable(node);
			if (table) {
				parts.push(table);
			}
		} else if (tag === "img") {
			// 图片可能是容器的直接子节点（微信常用 <section><img></section>），
			// 不在此处理会被容器递归分支静默丢弃
			const img = inlineElement(node).trim();
			if (img) {
				parts.push(img);
			}
		} else if (tag === "figure") {
			const img = node.querySelector("img");
			const caption = node.querySelector("figcaption")?.textContent?.trim();
			let block = img ? inlineElement(img).trim() : "";
			if (caption) {
				block += (block ? "\n\n" : "") + `*${caption}*`;
			}
			if (block) {
				parts.push(block);
			}
		} else {
			// div/section/article 等容器：递归展开子块
			const inner = renderBlocks(node, depth + 1).trim();
			if (inner) {
				parts.push(inner);
			}
		}
	}
	return parts.filter(Boolean).join("\n\n");
}

function renderList(list: Element, ordered: boolean, startNumber: number): string {
	const lines: string[] = [];
	let index = startNumber;
	for (const item of Array.from(list.children)) {
		const tag = item.tagName.toLowerCase();
		if (tag === "li") {
			const marker = ordered ? `${index}. ` : "- ";
			index += 1;
			// li 内部可能有嵌套列表：先剥离子列表再取行内内容
			const nested: string[] = [];
			for (const sub of Array.from(item.children)) {
				const subTag = sub.tagName.toLowerCase();
				if (subTag === "ul" || subTag === "ol") {
					nested.push(renderList(sub, subTag === "ol", 1));
					sub.remove();
				}
			}
			const content = inlineText(item).trim().replace(/\n+/g, " ");
			lines.push(marker + content);
			for (const nestedBlock of nested) {
				lines.push(nestedBlock.split("\n").map((line) => `  ${line}`).join("\n"));
			}
		} else if (tag === "ul" || tag === "ol") {
			lines.push(renderList(item, tag === "ol", 1));
		}
	}
	return lines.join("\n");
}

function renderTable(table: Element): string {
	const rows: string[][] = [];
	for (const tr of Array.from(table.querySelectorAll("tr"))) {
		const cells = Array.from(tr.querySelectorAll("th,td")).map(
			(cell) => inlineText(cell).trim().replace(/\|/g, "\\|"),
		);
		if (cells.length) {
			rows.push(cells);
		}
	}
	if (!rows.length) {
		return "";
	}
	// 简化处理：不做列宽对齐，仅保证列数一致
	const normalized = rows.map((row) => `| ${row.join(" | ")} |`);
	const headerSep = `|${Array.from({ length: Math.max(rows[0]?.length ?? 1, 1) }, () => " --- ").join("|")}|`;
	return [normalized[0], headerSep, ...normalized.slice(1)].join("\n");
}

/** 把正文 DOM 转为 Markdown，并做基础的噪声清理。 */
function domToMarkdown(root: Element): string {
	let markdown = renderBlocks(root);
	// 压缩 3 个以上连续空行为 2 个；去掉每行首尾多余空白
	markdown = markdown
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return markdown;
}

/** 归一化标题文本（忽略空白、标点与 markdown 标记），用于重复判断。 */
function normalizeTitleText(input: string): string {
	return input.replace(/[\s#*_[\]()`「」『』“”"'’‘:：,，。!！?？·—–-]/g, "").toLowerCase();
}

/**
 * 去掉正文开头与文章标题重复的标题行：剪藏模板自身会写入 `# 标题`，
 * 部分页面会把 H1 一并捞进正文，导致笔记出现两个相同标题。
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

/**
 * DOMParser 解析前的预瘦身：微信文章页可达数 MB，其中绝大部分是内嵌
 * script/style；直接把超大 HTML 喂给 DOMParser 会崩掉渲染进程（实测白屏）。
 * 用正则先剥离 script/style/noscript/注释，正文 DOM 不受影响。
 */
function preCleanHtml(html: string): string {
	return html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
		.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, "")
		.replace(/<!--[\s\S]*?-->/g, "");
}

/** 抓取、净化并用原生 DOMParser 提取正文。 */
function extractArticle(html: string): ExtractedArticle {
	const cleaned = preCleanHtml(html);
	console.log("[wechat][clip] DOMParser start", html.length, "->", cleaned.length);
	const doc = new DOMParser().parseFromString(cleaned, "text/html");
	console.log("[wechat][clip] DOMParser done");
	sanitizeBody(doc.body);
	console.log("[wechat][clip] sanitize done");
	stripWechatFurniture(doc.body);
	resolveLazyImages(doc.body);
	console.log("[wechat][clip] furniture/lazy done");

	const title = extractTitle(doc);
	const { root } = extractContent(doc);
	console.log("[wechat][clip] content root:", root.tagName, textLength(root));
	const content = domToMarkdown(root);
	console.log("[wechat][clip] markdown done", content.length);
	return {
		title,
		content,
		wordCount: content.replace(/\s+/g, "").length,
	};
}

/** 抓取并保存文章（公众号或普通网页），返回保存结果。 */
export async function clipWechatArticle(url: string, ctx: ClipContext): Promise<ClipResult> {
	console.log("[wechat][clip] fetch start", url);
	const { status, text } = await httpGetText(url, {
		timeoutMs: 30_000,
		followRedirects: 5,
		headers: ARTICLE_FETCH_HEADERS,
	});
	console.log("[wechat][clip] fetch done", status, text.length);
	if (status < 200 || status >= 400 || !text) {
		throw new Error(`文章页请求失败 (HTTP ${status})`);
	}
	// 微信风控验证页：提前报错，避免把「环境异常」存成垃圾笔记
	if (/环境异常|完成验证后即可继续访问/.test(text)) {
		throw new Error("微信拦截了本次访问（环境异常），请稍后重试，或先在手机微信中打开该文章");
	}

	const result = extractArticle(text);
	console.log("[wechat][clip] extract done", result.title, result.wordCount);
	const title = result.title.trim() || "未命名文章";
	const author = extractAuthor(text);
	const publishTime = extractPublishTime(text);

	let markdown = result.content;
	if (markdown.replace(/\s/g, "").length < 20) {
		throw new Error("未找到文章正文（页面结构可能已变更或需要验证）");
	}
	// 模板会写入 `# 标题`，剥掉捞进正文的重复标题行
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
	console.log("[wechat][clip] creating note", targetPath);
	const file = await ctx.app.vault.create(targetPath, note);
	console.log("[wechat][clip] note created");
	return { file, title, author, publishTime, imageCount };
}
