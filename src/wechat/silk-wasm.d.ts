/**
 * esbuild 配置了 loader: {".wasm": "base64"}，
 * 该导入在打包时会被替换为内联的 base64 字符串。
 */
declare module "silk-wasm/lib/silk.wasm" {
	const silkWasmBase64: string;
	export default silkWasmBase64;
}
