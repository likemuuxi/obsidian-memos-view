/**
 * iLink API 客户端：扫码登录 + 长轮询收消息 + 回发文本消息。
 * 依据官方 MIT 包协议行为实现（JSON over HTTP，纯出站长轮询，无需公网）。
 */

import { HttpTimeoutError, httpGetText, httpPostJson } from "./http";
import { randomClientId, randomWechatUin } from "./crypto";
import type {
	GetUpdatesResp,
	QrCodeResponse,
	QrStatusResponse,
	WeixinMessage,
} from "./types";
import { MessageItemType, MessageState, MessageType } from "./types";

/** 扫码登录固定入口。 */
export const QR_BASE_URL = "https://ilinkai.weixin.qq.com";
/** CDN 下载基址（服务端未返回 full_url 时的回退拼接）。 */
export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
/** 默认 API 基址（登录确认后服务端会返回账号专属 baseurl）。 */
export const DEFAULT_API_BASE_URL = "https://ilinkai.weixin.qq.com";
export const ILINK_APP_ID = "bot";
/** 协议参考版本（对齐官方 openclaw-weixin 包版本），用于 iLink-App-ClientVersion 头编码。 */
export const PROTOCOL_VERSION = "2.4.6";
/** get_bot_qrcode 的 bot_type。 */
export const DEFAULT_ILINK_BOT_TYPE = "3";

/** 长轮询默认超时（客户端）。 */
export const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
/** 普通请求默认超时。 */
export const DEFAULT_API_TIMEOUT_MS = 15_000;
/** QR 状态长轮询超时。 */
export const QR_LONG_POLL_TIMEOUT_MS = 35_000;
/** token 失效错误码 → 暂停会话 1 小时。 */
export const STALE_TOKEN_ERRCODE = -14;
export const SESSION_PAUSE_MS = 60 * 60 * 1000;

/** iLink-App-ClientVersion：major<<16 | minor<<8 | patch。 */
export function buildClientVersion(version: string): number {
	const parts = version.split(".").map((p) => Number.parseInt(p, 10));
	const major = parts[0] ?? 0;
	const minor = parts[1] ?? 0;
	const patch = parts[2] ?? 0;
	return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

export interface ILinkClientOptions {
	/** 账号 API 基址（登录确认后返回）。 */
	baseUrl: string;
	botToken: string;
	/** 插件版本号（manifest version），用于 ClientVersion 头。 */
	clientVersion: string;
}

function commonHeaders(): Record<string, string> {
	return {
		"iLink-App-Id": ILINK_APP_ID,
		"iLink-App-ClientVersion": String(buildClientVersion(PROTOCOL_VERSION)),
	};
}

function authHeaders(options: ILinkClientOptions): Record<string, string> {
	return {
		"Content-Type": "application/json",
		AuthorizationType: "ilink_bot_token",
		Authorization: `Bearer ${options.botToken.trim()}`,
		"X-WECHAT-UIN": randomWechatUin(),
		...commonHeaders(),
	};
}

function baseInfo(clientVersion: string): Record<string, string> {
	return {
		channel_version: clientVersion,
		bot_agent: "ObsidianMemosView",
	};
}

/** 长轮询拉取新消息。客户端超时属于正常控制流，返回空响应（ret=0）以便重试。 */
export async function getUpdates(
	options: ILinkClientOptions & {
		getUpdatesBuf: string;
		timeoutMs?: number;
		signal?: AbortSignal;
	},
): Promise<GetUpdatesResp> {
	const timeout = options.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
	try {
		return await httpPostJson<GetUpdatesResp>(
			`${options.baseUrl}/ilink/bot/getupdates`,
			{
				get_updates_buf: options.getUpdatesBuf ?? "",
				base_info: baseInfo(options.clientVersion),
			},
			{
				headers: authHeaders(options),
				timeoutMs: timeout + 5_000,
				signal: options.signal,
			},
		);
	} catch (err) {
		if (err instanceof HttpTimeoutError || (err instanceof Error && err.name === "AbortError" && !options.signal?.aborted)) {
			return { ret: 0, msgs: [], get_updates_buf: options.getUpdatesBuf };
		}
		throw err;
	}
}

/** 回发文本消息（带 context_token 才能送达对应会话）。 */
export async function sendTextMessage(
	options: ILinkClientOptions & {
		to: string;
		text: string;
		contextToken?: string;
		signal?: AbortSignal;
	},
): Promise<void> {
	const msg: WeixinMessage = {
		from_user_id: "",
		to_user_id: options.to,
		client_id: randomClientId(),
		message_type: MessageType.BOT,
		message_state: MessageState.FINISH,
		item_list: [{ type: MessageItemType.TEXT, text_item: { text: options.text } }],
		context_token: options.contextToken ?? undefined,
	};
	const resp = await httpPostJson<{ ret?: number; errmsg?: string }>(
		`${options.baseUrl}/ilink/bot/sendmessage`,
		{ msg, base_info: baseInfo(options.clientVersion) },
		{
			headers: authHeaders(options),
			timeoutMs: DEFAULT_API_TIMEOUT_MS,
			signal: options.signal,
		},
	);
	if (resp.ret && resp.ret !== 0) {
		throw new Error(`sendMessage ret=${resp.ret} errmsg=${resp.errmsg ?? "(none)"}`);
	}
}

/** 申请登录二维码。localTokens 用于 binded_redirect 判定（已绑定设备无需重复登录）。 */
export async function fetchBotQrcode(
	clientVersion: string,
	localTokens: string[] = [],
): Promise<QrCodeResponse> {
	return httpPostJson<QrCodeResponse>(
		`${QR_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(DEFAULT_ILINK_BOT_TYPE)}`,
		{ local_token_list: localTokens },
		{
			// 对齐官方无 token 时的请求头：仍带 AuthorizationType 与 X-WECHAT-UIN
			headers: {
				AuthorizationType: "ilink_bot_token",
				"X-WECHAT-UIN": randomWechatUin(),
				...commonHeaders(),
			},
			timeoutMs: DEFAULT_API_TIMEOUT_MS,
		},
	);
}

/**
 * 轮询扫码状态（长轮询）。超时 / 网络错误均视为 wait 继续轮询；
 * IDC 重定向时由调用方切换轮询基址。
 */
export async function pollQrcodeStatus(
	clientVersion: string,
	qrcode: string,
	options: { baseUrl?: string; verifyCode?: string; signal?: AbortSignal } = {},
): Promise<QrStatusResponse> {
	const base = options.baseUrl ?? QR_BASE_URL;
	let endpoint = `${base}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
	if (options.verifyCode) {
		endpoint += `&verify_code=${encodeURIComponent(options.verifyCode)}`;
	}
	try {
		const { status, text } = await httpGetText(endpoint, {
			headers: commonHeaders(),
			timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
			followRedirects: 3,
			signal: options.signal,
		});
		if (status < 200 || status >= 300) {
			return { status: "wait" };
		}
		return JSON.parse(text) as QrStatusResponse;
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			throw err;
		}
		// 网关超时（如 524）或其他网络错误，视为等待状态继续轮询
		if (err instanceof HttpTimeoutError) {
			return { status: "wait" };
		}
		console.warn("[wechat] pollQrcodeStatus failed, retrying:", err);
		return { status: "wait" };
	}
}

/** 停止会话通知（尽力而为，不抛错）。 */
export async function notifyStop(options: ILinkClientOptions): Promise<void> {
	try {
		await httpPostJson(
			`${options.baseUrl}/ilink/bot/msg/notifystop`,
			{ base_info: baseInfo(options.clientVersion) },
			{
				headers: authHeaders(options),
				timeoutMs: 10_000,
			},
		);
	} catch {
		// 忽略
	}
}
