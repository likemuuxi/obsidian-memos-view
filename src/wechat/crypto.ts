/**
 * 微信 iLink 需要的加密工具：AES-128-ECB 解密（CDN 媒体）与随机数。
 * 全部懒加载 node:crypto，仅桌面端调用。
 */

type NodeCryptoModule = typeof import("crypto");

let cryptoModule: NodeCryptoModule | null = null;

function getCrypto(): NodeCryptoModule {
	if (!cryptoModule) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		cryptoModule = require("crypto") as NodeCryptoModule;
	}
	return cryptoModule;
}

/** AES-128-ECB 解密（PKCS7 填充），用于 CDN 媒体。 */
export function aesEcbDecrypt(data: Buffer, key: Buffer): Buffer {
	const crypto = getCrypto();
	const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
	return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * 把 CDNMedia.aes_key（base64）解析为 16 字节裸 key。
 * 线上有两种编码：
 *   - base64(16 字节裸 key)            → 图片
 *   - base64(32 字符 hex 字符串) 再 hex 解码 → 文件 / 语音 / 视频
 */
export function parseAesKey(aesKeyBase64: string, label: string): Buffer {
	const decoded = Buffer.from(aesKeyBase64, "base64");
	if (decoded.length === 16) {
		return decoded;
	}
	if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
		return Buffer.from(decoded.toString("ascii"), "hex");
	}
	throw new Error(
		`${label}: aes_key 应解码为 16 字节裸 key 或 32 位 hex 字符串，实际 ${decoded.length} 字节`,
	);
}

/** X-WECHAT-UIN header：随机 uint32 → 十进制字符串 → base64。 */
export function randomWechatUin(): string {
	const crypto = getCrypto();
	const uint32 = crypto.randomBytes(4).readUInt32BE(0);
	return Buffer.from(String(uint32), "utf-8").toString("base64");
}

/** 生成 client_id。 */
export function randomClientId(): string {
	const crypto = getCrypto();
	return `memos-${crypto.randomBytes(8).toString("hex")}`;
}

/** 生成会话密钥（扫码登录会话标识）。 */
export function randomSessionKey(): string {
	const crypto = getCrypto();
	return crypto.randomBytes(16).toString("hex");
}
