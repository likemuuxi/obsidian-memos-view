/**
 * SILK 语音转码为 WAV（微信语音消息的主流编码）。
 *
 * 微信语音经 AES 解密后是 SILK 裸流，Obsidian/Chromium 无法播放；
 * 用 silk-wasm 解码为 PCM 后封装标准 WAV 容器即可内嵌播放。
 * 懒加载依赖：加载失败或解码失败时调用方回退保留原始 .silk。
 */

// esbuild 把 wasm 以 base64 文本内联进 main.js（loader: {".wasm": "base64"}），
// 因为 silk-wasm 自带的 new URL(..., import.meta.url) 定位在 CJS bundle 中不可用
// （构建时已把该表达式改写为读取 globalThis.__SILK_WASM_URL__）。
import silkWasmBase64 from "silk-wasm/lib/silk.wasm";

/** 微信语音标准采样率。 */
const SILK_SAMPLE_RATE = 24_000;

type SilkWasmGlobal = typeof globalThis & { __SILK_WASM_URL__?: string };

/** 首次解码前把内联的 wasm 二进制注册为 blob URL。 */
function ensureSilkWasmUrl(): void {
	const globalScope = globalThis as SilkWasmGlobal;
	if (globalScope.__SILK_WASM_URL__) {
		return;
	}
	const bytes = Uint8Array.from(atob(silkWasmBase64), (ch) => ch.charCodeAt(0));
	globalScope.__SILK_WASM_URL__ = URL.createObjectURL(
		new Blob([bytes], { type: "application/wasm" }),
	);
}

/** 将 mono pcm_s16le 裸流封装为 44 字节头的 WAV 容器。 */
function pcmToWav(pcm: Uint8Array, sampleRate: number): Buffer {
	const dataBytes = pcm.byteLength;
	const totalSize = 44 + dataBytes;
	const buf = Buffer.alloc(totalSize);
	let offset = 0;

	buf.write("RIFF", offset);
	offset += 4;
	buf.writeUInt32LE(totalSize - 8, offset);
	offset += 4;
	buf.write("WAVE", offset);
	offset += 4;

	buf.write("fmt ", offset);
	offset += 4;
	buf.writeUInt32LE(16, offset); // fmt 块长度
	offset += 4;
	buf.writeUInt16LE(1, offset); // PCM
	offset += 2;
	buf.writeUInt16LE(1, offset); // 单声道
	offset += 2;
	buf.writeUInt32LE(sampleRate, offset);
	offset += 4;
	buf.writeUInt32LE(sampleRate * 2, offset); // byte rate（16bit 单声道）
	offset += 4;
	buf.writeUInt16LE(2, offset); // block align
	offset += 2;
	buf.writeUInt16LE(16, offset); // 位深
	offset += 2;

	buf.write("data", offset);
	offset += 4;
	buf.writeUInt32LE(dataBytes, offset);
	offset += 4;

	Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, offset);
	return buf;
}

/**
 * 尝试把 SILK 数据解码为 WAV。
 * 返回 null 表示依赖不可用或解码失败（如数据其实是 amr/mp3）。
 */
export async function silkToWav(silk: Buffer): Promise<Buffer | null> {
	try {
		ensureSilkWasmUrl();
		const { decode } = await import("silk-wasm");
		const result = await decode(new Uint8Array(silk), SILK_SAMPLE_RATE);
		if (!result?.data?.length) {
			return null;
		}
		return pcmToWav(result.data, SILK_SAMPLE_RATE);
	} catch (err) {
		console.warn("[wechat] silk decode failed, keeping raw file:", err);
		return null;
	}
}
