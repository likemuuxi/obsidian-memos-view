import { type App, TFile } from "obsidian";

export type WikilinkSuggestion =
	| {
			type: "file";
			file: TFile;
			displayText: string;
			path: string;
	  }
	| {
			type: "heading";
			file: TFile;
			heading: string;
			displayText: string;
			path: string;
	  }
	| {
			type: "block";
			file: TFile;
			blockId: string;
			displayText: string;
			path: string;
	  }
	| {
			type: "paragraph";
			file: TFile;
			displayText: string;
			path: string;
			paragraphText: string;
			appendOffset: number;
	  };

export interface WikilinkContext {
	matchStart: number;
	matchEnd: number;
	rawQuery: string;
	filePart: string;
	filterPart: string;
	separator: "" | "#" | "^";
}

export function parseWikilinkContext(text: string, cursor: number): WikilinkContext | null {
	const textBeforeCursor = text.slice(0, cursor);
	const match = textBeforeCursor.match(/(?:^|[^\[])(\[\[)([^\]]*)$/);
	if (!match || match.index == null) {
		return null;
	}

	const offset = match[0].startsWith("[[") ? 0 : 1;
	const matchStart = match.index + offset;
	const rawQuery = match[2] ?? "";
	const hashIndex = rawQuery.lastIndexOf("#");
	const caretIndex = rawQuery.lastIndexOf("^");

	let separator: "" | "#" | "^" = "";
	let separatorIndex = -1;

	if (hashIndex !== -1) {
		separator = "#";
		separatorIndex = hashIndex;
	} else if (caretIndex !== -1) {
		separator = "^";
		separatorIndex = caretIndex;
	}

	let filePart = rawQuery;
	let filterPart = "";

	if (separator) {
		filePart = rawQuery.slice(0, separatorIndex);
		filterPart = rawQuery.slice(separatorIndex + 1);
	}

	return {
		matchStart,
		matchEnd: cursor,
		rawQuery,
		filePart,
		filterPart,
		separator,
	};
}

export function expandEmptyAnchorToCurrentFile(
	app: App,
	context: WikilinkContext,
	sourcePath: string,
): WikilinkContext {
	if (context.separator !== "#" || context.filePart.trim()) {
		return context;
	}

	const currentFile = app.vault.getAbstractFileByPath(sourcePath);
	if (!(currentFile instanceof TFile)) {
		return context;
	}

	return {
		...context,
		rawQuery: `${currentFile.basename}${context.separator}${context.filterPart}`,
		filePart: currentFile.basename,
	};
}

export async function getWikilinkSuggestions(
	app: App,
	context: WikilinkContext,
	sourcePath: string,
	explicitTargetPath?: string | null,
	limit = 10,
): Promise<WikilinkSuggestion[]> {
	const normalizedFilePart = context.filePart.trim().toLowerCase();
	const normalizedFilterPart = context.filterPart.trim().toLowerCase();

	if (context.separator === "#" || context.separator === "^") {
		const targetFile = resolveTargetFile(app, context.filePart.trim(), sourcePath, explicitTargetPath);
		if (!targetFile) {
			return [];
		}

		const cache = app.metadataCache.getFileCache(targetFile);
		if (!cache) {
			return [];
		}

		if (context.separator === "#") {
			const isParagraphMode = normalizedFilterPart.startsWith("^");
			const headingFilter = normalizedFilterPart;
			const paragraphFilter = isParagraphMode ? normalizedFilterPart.slice(1) : normalizedFilterPart;
			const headings = cache.headings ?? [];
			const headingSuggestions = isParagraphMode
				? []
				: headings
				.filter((heading) =>
					!headingFilter ||
					heading.heading.toLowerCase().includes(headingFilter),
				)
				.slice(0, limit)
				.map((heading) => ({
					type: "heading" as const,
					file: targetFile,
					heading: heading.heading,
					displayText: heading.heading,
					path: targetFile.path,
				}));

			if (isParagraphMode) {
				return await getParagraphSuggestions(app, targetFile, paragraphFilter, limit);
			}

			const blockSuggestions = Object.keys(cache.blocks ?? {})
				.filter((blockId) => !normalizedFilterPart || blockId.toLowerCase().includes(normalizedFilterPart))
				.slice(0, limit)
				.map((blockId) => ({
					type: "block" as const,
					file: targetFile,
					blockId,
					displayText: `^${blockId}`,
					path: targetFile.path,
				}));

			return [...headingSuggestions, ...blockSuggestions].slice(0, limit);
		}

		return Object.keys(cache.blocks ?? {})
			.filter((blockId) => !normalizedFilterPart || blockId.toLowerCase().includes(normalizedFilterPart))
			.slice(0, limit)
			.map((blockId) => ({
				type: "block" as const,
				file: targetFile,
				blockId,
				displayText: blockId,
				path: targetFile.path,
			}));
	}

	return app.vault
		.getMarkdownFiles()
		.map((file) => ({
			file,
			score: scoreFileSuggestion(file, normalizedFilePart, sourcePath),
		}))
		.filter((entry) => entry.score > Number.NEGATIVE_INFINITY)
		.sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path))
		.slice(0, limit)
		.map((entry) => ({
			type: "file" as const,
			file: entry.file,
			displayText: entry.file.basename,
			path: entry.file.path,
		}));
}

export function buildWikilinkText(item: WikilinkSuggestion): string {
	const alias = item.file.basename;
	const linkPath = toObsidianLinkPath(item.path);
	if (item.type === "file") {
		return `[[${linkPath}|${alias}]]`;
	}
	if (item.type === "heading") {
		return `[[${linkPath}#${item.heading}|${alias}]]`;
	}
	if (item.type === "paragraph") {
		return `[[${linkPath}|${alias}]]`;
	}
	return `[[${linkPath}#^${item.blockId}|${alias}]]`;
}

export function applyWikilinkSuggestion(
	text: string,
	cursor: number,
	context: WikilinkContext,
	item: WikilinkSuggestion,
): { newText: string; newCursor: number } {
	const before = text.slice(0, context.matchStart);
	const after = text.slice(cursor);
	const replacement = buildWikilinkText(item);
	const newText = `${before}${replacement}${after}`;
	return {
		newText,
		newCursor: before.length + replacement.length,
	};
}

function resolveTargetFile(
	app: App,
	filePart: string,
	sourcePath: string,
	explicitTargetPath?: string | null,
): TFile | null {
	if (explicitTargetPath) {
		const explicitFile = app.vault.getAbstractFileByPath(explicitTargetPath);
		if (explicitFile instanceof TFile) {
			return explicitFile;
		}
	}

	const trimmed = filePart.trim();
	if (!trimmed) {
		const currentFile = app.vault.getAbstractFileByPath(sourcePath);
		return currentFile instanceof TFile ? currentFile : null;
	}

	const directMatch = app.metadataCache.getFirstLinkpathDest(trimmed, sourcePath);
	if (directMatch) {
		return directMatch;
	}

	const normalizedQuery = trimmed.toLowerCase();
	const fallbackMatch = app.vault
		.getMarkdownFiles()
		.map((file) => ({
			file,
			score: scoreFileSuggestion(file, normalizedQuery, sourcePath),
		}))
		.filter((entry) => entry.score > Number.NEGATIVE_INFINITY)
		.sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path))
		.at(0);

	return fallbackMatch?.file ?? null;
}

function scoreFileSuggestion(file: TFile, query: string, sourcePath: string): number {
	if (!query) {
		return file.path === sourcePath ? 120 : file.parent?.path === getParentPath(sourcePath) ? 100 : 80;
	}

	const basename = file.basename.toLowerCase();
	const path = file.path.toLowerCase();
	let score = Number.NEGATIVE_INFINITY;

	if (basename === query) {
		score = 400;
	} else if (basename.startsWith(query)) {
		score = 320 - basename.length;
	} else if (path.startsWith(query)) {
		score = 260 - path.length;
	} else if (basename.includes(query)) {
		score = 220 - basename.indexOf(query);
	} else if (path.includes(query)) {
		score = 180 - path.indexOf(query);
	}

	if (score === Number.NEGATIVE_INFINITY) {
		return score;
	}

	if (file.path === sourcePath) {
		score += 25;
	}

	if (file.parent?.path === getParentPath(sourcePath)) {
		score += 10;
	}

	return score;
}

function getParentPath(path: string): string {
	const normalized = path.replace(/\\/g, "/");
	const lastSlash = normalized.lastIndexOf("/");
	return lastSlash === -1 ? "" : normalized.slice(0, lastSlash);
}

async function getParagraphSuggestions(
	app: App,
	file: TFile,
	filter: string,
	limit: number,
): Promise<WikilinkSuggestion[]> {
	try {
		const content = await app.vault.cachedRead(file);
		const paragraphs = extractParagraphBlocks(content);
		const normalizedFilter = filter.trim().toLowerCase();
		return paragraphs
			.filter((paragraph) =>
				!normalizedFilter || paragraph.paragraphText.toLowerCase().includes(normalizedFilter),
			)
			.slice(0, limit)
			.map((paragraph) => ({
				type: "paragraph" as const,
				file,
				displayText: paragraph.paragraphText,
				path: file.path,
				paragraphText: paragraph.paragraphText,
				appendOffset: paragraph.appendOffset,
			}));
	} catch {
		return [];
	}
}

function extractParagraphBlocks(content: string): Array<{ paragraphText: string; appendOffset: number }> {
	const normalized = content.replace(/\r\n/g, "\n");
	const bodyStart = getBodyStartOffset(normalized);
	const lines = normalized.slice(bodyStart).split("\n");
	const paragraphs: Array<{ paragraphText: string; appendOffset: number }> = [];
	let offset = bodyStart;
	let currentLines: string[] = [];
	let lastLineEnd = bodyStart;

	const flush = (): void => {
		if (!currentLines.length) {
			return;
		}

		const paragraphText = currentLines.join(" ").replace(/\s+/g, " ").trim();
		const alreadyHasBlockId = /\s\^[A-Za-z0-9_-]+\s*$/.test(currentLines.at(-1) ?? "");
		const isHeading = /^#{1,6}\s/.test(currentLines[0] ?? "");
		if (paragraphText && !alreadyHasBlockId && !isHeading) {
			paragraphs.push({
				paragraphText,
				appendOffset: lastLineEnd,
			});
		}

		currentLines = [];
	};

	for (const line of lines) {
		const lineEnd = offset + line.length;
		if (line.trim()) {
			currentLines.push(line.trim());
			lastLineEnd = lineEnd;
		} else {
			flush();
		}

		offset = lineEnd + 1;
	}

	flush();
	return paragraphs;
}

function getBodyStartOffset(content: string): number {
	if (!content.startsWith("---")) {
		return 0;
	}

	const frontmatterEnd = content.indexOf("\n---", 3);
	if (frontmatterEnd === -1) {
		return 0;
	}

	let bodyStart = frontmatterEnd + 4;
	while (bodyStart < content.length && /\s/.test(content[bodyStart] ?? "")) {
		bodyStart += 1;
	}

	return bodyStart;
}

export function createBlockId(existingIds: Iterable<string>): string {
	const existing = new Set(Array.from(existingIds, (id) => id.toLowerCase()));
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const candidate = Math.random().toString(36).slice(2, 8);
		if (!existing.has(candidate.toLowerCase())) {
			return candidate;
		}
	}

	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
}

function toObsidianLinkPath(path: string): string {
	return path.toLowerCase().endsWith(".md") ? path.slice(0, -3) : path;
}
