/**
 * 入站媒体处理：CDN 下载 → AES-128-ECB 解密 → 保存到 vault 附件目录。
 */

import type { App, TFile } from "obsidian";
import { normalizePath, TFile as TFileClass } from "obsidian";
import { aesEcbDecrypt, parseAesKey } from "./crypto";
import { httpGetBuffer } from "./http";
import { CDN_BASE_URL } from "./ilink";
import { silkToWav } from "./silk";
import { MessageItemType } from "./types";
import type { MessageItem } from "./types";
import { buildAttachmentEmbedLink } from "../utils/embed";

const MEDIA_MAX_BYTES = 100 * 1024 * 1024;

/** voice_item.encode_type：5=amr（罕见，无法播放仅留存）。 */
const VOICE_ENCODE_AMR = 5;
/** voice_item.encode_type：7=mp3（可直接播放）。 */
const VOICE_ENCODE_MP3 = 7;

export interface SavedMedia {
	file: TFile;
	embedLink: string;
}

function buildCdnUrl(encryptedQueryParam: string): string {
	return `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

/** 按魔数识别图片扩展名。 */
export function detectImageExt(buf: Buffer): string {
	if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		return "png";
	}
	if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
		return "jpg";
	}
	if (buf.length >= 6 && buf.subarray(0, 3).toString("ascii") === "GIF") {
		return "gif";
	}
	if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
		return "webp";
	}
	return "png";
}

function sanitizeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, "_").trim() || "file";
}

function formatStamp(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** 在指定目录（或库默认附件位置）落盘二进制附件，返回 TFile。 */
export async function saveBinaryAttachment(
	app: App,
	fileName: string,
	data: ArrayBuffer | Buffer,
	folderOverride: string,
): Promise<TFile> {
	if (data.byteLength > MEDIA_MAX_BYTES) {
		throw new Error(`附件超过 100MB 限制: ${fileName}`);
	}

	const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
	let targetPath = "";
	const folder = folderOverride.trim();
	if (folder) {
		await app.vault.createFolder(normalizePath(folder)).catch(() => undefined);
		targetPath = normalizePath(`${folder}/${fileName}`);
	} else {
		// 优先走 Obsidian 附件位置设置
		const vaultAny = app.vault as unknown as {
			getAvailablePathForAttachments?: (base: string, ext: string) => Promise<string>;
		};
		if (typeof vaultAny.getAvailablePathForAttachments === "function") {
			const dot = fileName.lastIndexOf(".");
			const base = dot > 0 ? fileName.slice(0, dot) : fileName;
			const ext = dot > 0 ? fileName.slice(dot + 1) : "bin";
			targetPath = await vaultAny.getAvailablePathForAttachments(base, ext);
		} else {
			targetPath = normalizePath(fileName);
		}
	}

	// 同名去重
	if (app.vault.getAbstractFileByPath(targetPath)) {
		const dot = targetPath.lastIndexOf(".");
		const base = dot > 0 ? targetPath.slice(0, dot) : targetPath;
		const ext = dot > 0 ? targetPath.slice(dot) : "";
		let n = 1;
		while (app.vault.getAbstractFileByPath(`${base}-${n}${ext}`)) {
			n += 1;
		}
		targetPath = `${base}-${n}${ext}`;
	}

	// createBinary 要求 ArrayBuffer；Buffer 可能指向共享池，必须复制独立副本
	const arrayBuffer = buffer.buffer.slice(
		buffer.byteOffset,
		buffer.byteOffset + buffer.byteLength,
	) as ArrayBuffer;
	return app.vault.createBinary(targetPath, arrayBuffer);
}

/** 下载并解密 CDN 媒体，返回明文 Buffer。 */
async function downloadDecrypted(
	encryptQueryParam: string,
	aesKeyBase64: string | undefined,
	fullUrl: string | undefined,
	label: string,
): Promise<Buffer> {
	const url = fullUrl ?? buildCdnUrl(encryptQueryParam);
	const encrypted = await httpGetBuffer(url, { timeoutMs: 60_000, followRedirects: 5 });
	if (!aesKeyBase64) {
		return encrypted;
	}
	const key = parseAesKey(aesKeyBase64, label);
	return aesEcbDecrypt(encrypted, key);
}

export interface MediaHandlerContext {
	app: App;
	attachmentFolder: string;
	/** 附件嵌入风格，与插件设置一致。 */
	embedStyle: "wikilink" | "markdown";
	/** memo 所在文件（用于计算相对路径）。 */
	sourcePath: string;
}

/**
 * 处理单个媒体 item：下载解密并保存，返回可用于 memo 正文的嵌入链接。
 * 任何失败都返回 null（不阻断其他消息处理）。
 */
export async function handleMediaItem(
	item: MessageItem,
	messageTime: Date,
	ctx: MediaHandlerContext,
): Promise<SavedMedia | null> {
	try {
		if (item.type === MessageItemType.IMAGE) {
			const img = item.image_item;
			if (!img?.media || (!img.media.encrypt_query_param && !img.media.full_url)) {
				return null;
			}
			// image_item.aeskey 是 hex 字符串，优先于 media.aes_key
			const aesKeyBase64 = img.aeskey
				? Buffer.from(img.aeskey, "hex").toString("base64")
				: img.media.aes_key;
			const buf = await downloadDecrypted(
				img.media.encrypt_query_param ?? "",
				aesKeyBase64,
				img.media.full_url,
				"image",
			);
			const name = `WeChat-${formatStamp(messageTime)}.${detectImageExt(buf)}`;
			const file = await saveBinaryAttachment(ctx.app, name, buf, ctx.attachmentFolder);
			return { file, embedLink: buildAttachmentEmbedLink(file, ctx.sourcePath, ctx.embedStyle).trim() };
		}

		if (item.type === MessageItemType.VOICE) {
			const voice = item.voice_item;
			if (!voice?.media || (!voice.media.encrypt_query_param && !voice.media.full_url)) {
				return null;
			}
			const buf = await downloadDecrypted(
				voice.media.encrypt_query_param ?? "",
				voice.media.aes_key,
				voice.media.full_url,
				"voice",
			);
			// 按编码分派：mp3 可直接播放；silk（主流）转码 WAV；
			// 转码失败或 amr 等罕见格式回退保留原始附件
			const stamp = formatStamp(messageTime);
			let name: string;
			let data: Buffer = buf;
			if (voice.encode_type === VOICE_ENCODE_MP3) {
				name = `WeChat-${stamp}.mp3`;
			} else if (voice.encode_type !== VOICE_ENCODE_AMR) {
				const wav = await silkToWav(buf);
				if (wav) {
					name = `WeChat-${stamp}.wav`;
					data = wav;
				} else {
					name = `WeChat-${stamp}.silk`;
				}
			} else {
				name = `WeChat-${stamp}.amr`;
			}
			const file = await saveBinaryAttachment(ctx.app, name, data, ctx.attachmentFolder);
			return { file, embedLink: buildAttachmentEmbedLink(file, ctx.sourcePath, ctx.embedStyle).trim() };
		}

		if (item.type === MessageItemType.FILE) {
			const fileItem = item.file_item;
			if (!fileItem?.media || (!fileItem.media.encrypt_query_param && !fileItem.media.full_url)) {
				return null;
			}
			const buf = await downloadDecrypted(
				fileItem.media.encrypt_query_param ?? "",
				fileItem.media.aes_key,
				fileItem.media.full_url,
				"file",
			);
			const rawName = sanitizeFileName(fileItem.file_name ?? "");
			const name = rawName ? `WeChat-${formatStamp(messageTime)}-${rawName}` : `WeChat-${formatStamp(messageTime)}.bin`;
			const file = await saveBinaryAttachment(ctx.app, name, buf, ctx.attachmentFolder);
			return { file, embedLink: `[[${file.path}|${file.basename || file.name}]]` };
		}

		if (item.type === MessageItemType.VIDEO) {
			const video = item.video_item;
			if (!video?.media || (!video.media.encrypt_query_param && !video.media.full_url)) {
				return null;
			}
			const buf = await downloadDecrypted(
				video.media.encrypt_query_param ?? "",
				video.media.aes_key,
				video.media.full_url,
				"video",
			);
			const name = `WeChat-${formatStamp(messageTime)}.mp4`;
			const file = await saveBinaryAttachment(ctx.app, name, buf, ctx.attachmentFolder);
			return { file, embedLink: buildAttachmentEmbedLink(file, ctx.sourcePath, ctx.embedStyle).trim() };
		}

		return null;
	} catch (err) {
		console.error("[wechat] media download failed:", err);
		return null;
	}
}

export { TFileClass };
