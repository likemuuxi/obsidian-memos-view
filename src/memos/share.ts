import { App, Component, MarkdownRenderer, Modal, Notice, setIcon } from "obsidian";
import domtoimage from "dom-to-image-more";
import type { MemoEntry } from "../types";
import { t } from "../i18n";

type MemoShareStyleId = "daily" | "ticket" | "phone" | "memo" | "feed" | "plain";

interface MemoShareStyle {
	id: MemoShareStyleId;
	label: string;
	background: string;
	cardBackground: string;
	text: string;
	muted: string;
	accent: string;
	border: string;
	shadow: string;
	title: string;
}

const SHARE_STYLES: MemoShareStyle[] = [
	{
		id: "daily",
		label: "Daily",
		background: "linear-gradient(135deg, #f5ecd5 0%, #fbf6e8 54%, #e7d2a0 100%)",
		cardBackground: "#fffaf0",
		text: "#4f3f2a",
		muted: "#b79755",
		accent: "#d5a64d",
		border: "#ead9ac",
		shadow: "0 30px 80px rgba(112, 83, 28, 0.22)",
		title: "memos",
	},
	{
		id: "ticket",
		label: "Ticket",
		background: "linear-gradient(145deg, #f2f2f2 0%, #ffffff 48%, #e5e5e5 100%)",
		cardBackground: "#ffffff",
		text: "#303030",
		muted: "#969696",
		accent: "#d95f64",
		border: "#d6d6d6",
		shadow: "0 30px 70px rgba(38, 38, 38, 0.15)",
		title: "flomo",
	},
	{
		id: "phone",
		label: "Phone",
		background: "linear-gradient(160deg, #f8f9f3 0%, #f1f4e8 46%, #d9e3c2 100%)",
		cardBackground: "#fffef8",
		text: "#3f4434",
		muted: "#9aa184",
		accent: "#b7c66a",
		border: "#d9dfbd",
		shadow: "0 32px 72px rgba(81, 91, 54, 0.18)",
		title: "12 / 03",
	},
	{
		id: "memo",
		label: "Memo",
		background: "linear-gradient(140deg, #fff9dc 0%, #fffdf1 56%, #f2dfa3 100%)",
		cardBackground: "#fffdf0",
		text: "#4f452d",
		muted: "#b7a76d",
		accent: "#dfb93f",
		border: "#efe0a6",
		shadow: "0 28px 78px rgba(145, 112, 33, 0.18)",
		title: "memo",
	},
	{
		id: "feed",
		label: "Clean",
		background: "linear-gradient(135deg, #f6faf7 0%, #ffffff 54%, #edf5ef 100%)",
		cardBackground: "#ffffff",
		text: "#2f3d34",
		muted: "#95a99b",
		accent: "#36c275",
		border: "#dce9df",
		shadow: "0 28px 76px rgba(40, 87, 58, 0.14)",
		title: "memos",
	},
	{
		id: "plain",
		label: "Plain",
		background: "linear-gradient(135deg, #f7f7f7 0%, #ffffff 52%, #ededed 100%)",
		cardBackground: "#ffffff",
		text: "#272727",
		muted: "#a3a3a3",
		accent: "#787878",
		border: "#eeeeee",
		shadow: "0 24px 68px rgba(0, 0, 0, 0.1)",
		title: "memo",
	},
];

const DEFAULT_SHARE_STYLE = SHARE_STYLES[1] as MemoShareStyle;
const SHARE_IMAGE_WIDTH = 1100;
const SHARE_CARD_WIDTH = 900;

export function openMemoShareModal(app: App, memo: MemoEntry): void {
	new MemoShareModal(app, memo).open();
}

class MemoShareModal extends Modal {
	private readonly memo: MemoEntry;
	private readonly markdownRenderComponent = new Component();
	private selectedStyle: MemoShareStyle = DEFAULT_SHARE_STYLE;
	private previewWrapEl: HTMLElement | null = null;
	private styleListEl: HTMLElement | null = null;
	private previewRenderId = 0;

	constructor(app: App, memo: MemoEntry) {
		super(app);
		this.memo = memo;
	}

	onOpen(): void {
		this.modalEl.addClass("memos-share-modal");
		this.markdownRenderComponent.load();
		this.render();
	}

	onClose(): void {
		this.markdownRenderComponent.unload();
		this.contentEl.empty();
		this.modalEl.removeClass("memos-share-modal");
	}

	private render(): void {
		this.contentEl.empty();

		this.previewWrapEl = this.contentEl.createDiv({ cls: "memos-share-preview-wrap" });
		this.previewWrapEl.addEventListener("click", () => {
			void this.copyImage();
		});

		this.styleListEl = this.contentEl.createDiv({ cls: "memos-share-style-list" });
		this.renderStyleList();

		const actionsEl = this.contentEl.createDiv({ cls: "memos-share-actions" });
		const copyButtonEl = actionsEl.createEl("button", {
			cls: "memos-share-action is-primary",
			text: t("share.copyImage"),
			attr: { type: "button" },
		});
		copyButtonEl.addEventListener("click", () => {
			void this.copyImage();
		});
		const saveButtonEl = actionsEl.createEl("button", {
			cls: "memos-share-action",
			text: t("share.saveImage"),
			attr: { type: "button" },
		});
		saveButtonEl.addEventListener("click", () => {
			void this.saveImage();
		});

		void this.renderPreview();
	}

	private renderStyleList(): void {
		if (!this.styleListEl) {
			return;
		}

		this.styleListEl.empty();
		SHARE_STYLES.forEach((style) => {
			const buttonEl = this.styleListEl?.createEl("button", {
				cls: `memos-share-style-button${this.selectedStyle.id === style.id ? " is-active" : ""}`,
				attr: {
					type: "button",
					"aria-pressed": String(this.selectedStyle.id === style.id),
					"aria-label": `Choose ${style.label} style`,
				},
			});
			if (!buttonEl) {
				return;
			}
			buttonEl.dataset.shareStyleId = style.id;
			buttonEl.setText(style.label);
			buttonEl.addEventListener("click", () => {
				this.selectedStyle = style;
				this.updateStyleListActive();
				if (!this.updatePreviewStyle()) {
					void this.renderPreview();
				}
			});
		});
	}

	private updateStyleListActive(): void {
		if (!this.styleListEl) {
			return;
		}

		this.styleListEl.querySelectorAll(".memos-share-style-button").forEach((buttonEl) => {
			if (!(buttonEl instanceof HTMLElement)) {
				return;
			}

			const isActive = buttonEl.dataset.shareStyleId === this.selectedStyle.id;
			buttonEl.toggleClass("is-active", isActive);
			buttonEl.setAttribute("aria-pressed", String(isActive));
		});
	}

	private async renderPreview(): Promise<void> {
		if (!this.previewWrapEl) {
			return;
		}

		const renderId = ++this.previewRenderId;
		const previousPreviewEl = this.previewWrapEl.querySelector(".memos-share-preview");
		const previousHeight = previousPreviewEl instanceof HTMLElement
			? previousPreviewEl.offsetHeight
			: this.previewWrapEl.offsetHeight;
		if (previousHeight > 0) {
			this.previewWrapEl.style.minHeight = `${previousHeight}px`;
		}

		const previewEl = this.previewWrapEl.createDiv({ cls: "memos-share-preview" });
		const previewInnerEl = previewEl.createDiv({ cls: "memos-share-preview-inner" });
		previewInnerEl.innerHTML = buildShareCardHtml(this.memo, this.selectedStyle, "preview", "");
		previewEl.style.position = "absolute";
		previewEl.style.visibility = "hidden";
		previewEl.style.pointerEvents = "none";
		const contentEl = previewInnerEl.querySelector(".memos-share-card-content");
		if (contentEl instanceof HTMLElement) {
			contentEl.empty();
			await MarkdownRenderer.render(
				this.app,
				this.memo.content,
				contentEl,
				this.memo.sourcePath,
				this.markdownRenderComponent,
			);
		}

		await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
		if (renderId !== this.previewRenderId || !this.previewWrapEl) {
			previewEl.remove();
			return;
		}

		this.fitPreviewToContainer(previewEl, previewInnerEl);
		previewEl.style.position = "";
		previewEl.style.visibility = "";
		previewEl.style.pointerEvents = "";
		const nextHeight = previewEl.offsetHeight;
		if (nextHeight > 0) {
			this.previewWrapEl.style.minHeight = `${nextHeight}px`;
		}
		Array.from(this.previewWrapEl.querySelectorAll(".memos-share-preview")).forEach((node) => {
			if (node !== previewEl) {
				node.remove();
			}
		});
	}

	private fitPreviewToContainer(previewEl: HTMLElement, previewInnerEl: HTMLElement): void {
		if (!this.previewWrapEl) {
			return;
		}

		const wrapStyle = window.getComputedStyle(this.previewWrapEl);
		const horizontalPadding =
			Number.parseFloat(wrapStyle.paddingLeft) +
			Number.parseFloat(wrapStyle.paddingRight);
		const availableWidth = Math.max(320, this.previewWrapEl.clientWidth - horizontalPadding);
		const scale = Math.min(1, Math.max(0.38, availableWidth / SHARE_CARD_WIDTH));
		const cardEl = previewInnerEl.querySelector(".memos-share-card");
		const cardHeight = cardEl instanceof HTMLElement ? cardEl.offsetHeight : 0;

		previewEl.style.width = `${SHARE_CARD_WIDTH * scale}px`;
		previewEl.style.height = cardHeight ? `${cardHeight * scale}px` : "";
		previewInnerEl.style.transform = `scale(${scale})`;
	}

	private async copyImage(): Promise<void> {
		try {
			const blob = await this.createImageBlob();
			await navigator.clipboard.write([
				new ClipboardItem({
					"image/png": blob,
				}),
			]);
			new Notice(t("share.imageCopied"));
		} catch (error) {
			console.error("Failed to copy share image", error);
			new Notice(t("share.copyFailed"));
			await this.saveImage();
		}
	}

	private updatePreviewStyle(): boolean {
		if (!this.previewWrapEl) {
			return false;
		}

		const cardEl = this.previewWrapEl.querySelector(".memos-share-card");
		const brandEl = this.previewWrapEl.querySelector(".memos-share-card-brand");
		if (!(cardEl instanceof HTMLElement) || !(brandEl instanceof HTMLElement)) {
			return false;
		}

		this.applyStyleToShareCard(cardEl, this.selectedStyle);
		brandEl.setText(`- ${this.selectedStyle.title} -`);
		return true;
	}

	private applyStyleToShareCard(cardEl: HTMLElement, style: MemoShareStyle): void {
		cardEl.style.setProperty("--share-bg", style.cardBackground);
		cardEl.style.setProperty("--share-text", style.text);
		cardEl.style.setProperty("--share-muted", style.muted);
		cardEl.style.setProperty("--share-accent", style.accent);
		cardEl.style.setProperty("--share-border", style.border);
		cardEl.style.setProperty("--share-shadow", style.shadow);
	}

	private async saveImage(): Promise<void> {
		try {
			const blob = await this.createImageBlob();
			const url = URL.createObjectURL(blob);
			const linkEl = document.createElement("a");
			linkEl.href = url;
			linkEl.download = `memo-share-${this.memo.dayKey}-${this.memo.createdLabel.replace(/[:\s]/g, "")}.png`;
			linkEl.click();
			window.setTimeout(() => {
				URL.revokeObjectURL(url);
			}, 1000);
			new Notice(t("share.imageSaved"));
		} catch (error) {
			console.error("Failed to save share image", error);
			new Notice(t("share.saveFailed"));
		}
	}

	private async createImageBlob(): Promise<Blob> {
		return exportShareCardDomToBlob(
			this.app,
			this.memo,
			this.selectedStyle,
			this.markdownRenderComponent,
		);
	}
}

async function exportShareCardDomToBlob(
	app: App,
	memo: MemoEntry,
	style: MemoShareStyle,
	component: Component,
): Promise<Blob> {
	const surfaceEl = document.createElement("div");
	surfaceEl.addClass("memos-share-export-surface");
	surfaceEl.style.setProperty("--share-export-bg", style.background);
	surfaceEl.innerHTML = buildShareCardHtml(memo, style, "image", "");

	const contentEl = surfaceEl.querySelector(".memos-share-card-content");
	if (!(contentEl instanceof HTMLElement)) {
		throw new Error("Share card content element was not created.");
	}

	document.body.appendChild(surfaceEl);
	try {
		await MarkdownRenderer.render(app, memo.content, contentEl, memo.sourcePath, component);
		await waitForDomToSettle(surfaceEl);
		const rect = surfaceEl.getBoundingClientRect();
		return await domtoimage.toBlob(surfaceEl, {
			width: Math.ceil(rect.width),
			height: Math.ceil(rect.height),
			cacheBust: true,
			imagePlaceholder: TRANSPARENT_IMAGE_PLACEHOLDER,
		});
	} finally {
		surfaceEl.remove();
	}
}

async function waitForDomToSettle(rootEl: HTMLElement): Promise<void> {
	await Promise.resolve(document.fonts?.ready).catch(() => undefined);
	const images = Array.from(rootEl.querySelectorAll("img"));
	await Promise.all(
		images.map((image) => {
			if (image.complete) {
				return Promise.resolve();
			}

			return new Promise<void>((resolve) => {
				image.addEventListener("load", () => resolve(), { once: true });
				image.addEventListener("error", () => resolve(), { once: true });
			});
		}),
	);
	await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

const TRANSPARENT_IMAGE_PLACEHOLDER =
	"data:image/gif;base64,R0lGODlhAQABAAAAACw=";

function renderShareImageToPngBlob(
	memo: MemoEntry,
	style: MemoShareStyle,
): Promise<Blob> {
	const scale = 2;
	const contentLayout = layoutMemoText(memo.content, SHARE_CARD_WIDTH - 112);
	const cardHeight = Math.max(520, 314 + contentLayout.height);
	const imageHeight = cardHeight + 160;
	const canvas = document.createElement("canvas");
	canvas.width = SHARE_IMAGE_WIDTH * scale;
	canvas.height = imageHeight * scale;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Canvas is unavailable.");
	}

	context.scale(scale, scale);
	drawCanvasBackground(context, style, SHARE_IMAGE_WIDTH, imageHeight);

	const cardX = (SHARE_IMAGE_WIDTH - SHARE_CARD_WIDTH) / 2;
	const cardY = 80;
	drawShareCardShell(context, cardX, cardY, SHARE_CARD_WIDTH, cardHeight, style);

	context.fillStyle = style.text;
	context.font = "800 30px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
	context.textAlign = "center";
	context.textBaseline = "top";
	context.fillText(`- ${style.title} -`, SHARE_IMAGE_WIDTH / 2, cardY + 68);

	const contentX = cardX + 56;
	const contentWidth = SHARE_CARD_WIDTH - 112;
	drawRule(context, contentX, cardY + 180, contentWidth, style.border);
	drawMemoTextLayout(context, contentLayout, contentX, cardY + 238, style);
	drawRule(context, contentX, cardY + cardHeight - 92, contentWidth, style.border);

	context.fillStyle = style.muted;
	context.font = "400 18px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
	context.textAlign = "left";
	context.fillText(`${memo.dayKey} ${memo.createdLabel}`, contentX, cardY + cardHeight - 56);
	context.textAlign = "right";
	context.fillText(memo.sourceBasename, contentX + contentWidth, cardY + cardHeight - 56);

	return canvasToBlob(canvas);
}

interface TextLayoutLine {
	text: string;
	type: "paragraph" | "list" | "quote" | "code" | "heading";
	runs?: TextRun[];
}

interface TextLayout {
	lines: TextLayoutLine[];
	height: number;
}

interface TextRun {
	text: string;
	bold?: boolean;
	code?: boolean;
	accent?: boolean;
}

function layoutMemoText(content: string, maxWidth: number): TextLayout {
	const measureCanvas = document.createElement("canvas");
	const context = measureCanvas.getContext("2d");
	if (!context) {
		throw new Error("Canvas is unavailable.");
	}

	const lines: TextLayoutLine[] = [];
	const normalizedLines = content.replace(/\r\n/g, "\n").trim().split("\n");
	let inCodeBlock = false;

	for (const rawLine of normalizedLines) {
		const trimmedLine = rawLine.trimEnd();
		if (trimmedLine.trim().startsWith("```")) {
			inCodeBlock = !inCodeBlock;
			continue;
		}

		if (!trimmedLine.trim()) {
			lines.push({ text: "", type: "paragraph" });
			continue;
		}

		if (inCodeBlock) {
			appendRichMarkdownLines(context, lines, trimmedLine, "code", maxWidth - 40);
			continue;
		}

		const headingMatch = trimmedLine.match(/^(#{1,3})\s+(.+)$/);
		if (headingMatch) {
			appendRichMarkdownLines(context, lines, headingMatch[2] ?? "", "heading", maxWidth);
			continue;
		}

		const listMatch = trimmedLine.match(/^[-*+]\s+(?:\[[ xX]\]\s*)?(.+)$/);
		if (listMatch) {
			appendRichMarkdownLines(context, lines, listMatch[1] ?? "", "list", maxWidth - 34, "- ");
			continue;
		}

		const isQuote = trimmedLine.startsWith(">");
		const text = isQuote ? trimmedLine.replace(/^>\s?/, "") : trimmedLine;
		appendRichMarkdownLines(
			context,
			lines,
			text,
			isQuote ? "quote" : "paragraph",
			isQuote ? maxWidth - 26 : maxWidth,
		);
	}

	const height = lines.reduce((total, line) => total + getCanvasLineHeight(line), 0);
	return { lines, height };
}

function appendRichMarkdownLines(
	context: CanvasRenderingContext2D,
	lines: TextLayoutLine[],
	text: string,
	type: TextLayoutLine["type"],
	maxWidth: number,
	prefix = "",
): void {
	const runs = parseInlineMarkdownRuns(text);
	const prefixedRuns = prefix
		? [{ text: prefix }, ...runs]
		: runs;
	wrapRichTextRuns(context, prefixedRuns, type, maxWidth).forEach((lineRuns) => {
		lines.push({
			text: lineRuns.map((run) => run.text).join(""),
			type,
			runs: lineRuns,
		});
	});
}

function parseInlineMarkdownRuns(text: string): TextRun[] {
	const normalizedText = normalizeMarkdownForCanvas(text);
	const runs: TextRun[] = [];
	const pattern =
		/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\[([^\]]+)\]\(([^)]+)\)|\[\[([^|\]]+)\|([^\]]+)\]\]|\[\[([^\]]+)\]\]|#[A-Za-z0-9_/-]+)/g;
	let cursor = 0;

	for (const match of normalizedText.matchAll(pattern)) {
		const index = match.index ?? 0;
		if (index > cursor) {
			runs.push({ text: normalizedText.slice(cursor, index) });
		}

		const token = match[0];
		if (token.startsWith("`")) {
			runs.push({ text: token.slice(1, -1), code: true });
		} else if (token.startsWith("**") || token.startsWith("__")) {
			runs.push({ text: token.slice(2, -2), bold: true });
		} else if (token.startsWith("~~")) {
			runs.push({ text: token.slice(2, -2) });
		} else if (match[2]) {
			runs.push({ text: match[2], accent: true });
		} else if (match[5]) {
			runs.push({ text: match[5], accent: true });
		} else if (match[6]) {
			runs.push({ text: match[6], accent: true });
		} else if (token.startsWith("#")) {
			runs.push({ text: token, accent: true });
		} else {
			runs.push({ text: token });
		}

		cursor = index + token.length;
	}

	if (cursor < normalizedText.length) {
		runs.push({ text: normalizedText.slice(cursor) });
	}

	return mergeAdjacentRuns(runs.filter((run) => run.text));
}

function wrapRichTextRuns(
	context: CanvasRenderingContext2D,
	runs: TextRun[],
	type: TextLayoutLine["type"],
	maxWidth: number,
): TextRun[][] {
	const lines: TextRun[][] = [];
	let currentLine: TextRun[] = [];
	let currentWidth = 0;

	const pushLine = (): void => {
		const trimmed = trimRichLine(currentLine);
		if (trimmed.length) {
			lines.push(trimmed);
		}
		currentLine = [];
		currentWidth = 0;
	};

	for (const run of runs) {
		const tokens = run.text.split(/(\s+)/).filter(Boolean);
		for (const token of tokens) {
			const tokenRun = { ...run, text: token };
			const tokenWidth = measureRun(context, tokenRun, type);
			if (currentLine.length && currentWidth + tokenWidth > maxWidth && token.trim()) {
				pushLine();
			}

			if (!currentLine.length && tokenWidth > maxWidth) {
				for (const char of token) {
					const charRun = { ...run, text: char };
					const charWidth = measureRun(context, charRun, type);
					if (currentLine.length && currentWidth + charWidth > maxWidth) {
						pushLine();
					}
					currentLine.push(charRun);
					currentWidth += charWidth;
				}
			} else {
				currentLine.push(tokenRun);
				currentWidth += tokenWidth;
			}
		}
	}

	pushLine();
	return lines.length ? lines : [[{ text: "" }]];
}

function trimRichLine(runs: TextRun[]): TextRun[] {
	const merged = mergeAdjacentRuns(runs);
	if (!merged.length) {
		return [];
	}

	const firstRun = merged[0];
	if (firstRun) {
		merged[0] = { ...firstRun, text: firstRun.text.trimStart() };
	}
	const lastIndex = merged.length - 1;
	const lastRun = merged[lastIndex];
	if (lastRun) {
		merged[lastIndex] = { ...lastRun, text: lastRun.text.trimEnd() };
	}
	return merged.filter((run) => run.text);
}

function mergeAdjacentRuns(runs: TextRun[]): TextRun[] {
	const merged: TextRun[] = [];
	for (const run of runs) {
		const previous = merged.at(-1);
		if (
			previous &&
			Boolean(previous.bold) === Boolean(run.bold) &&
			Boolean(previous.code) === Boolean(run.code) &&
			Boolean(previous.accent) === Boolean(run.accent)
		) {
			previous.text += run.text;
		} else {
			merged.push({ ...run });
		}
	}

	return merged;
}

function measureRun(
	context: CanvasRenderingContext2D,
	run: TextRun,
	type: TextLayoutLine["type"],
): number {
	context.font = getCanvasFontForRun(type, run);
	return context.measureText(run.text).width;
}

async function layoutRenderedMarkdown(
	app: App,
	memo: MemoEntry,
	component: Component,
	maxWidth: number,
): Promise<TextLayout> {
	const renderEl = document.createElement("div");
	renderEl.addClass("markdown-rendered");
	renderEl.style.position = "fixed";
	renderEl.style.left = "-10000px";
	renderEl.style.top = "0";
	renderEl.style.width = `${maxWidth}px`;
	renderEl.style.pointerEvents = "none";
	renderEl.style.opacity = "0";
	document.body.appendChild(renderEl);

	try {
		await MarkdownRenderer.render(app, memo.content, renderEl, memo.sourcePath, component);
		return layoutRenderedMarkdownElement(renderEl, maxWidth);
	} finally {
		renderEl.remove();
	}
}

function layoutRenderedMarkdownElement(rootEl: HTMLElement, maxWidth: number): TextLayout {
	const measureCanvas = document.createElement("canvas");
	const context = measureCanvas.getContext("2d");
	if (!context) {
		throw new Error("Canvas is unavailable.");
	}

	const lines: TextLayoutLine[] = [];
	const appendWrappedLines = (
		text: string,
		type: TextLayoutLine["type"],
		width = maxWidth,
	): void => {
		const normalizedText = text.replace(/\s+/g, " ").trim();
		if (!normalizedText) {
			lines.push({ text: "", type: "paragraph" });
			return;
		}

		context.font = getCanvasFontForType(type);
		wrapCanvasText(context, normalizedText, width).forEach((line) => {
			lines.push({ text: line, type });
		});
	};

	rootEl.childNodes.forEach((node) => {
		appendRenderedNode(node, lines, appendWrappedLines, maxWidth);
	});

	const height = lines.reduce((total, line) => total + getCanvasLineHeight(line), 0);
	return { lines, height };
}

function appendRenderedNode(
	node: Node,
	lines: TextLayoutLine[],
	appendWrappedLines: (text: string, type: TextLayoutLine["type"], width?: number) => void,
	maxWidth: number,
): void {
	if (node instanceof Text) {
		appendWrappedLines(node.textContent ?? "", "paragraph");
		return;
	}

	if (!(node instanceof HTMLElement)) {
		return;
	}

	const tagName = node.tagName.toLowerCase();
	if (tagName === "h1" || tagName === "h2" || tagName === "h3") {
		appendWrappedLines(extractRenderedText(node), "heading");
		return;
	}

	if (tagName === "ul" || tagName === "ol") {
		const ordered = tagName === "ol";
		Array.from(node.children).forEach((child, index) => {
			if (!(child instanceof HTMLElement)) {
				return;
			}
			const marker = ordered ? `${index + 1}. ` : "- ";
			appendWrappedLines(`${marker}${extractRenderedText(child)}`, "list", maxWidth - 34);
		});
		lines.push({ text: "", type: "paragraph" });
		return;
	}

	if (tagName === "blockquote") {
		appendWrappedLines(extractRenderedText(node), "quote", maxWidth - 26);
		return;
	}

	if (tagName === "pre") {
		const codeText = node.textContent?.replace(/\n+$/g, "") ?? "";
		codeText.split("\n").forEach((line) => appendWrappedLines(line, "code", maxWidth - 40));
		lines.push({ text: "", type: "paragraph" });
		return;
	}

	if (tagName === "hr") {
		lines.push({ text: "----------------", type: "paragraph" });
		return;
	}

	if (tagName === "p" || tagName === "div") {
		appendWrappedLines(extractRenderedText(node), "paragraph");
		return;
	}

	if (tagName === "img") {
		appendWrappedLines(extractRenderedText(node), "paragraph");
		return;
	}

	appendWrappedLines(extractRenderedText(node), "paragraph");
}

function extractRenderedText(element: HTMLElement): string {
	if (element instanceof HTMLImageElement) {
		return `[image: ${element.alt || element.getAttribute("src") || "attachment"}]`;
	}

	const parts: string[] = [];
	element.childNodes.forEach((node) => {
		if (node instanceof Text) {
			parts.push(node.textContent ?? "");
			return;
		}

		if (node instanceof HTMLBRElement) {
			parts.push("\n");
			return;
		}

		if (node instanceof HTMLInputElement && node.type === "checkbox") {
			parts.push(node.checked ? "[x] " : "[ ] ");
			return;
		}

		if (node instanceof HTMLElement) {
			parts.push(extractRenderedText(node));
		}
	});

	return parts.join("").trim();
}

function getCanvasFontForType(type: TextLayoutLine["type"]): string {
	if (type === "heading") {
		return "700 34px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
	}
	if (type === "code") {
		return "400 22px monospace";
	}
	return "400 30px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
	const normalizedText = normalizeMarkdownForCanvas(text);
	const words = normalizedText.split(/(\s+)/).filter(Boolean);
	const lines: string[] = [];
	let currentLine = "";

	for (const word of words) {
		const nextLine = currentLine ? `${currentLine}${word}` : word.trimStart();
		if (context.measureText(nextLine).width <= maxWidth || !currentLine) {
			currentLine = nextLine;
			continue;
		}

		lines.push(currentLine.trimEnd());
		currentLine = word.trimStart();
	}

	if (currentLine.trim()) {
		lines.push(currentLine.trimEnd());
	}

	return lines.flatMap((line) => breakLongCanvasLine(context, line, maxWidth));
}

function breakLongCanvasLine(context: CanvasRenderingContext2D, line: string, maxWidth: number): string[] {
	if (context.measureText(line).width <= maxWidth) {
		return [line];
	}

	const result: string[] = [];
	let currentLine = "";
	for (const char of line) {
		const nextLine = `${currentLine}${char}`;
		if (context.measureText(nextLine).width <= maxWidth || !currentLine) {
			currentLine = nextLine;
		} else {
			result.push(currentLine);
			currentLine = char;
		}
	}

	if (currentLine) {
		result.push(currentLine);
	}
	return result;
}

function normalizeMarkdownForCanvas(text: string): string {
	return text
		.replace(/!\[\[([^\]]+)\]\]/g, "[image: $1]")
		.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string, src: string) => `[image: ${alt || src}]`);
}

function drawMemoTextLayout(
	context: CanvasRenderingContext2D,
	layout: TextLayout,
	x: number,
	y: number,
	style: MemoShareStyle,
): void {
	let cursorY = y;
	for (const line of layout.lines) {
		const lineHeight = getCanvasLineHeight(line);
		if (!line.text) {
			cursorY += lineHeight;
			continue;
		}

		if (line.type === "heading") {
			context.font = "700 34px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
		} else if (line.type === "code") {
			context.font = "400 22px monospace";
			drawRoundedRect(context, x, cursorY - 6, SHARE_CARD_WIDTH - 112, lineHeight, 12, "rgba(0, 0, 0, 0.055)");
		} else {
			context.font = "400 30px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
		}

		context.textAlign = "left";
		context.textBaseline = "top";
		if (line.type === "quote") {
			context.fillStyle = style.accent;
			context.fillRect(x, cursorY + 4, 5, lineHeight - 12);
			drawRichTextLine(context, line, x + 22, cursorY, style);
		} else {
			drawRichTextLine(context, line, x, cursorY, style);
		}
		cursorY += lineHeight;
	}
}

function drawRichTextLine(
	context: CanvasRenderingContext2D,
	line: TextLayoutLine,
	x: number,
	y: number,
	style: MemoShareStyle,
): void {
	const runs = line.runs ?? [{ text: line.text }];
	let cursorX = x;
	for (const run of runs) {
		context.font = getCanvasFontForRun(line.type, run);
		context.fillStyle = getCanvasColorForRun(line.type, run, style);
		if (run.code) {
			const metrics = context.measureText(run.text);
			drawRoundedRect(context, cursorX - 5, y + 4, metrics.width + 10, 34, 7, "rgba(0, 0, 0, 0.06)");
		}
		context.fillText(run.text, cursorX, y);
		cursorX += context.measureText(run.text).width;
	}
}

function getCanvasFontForRun(type: TextLayoutLine["type"], run: TextRun): string {
	if (run.code || type === "code") {
		return "400 22px monospace";
	}
	if (type === "heading") {
		return "700 34px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
	}
	const weight = run.bold ? "800" : "400";
	return `${weight} 30px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
}

function getCanvasColorForRun(
	type: TextLayoutLine["type"],
	run: TextRun,
	style: MemoShareStyle,
): string {
	if (run.accent) {
		return style.accent;
	}
	if (type === "quote") {
		return style.muted;
	}
	return style.text;
}

function getCanvasLineHeight(line: TextLayoutLine): number {
	if (!line.text) {
		return 20;
	}
	if (line.type === "heading") {
		return 58;
	}
	if (line.type === "code") {
		return 40;
	}
	return 52;
}

function drawCanvasBackground(
	context: CanvasRenderingContext2D,
	style: MemoShareStyle,
	width: number,
	height: number,
): void {
	const gradient = context.createLinearGradient(0, 0, width, height);
	gradient.addColorStop(0, style.cardBackground);
	gradient.addColorStop(0.55, "#ffffff");
	gradient.addColorStop(1, style.border);
	context.fillStyle = gradient;
	context.fillRect(0, 0, width, height);
}

function drawShareCardShell(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	style: MemoShareStyle,
): void {
	context.save();
	context.shadowColor = "rgba(35, 42, 50, 0.24)";
	context.shadowBlur = 36;
	context.shadowOffsetY = 22;
	drawRoundedRect(context, x, y, width, height, 18, style.cardBackground);
	context.restore();

	context.strokeStyle = "rgba(0, 0, 0, 0.07)";
	context.lineWidth = 1;
	context.beginPath();
	context.roundRect(x, y, width, height, 18);
	context.stroke();
}

function drawRule(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	color: string,
): void {
	context.strokeStyle = color;
	context.lineWidth = 1;
	context.beginPath();
	context.moveTo(x, y);
	context.lineTo(x + width, y);
	context.stroke();
}

function drawRoundedRect(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
	fillStyle: string,
): void {
	context.fillStyle = fillStyle;
	context.beginPath();
	context.roundRect(x, y, width, height, radius);
	context.fill();
}

function buildShareSvg(memo: MemoEntry, style: MemoShareStyle, height: number): string {
	const cardHtml = buildShareCardHtml(memo, style, "image");
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_IMAGE_WIDTH}" height="${height}" viewBox="0 0 ${SHARE_IMAGE_WIDTH} ${height}">`,
		"<defs>",
		"<filter id=\"paperShadow\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\">",
		"<feDropShadow dx=\"0\" dy=\"28\" stdDeviation=\"28\" flood-color=\"#000000\" flood-opacity=\"0.16\"/>",
		"</filter>",
		"</defs>",
		`<rect width="100%" height="100%" fill="${escapeXml(style.cardBackground)}"/>`,
		`<foreignObject width="${SHARE_IMAGE_WIDTH}" height="${height}" x="0" y="0">`,
		`<div xmlns="http://www.w3.org/1999/xhtml" style="width:${SHARE_IMAGE_WIDTH}px;height:${height}px;box-sizing:border-box;padding:72px 0;background:${style.background};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">`,
		`<style>${getShareCardImageCss()}</style>`,
		cardHtml,
		"</div>",
		"</foreignObject>",
		"</svg>",
	].join("");
}

function getShareCardImageCss(): string {
	return `
		.memos-share-card{position:relative;width:${SHARE_CARD_WIDTH}px;min-height:520px;margin:0 auto;padding:58px 56px 44px;box-sizing:border-box;border:1px solid var(--share-border);border-radius:4px;background:var(--share-bg);color:var(--share-text);box-shadow:var(--share-shadow);filter:url(#paperShadow);overflow:hidden;}
		.memos-share-card-pin-row{position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-around;height:18px;opacity:.38;}
		.memos-share-card-pin-row span{width:18px;height:11px;border-radius:0 0 12px 12px;background:#fff;}
		.memos-share-card-brand{text-align:center;font-size:30px;line-height:1;font-weight:800;letter-spacing:-.04em;color:var(--share-text);margin:10px 0 46px;}
		.memos-share-card-rule{height:1px;margin:0 0 46px;background:var(--share-border);}
		.memos-share-card-content{font-size:30px;line-height:1.72;color:var(--share-text);overflow-wrap:anywhere;}
		.memos-share-card-content p{margin:0 0 22px;}
		.memos-share-card-content h3{margin:0 0 22px;font-size:34px;line-height:1.42;}
		.memos-share-card-content ul{margin:0 0 22px;padding-left:36px;}
		.memos-share-card-content li{margin:0 0 12px;padding-left:4px;}
		.memos-share-card-content blockquote{margin:0 0 22px;padding:4px 0 4px 22px;border-left:5px solid var(--share-accent);color:var(--share-muted);}
		.memos-share-card-content pre{margin:0 0 22px;padding:20px;border-radius:16px;background:rgba(0,0,0,.055);font-size:22px;line-height:1.55;white-space:pre-wrap;}
		.memos-share-card-content code{padding:2px 8px;border-radius:8px;background:rgba(0,0,0,.06);font-size:.86em;}
		.memos-share-card-content strong{font-weight:800;}
		.memos-share-tag{display:inline-block;padding:0 8px;border-radius:6px;background:color-mix(in srgb,var(--share-accent) 18%,transparent);color:var(--share-text);}
		.memos-share-card-footer{display:flex;justify-content:space-between;gap:20px;margin-top:48px;padding-top:24px;border-top:1px solid var(--share-border);font-size:18px;line-height:1.4;color:var(--share-muted);}
	`.replace(/\s+/g, " ");
}

function buildShareCardHtml(
	memo: MemoEntry,
	style: MemoShareStyle,
	mode: "preview" | "image",
	contentHtml = renderMemoContentHtml(memo.content),
): string {
	const scale = mode === "preview" ? "memos-share-card-preview" : "memos-share-card-image";
	return [
		`<section class="memos-share-card ${scale}" style="--share-bg:${style.cardBackground};--share-text:${style.text};--share-muted:${style.muted};--share-accent:${style.accent};--share-border:${style.border};--share-shadow:${style.shadow};">`,
		"<div class=\"memos-share-card-body\">",
		`<div class="memos-share-card-brand">- ${escapeHtml(style.title)} -</div>`,
		"<div class=\"memos-share-card-rule\"></div>",
		`<article class="memos-share-card-content markdown-rendered">${contentHtml}</article>`,
		"<footer class=\"memos-share-card-footer\">",
		`<span>${escapeHtml(memo.dayKey)} ${escapeHtml(memo.createdLabel)}</span>`,
		`<span>${escapeHtml(memo.sourceBasename)}</span>`,
		"</footer>",
		"</div>",
		"</section>",
	].join("");
}

function renderMemoContentHtml(content: string): string {
	const lines = content.replace(/\r\n/g, "\n").trim().split("\n");
	const html: string[] = [];
	let listItems: string[] = [];
	let codeLines: string[] = [];
	let inCodeBlock = false;

	const flushList = (): void => {
		if (!listItems.length) {
			return;
		}
		html.push(`<ul>${listItems.join("")}</ul>`);
		listItems = [];
	};

	const flushCode = (): void => {
		if (!codeLines.length) {
			return;
		}
		html.push(`<pre>${escapeHtml(codeLines.join("\n"))}</pre>`);
		codeLines = [];
	};

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		if (line.trim().startsWith("```")) {
			if (inCodeBlock) {
				inCodeBlock = false;
				flushCode();
			} else {
				flushList();
				inCodeBlock = true;
			}
			continue;
		}

		if (inCodeBlock) {
			codeLines.push(line);
			continue;
		}

		if (!line.trim()) {
			flushList();
			continue;
		}

		const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
		if (headingMatch) {
			flushList();
			html.push(`<h3>${formatInlineText(headingMatch[2] ?? "")}</h3>`);
			continue;
		}

		const listMatch = line.match(/^[-*+]\s+(?:\[[ xX]\]\s*)?(.+)$/);
		if (listMatch) {
			listItems.push(`<li>${formatInlineText(listMatch[1] ?? "")}</li>`);
			continue;
		}

		flushList();
		if (line.startsWith(">")) {
			html.push(`<blockquote>${formatInlineText(line.replace(/^>\s?/, ""))}</blockquote>`);
		} else {
			html.push(`<p>${formatInlineText(line)}</p>`);
		}
	}

	flushList();
	flushCode();
	return html.join("");
}

function formatInlineText(value: string): string {
	return escapeHtml(value)
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/(^|\s)(#[A-Za-z0-9_/-]+)/g, "$1<span class=\"memos-share-tag\">$2</span>");
}

function estimateShareImageHeight(content: string): number {
	const normalized = content.replace(/\r\n/g, "\n").trim();
	const weightedLines = normalized.split("\n").reduce((total, line) => {
		return total + Math.max(1, Math.ceil(line.length / 34));
	}, 0);
	return Math.min(2400, Math.max(820, 460 + weightedLines * 58));
}

async function renderSvgToPngBlob(svg: string, width: number, height: number): Promise<Blob> {
	const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
	const url = URL.createObjectURL(svgBlob);
	try {
		const image = await loadImage(url);
		const canvas = document.createElement("canvas");
		canvas.width = width * 2;
		canvas.height = height * 2;
		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error("Canvas is unavailable.");
		}
		context.scale(2, 2);
		context.drawImage(image, 0, 0, width, height);
		return await canvasToBlob(canvas);
	} finally {
		URL.revokeObjectURL(url);
	}
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Could not render share image."));
		image.src = url;
	});
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (!blob) {
				reject(new Error("Could not create PNG blob."));
				return;
			}
			resolve(blob);
		}, "image/png");
	});
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;");
}
