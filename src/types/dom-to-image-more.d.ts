declare module "dom-to-image-more" {
	interface Options {
		filter?: (node: Node) => boolean;
		bgcolor?: string;
		width?: number;
		height?: number;
		style?: Partial<CSSStyleDeclaration>;
		quality?: number;
		imagePlaceholder?: string;
		cacheBust?: boolean;
	}

	interface DomToImage {
		toSvg(node: Node, options?: Options): Promise<string>;
		toPng(node: Node, options?: Options): Promise<string>;
		toJpeg(node: Node, options?: Options): Promise<string>;
		toBlob(node: Node, options?: Options): Promise<Blob>;
		toPixelData(node: Node, options?: Options): Promise<Uint8ClampedArray>;
	}

	const domtoimage: DomToImage;
	export default domtoimage;
}
