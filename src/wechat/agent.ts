/**
 * 消息代理：意图识别（帮助 / 撤回 / 公众号剪藏 / 普通记录）→ memo 写入 → 生成回执文本。
 * 回执由编排器（wechatPlugin）负责发送。
 */

import { TFile } from "obsidian";
import type MemosViewPlugin from "../main";
import { isZhLocale } from "../i18n";
import { clipWechatArticle } from "./articleClipper";
import { handleMediaItem } from "./media";
import { MessageItemType, MessageType, MessageState } from "./types";
import type { MessageItem, WechatSettings, WeixinMessage } from "./types";

const URL_RE = /https?:\/\/\S+/i;
const PURE_LINK_RE = /^https?:\/\/\S+$/i;
const HELP_RE = /^(?:帮助|help|\/help|指令|在吗\??|你好|hi|hello)[!！。.]*$/i;
const UNDO_RE = /^(?:撤回|撤销|删除上一条|undo|\/undo)[!！。.]*$/i;

export interface WechatAgentContext {
	plugin: MemosViewPlugin;
	wechat: WechatSettings;
}

function tr(zh: string, en: string): string {
	return isZhLocale() ? zh : en;
}

/** 转义用户配置的触发词，避免按正则解释其字符。 */
function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class WechatAgent {
	/** 最近一次写入的 memo（供「撤回」定位）。 */
	private lastMemo: { filePath: string; payload: string } | null = null;

	constructor(private ctx: WechatAgentContext) {}

	/** 处理一条入站消息，返回回执文本（null 表示无需回复）。 */
	async handle(msg: WeixinMessage): Promise<string | null> {
		if (msg.message_type !== undefined && msg.message_type !== MessageType.USER) {
			return null;
		}
		if (msg.message_state !== undefined && msg.message_state !== MessageState.FINISH) {
			return null;
		}
		const items = msg.item_list ?? [];
		if (!items.length) {
			return null;
		}

		const messageTime = msg.create_time_ms ? new Date(msg.create_time_ms) : new Date();
		const timestamp = this.ctx.wechat.useMessageTime ? messageTime : undefined;

		const text = items
			.filter((item) => item.type === MessageItemType.TEXT)
			.map((item) => item.text_item?.text?.trim() ?? "")
			.filter(Boolean)
			.join("\n")
			.trim();

		if (text && HELP_RE.test(text)) {
			return this.helpReply();
		}
		if (text && UNDO_RE.test(text)) {
			return this.undo();
		}

		// 纯链接：直接剪藏（公众号或普通网页），可由设置关闭
		if (text && this.ctx.wechat.autoClipPureLink && PURE_LINK_RE.test(text)) {
			return this.handleArticle(text, "", timestamp);
		}

		// 剪藏：消息中同时包含触发词和网页链接（如「剪藏 https://…」）直接剪藏
		const keyword = this.clipKeyword();
		if (text && text.toLowerCase().includes(keyword.toLowerCase())) {
			const url = text.match(URL_RE)?.[0];
			if (url) {
				const remainder = text
					.replace(url, "")
					.replace(new RegExp(escapeRegExp(keyword), "gi"), "")
					.replace(/\s+/g, " ")
					.trim();
				return this.handleArticle(url, remainder, timestamp);
			}
			// 只发了触发词没带链接：提示用法，不写入 memo
			if (new RegExp(`^${escapeRegExp(keyword)}[!！。.\\s]*$`, "i").test(text)) {
				return tr(
					`请把触发词和链接一起发送，如「${keyword} https://…」`,
					`Send the trigger word together with a link, e.g. "${keyword} https://…"`,
				);
			}
		}

		return this.handleContent(items, text, messageTime, timestamp);
	}

	private clipKeyword(): string {
		return this.ctx.wechat.clipConfirmKeyword.trim() || "剪藏";
	}

	private helpReply(): string {
		const keyword = this.clipKeyword();
		const pureLink = this.ctx.wechat.autoClipPureLink;
		return tr(
			[
				"我是你的 Obsidian Memos 助手：",
			"· 发送文字 / 图片 / 语音 / 文件 → 记录为 memo",
			`· 发送「${keyword} + 链接」${pureLink ? "或纯链接" : ""} → 剪藏全文`,
			"· 回复「撤回」→ 删除上一条记录",
			"· 回复「帮助」→ 查看本说明",
		].join("\n"),
		[
			"I am your Obsidian Memos assistant:",
			"· Send text / image / voice / file → saved as a memo",
			`· Send "${keyword} + link"${pureLink ? " (or just a link)" : ""} → clip the full article`,
			"· Reply \"undo\" → remove the last memo",
			"· Reply \"help\" → show this message",
		].join("\n"),
		);
	}

	/** 普通内容：文本 + 媒体合并写入同一条 memo。 */
	private async handleContent(
		items: MessageItem[],
		text: string,
		messageTime: Date,
		timestamp: Date | undefined,
	): Promise<string | null> {
		const { plugin, wechat } = this.ctx;
		const mediaCtx = {
			app: plugin.app,
			attachmentFolder: wechat.attachmentFolder,
			embedStyle: plugin.settings.imageEmbedStyle,
			sourcePath: "",
		};

		const parts: string[] = [];
		if (text) {
			parts.push(text);
		}

		let mediaFailures = 0;
		for (const item of items) {
			if (item.type === MessageItemType.TEXT || item.type === undefined) {
				continue;
			}
			let skipMedia = false;
			if (item.type === MessageItemType.VOICE) {
				const transcription = item.voice_item?.text?.trim();
				if (transcription) {
					parts.push(transcription);
					// 关闭「保存语音原声」且有转写文字：只记文字，不落盘原声
					skipMedia = !wechat.saveVoiceAudio;
				}
			}
			if (skipMedia) {
				continue;
			}
			const saved = await handleMediaItem(item, messageTime, mediaCtx);
			if (saved) {
				parts.push(saved.embedLink.trim());
			} else {
				mediaFailures += 1;
			}
		}

		const content = parts.join("\n\n").trim();
		if (!content) {
			return mediaFailures > 0
				? tr("附件下载失败，请稍后重试", "Failed to download the attachment, please try again later")
				: null;
		}

		const result = await plugin.appendMemoToToday(content, { refresh: true, timestamp });
		if (!result) {
			return tr("记录失败，请查看控制台日志", "Failed to save the memo, check the console for details");
		}
		this.lastMemo = result;
		if (mediaFailures > 0) {
			return tr(`已记录（${mediaFailures} 个附件保存失败）`, `Saved (${mediaFailures} attachment(s) failed)`);
		}
		return tr("已记录 ✅", "Saved ✅");
	}

	/** 网页文章：剪藏为独立笔记，并在 memo 中留一条链接（remainder 为去除链接与触发词后的附言）。 */
	private async handleArticle(
		url: string,
		remainder: string,
		timestamp: Date | undefined,
	): Promise<string> {
		const { plugin, wechat } = this.ctx;
		try {
			const clip = await clipWechatArticle(url, {
				app: plugin.app,
				articleFolder: wechat.articleFolder,
				attachmentFolder: wechat.attachmentFolder,
				localiseImages: wechat.localiseArticleImages,
			});
			const link = `[[${clip.file.basename}|${clip.title}]]`;
			const memoContent = remainder ? `${remainder}\n\n${link}` : link;
			const result = await plugin.appendMemoToToday(memoContent, { refresh: true, timestamp });
			if (result) {
				this.lastMemo = result;
				return tr(`已剪藏《${clip.title}》`, `Clipped "${clip.title}"`);
			}
			return tr(
				`文章已保存为《${clip.title}》，但 memo 写入失败`,
				`Article saved as "${clip.title}", but the memo entry failed`,
			);
		} catch (err) {
			console.error("[wechat] clip article failed:", err);
			const reason = err instanceof Error ? err.message : String(err);
			return tr(`剪藏失败：${reason}`, `Clip failed: ${reason}`);
		}
	}

	/** 撤回最近一条由微信写入的 memo。 */
	private async undo(): Promise<string> {
		const { plugin } = this.ctx;
		const last = this.lastMemo;
		if (!last) {
			return tr("没有可撤回的记录", "Nothing to undo");
		}
		const file = plugin.app.vault.getAbstractFileByPath(last.filePath);
		if (!(file instanceof TFile)) {
			this.lastMemo = null;
			return tr("没有可撤回的记录", "Nothing to undo");
		}
		try {
			const raw = await plugin.app.vault.cachedRead(file);
			if (!raw.includes(last.payload)) {
				this.lastMemo = null;
				return tr("该记录已被修改，无法撤回", "The memo was modified, cannot undo");
			}
			const next = raw.replace(last.payload, "").replace(/\n{3,}/g, "\n\n");
			plugin.suppressVaultRefresh(file.path);
			await plugin.app.vault.modify(file, next);
			this.lastMemo = null;
			await plugin.refreshAllMemosViews();
			return tr("已撤回上一条记录", "The last memo was removed");
		} catch (err) {
			console.error("[wechat] undo failed:", err);
			return tr("撤回失败", "Undo failed");
		}
	}
}
