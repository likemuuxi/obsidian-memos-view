/**
 * 微信 iLink 协议类型（依据官方 MIT 包 @tencent-weixin/openclaw-weixin 的协议定义重写）。
 * 仅包含本插件用到的子集；JSON 传输，bytes 字段为 base64 字符串。
 */

export const MessageType = {
	NONE: 0,
	USER: 1,
	BOT: 2,
} as const;

export const MessageItemType = {
	NONE: 0,
	TEXT: 1,
	IMAGE: 2,
	VOICE: 3,
	FILE: 4,
	VIDEO: 5,
	TOOL_CALL_START: 11,
	TOOL_CALL_RESULT: 12,
} as const;

export const MessageState = {
	NEW: 0,
	GENERATING: 1,
	FINISH: 2,
} as const;

export interface TextItem {
	text?: string;
}

/** CDN 媒体引用；aes_key 为 base64 字符串。 */
export interface CDNMedia {
	encrypt_query_param?: string;
	aes_key?: string;
	/** 0=只加密 fileid, 1=打包缩略图信息 */
	encrypt_type?: number;
	/** 服务端直接返回的完整下载 URL */
	full_url?: string;
}

export interface ImageItem {
	media?: CDNMedia;
	thumb_media?: CDNMedia;
	/** 16 字节 AES-128 key 的 hex 字符串；优先于 media.aes_key */
	aeskey?: string;
	url?: string;
	mid_size?: number;
}

export interface VoiceItem {
	media?: CDNMedia;
	/** 语音编码类型：5=amr 6=silk 7=mp3 等 */
	encode_type?: number;
	/** 语音长度（毫秒） */
	playtime?: number;
	/** 微信自动转写的文本 */
	text?: string;
}

export interface FileItem {
	media?: CDNMedia;
	file_name?: string;
}

export interface VideoItem {
	media?: CDNMedia;
	video_size?: number;
	play_length?: number;
	thumb_media?: CDNMedia;
}

export interface RefMessage {
	title?: string;
}

export interface MessageItem {
	type?: number;
	create_time_ms?: number;
	msg_id?: string;
	ref_msg?: RefMessage;
	text_item?: TextItem;
	image_item?: ImageItem;
	voice_item?: VoiceItem;
	file_item?: FileItem;
	video_item?: VideoItem;
}

export interface WeixinMessage {
	seq?: number;
	message_id?: number;
	from_user_id?: string;
	to_user_id?: string;
	client_id?: string;
	create_time_ms?: number;
	message_type?: number;
	message_state?: number;
	item_list?: MessageItem[];
	context_token?: string;
}

export interface GetUpdatesResp {
	ret?: number;
	/** 服务端错误码；-14 表示 token 失效 */
	errcode?: number;
	errmsg?: string;
	msgs?: WeixinMessage[];
	/** 本地缓存、下次请求原样带回的同步游标 */
	get_updates_buf?: string;
	/** 服务端建议的下一次长轮询超时（毫秒） */
	longpolling_timeout_ms?: number;
}

/** 扫码登录状态机的全部状态。 */
export type QrLoginStatus =
	| "wait"
	| "scaned"
	| "confirmed"
	| "expired"
	| "scaned_but_redirect"
	| "need_verifycode"
	| "verify_code_blocked"
	| "binded_redirect";

export interface QrCodeResponse {
	qrcode: string;
	/** 需渲染成二维码的内容字符串 */
	qrcode_img_content: string;
}

export interface QrStatusResponse {
	status: QrLoginStatus;
	bot_token?: string;
	ilink_bot_id?: string;
	/** 登录确认后返回的 API 基址（IDC 专属） */
	baseurl?: string;
	ilink_user_id?: string;
	/** scaned_but_redirect 时需切换的轮询主机 */
	redirect_host?: string;
}

/** 微信集成设置（存储于插件 settings.wechat）。 */
export interface WechatSettings {
	botToken: string;
	/** 登录确认后服务端返回的 API 基址；空则用默认 */
	baseUrl: string;
	/** 微信附件保存目录；空 = 使用库默认附件位置 */
	attachmentFolder: string;
	/** 公众号文章保存目录 */
	articleFolder: string;
	/** 消息中同时包含该词和链接时触发剪藏 */
	clipConfirmKeyword: string;
	/** 只发送一条网页链接也直接剪藏 */
	autoClipPureLink: boolean;
	/** 剪藏时把文章图片下载到本地 */
	localiseArticleImages: boolean;
	/** 语音转写文字的同时把原声存为附件 */
	saveVoiceAudio: boolean;
	/** 微信消息以指定时间戳写入（用于补收离线消息） */
	useMessageTime: boolean;
}

export const DEFAULT_WECHAT_SETTINGS: WechatSettings = {
	botToken: "",
	baseUrl: "",
	attachmentFolder: "",
	articleFolder: "WeChat Articles",
	clipConfirmKeyword: "剪藏",
	autoClipPureLink: true,
	localiseArticleImages: true,
	saveVoiceAudio: true,
	useMessageTime: true,
};

/** 运行时状态（游标等），持久化在插件目录 wechat-state.json。 */
export interface WechatRuntimeState {
	getUpdatesBuf: string;
}
