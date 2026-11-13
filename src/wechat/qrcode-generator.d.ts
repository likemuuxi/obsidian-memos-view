declare module "qrcode-generator" {
	interface QRCode {
		addData(data: string, mode?: string): void;
		make(): void;
		getModuleCount(): number;
		isDark(row: number, col: number): boolean;
	}
	function qrcode(typeNumber: number, errorCorrectionLevel: string): QRCode;
	export default qrcode;
}
