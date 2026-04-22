import { TFile } from "obsidian";
import type { MemoEntry } from "../types";

const DATE_IN_FILE_NAME = /(\d{4})-(\d{2})-(\d{2})/;
const TAG_PATTERN = /(^|\s)#([A-Za-z0-9_/-]+)/g;
const TOP_LEVEL_LIST_ITEM_PATTERN = /^[-*+]\s+/m;
const STATUS_MARKER_PATTERN = /\[(deleted|archived)::(\d{14})\]/gi;

export type MemoStatusKey = "deleted" | "archived";

export interface MemoStatusState {
	deletedAt: string | null;
	archivedAt: string | null;
}

export interface MemoBlockRange {
	raw: string;
	start: number;
	end: number;
	line: number;
}

export function parseDailyNoteToMemos(file: TFile, content: string, timestampFormat: string): MemoEntry[] {
	const normalizedBody = splitFrontmatter(content).body.replace(/\r\n/g, "\n").trim();
	if (!normalizedBody) {
		return [];
	}

	const fileDayTimestamp = getFileDayTimestamp(file);
	const dayKey = formatDayKey(fileDayTimestamp);
	const bodyLineOffset = getBodyLineOffset(content);
	const blocks = getMemoBlockRanges(content)
		.map((block, sourceIndex) => {
			const parsedBlock = parseMemoBlock(block.raw, timestampFormat);
			if (!parsedBlock) {
				return null;
			}

			const createdAt = createMemoTimestamp(fileDayTimestamp, parsedBlock.timestampLabel);
			return {
				sourceIndex,
				sourceLine: bodyLineOffset + block.line,
				content: parsedBlock.content,
				timestampLabel: parsedBlock.timestampLabel,
				createdAt,
				deletedAt: parsedBlock.deletedAt,
				archivedAt: parsedBlock.archivedAt,
			};
		})
		.filter(
			(
				block,
			): block is {
				sourceIndex: number;
				sourceLine: number;
				content: string;
				timestampLabel: string;
				createdAt: number;
				deletedAt: string | null;
				archivedAt: string | null;
			} => Boolean(block),
		);

	return blocks.map((block, index) => ({
		id: `${file.path}::${index}`,
		content: block.content,
		sourcePath: file.path,
		sourceBasename: file.basename,
		sourceIndex: block.sourceIndex,
		sourceLine: block.sourceLine,
		tags: extractTags(block.content),
		createdAt: block.createdAt,
		createdLabel: block.timestampLabel,
		updatedAt: file.stat.mtime,
		dayKey,
		deletedAt: block.deletedAt,
		archivedAt: block.archivedAt,
	}));
}

export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
	if (!content.startsWith("---")) {
		return { frontmatter: "", body: content };
	}

	const frontmatterEnd = content.indexOf("\n---", 3);
	if (frontmatterEnd === -1) {
		return { frontmatter: "", body: content };
	}

	const bodyStart = frontmatterEnd + 4;
	return {
		frontmatter: content.slice(0, bodyStart).trimEnd(),
		body: content.slice(bodyStart).trimStart(),
	};
}

export function splitMemoBlocks(content: string): string[] {
	return getMemoBlockRanges(content).map((block) => block.raw);
}

export function getMemoBlockRanges(content: string): MemoBlockRange[] {
	const normalizedBody = splitFrontmatter(content).body.replace(/\r\n/g, "\n").trim();
	if (!normalizedBody) {
		return [];
	}

	const ranges: MemoBlockRange[] = [];
	const lines = normalizedBody.split("\n");
	let offset = 0;
	let lineNumber = 0;
	let currentStart = -1;
	let currentLine = 0;
	let currentLines: string[] = [];

	const flush = (): void => {
		if (currentStart === -1 || !currentLines.length) {
			currentStart = -1;
			currentLines = [];
			return;
		}

		while (currentLines.length) {
			const lastLine = currentLines.at(-1);
			if (lastLine === undefined || lastLine.trim()) {
				break;
			}

			currentLines.pop();
		}

		if (!currentLines.length) {
			currentStart = -1;
			currentLines = [];
			return;
		}

		const raw = currentLines.join("\n");
		ranges.push({
			raw,
			start: currentStart,
			end: currentStart + raw.length,
			line: currentLine,
		});
		currentStart = -1;
		currentLines = [];
	};

	for (const line of lines) {
		const isTopLevelListItem = TOP_LEVEL_LIST_ITEM_PATTERN.test(line);
		const isContinuationLine = currentStart !== -1 && (!line.trim() || /^\s+/.test(line));

		if (isTopLevelListItem) {
			flush();
			currentStart = offset;
			currentLine = lineNumber;
			currentLines = [line];
		} else if (isContinuationLine) {
			currentLines.push(line);
		} else {
			flush();
		}

		offset += line.length + 1;
		lineNumber += 1;
	}

	flush();
	return ranges;
}

export function parseMemoBlock(
	block: string,
	timestampFormat = "HH:mm",
): { timestampLabel: string; content: string } & MemoStatusState | null {
	const trimmed = block.trim();
	if (!trimmed) {
		return null;
	}

	const [firstLine = "", ...restLines] = trimmed.split("\n");
	const markerMatch = firstLine.match(/^[-*+]\s+(.*)$/);
	if (!markerMatch) {
		return null;
	}

	const markerContent = markerMatch[1];
	if (!markerContent) {
		return null;
	}

	const timestampMatch = markerContent.trim().match(createTimestampPattern(timestampFormat));
	if (!timestampMatch) {
		return null;
	}

	const timestampLabel = extractTimestampLabel(timestampMatch.groups, timestampFormat);
	if (!timestampLabel) {
		return null;
	}
	const firstLineContent = timestampMatch.groups?.content?.trimEnd() ?? "";
	const contentLines = [
		firstLineContent,
		...restLines.map((line) => {
			if (!line.trim()) {
				return "";
			}

			return line.replace(/^(?: {2}|\t)/, "").trimEnd();
		}),
	];
	const cleaned = trimEmptyLines(contentLines).join("\n").trim();
	const parsedContent = stripMemoStatusMarkers(cleaned);
	if (!parsedContent.content) {
		return null;
	}

	return {
		timestampLabel,
		content: parsedContent.content,
		deletedAt: parsedContent.deletedAt,
		archivedAt: parsedContent.archivedAt,
	};
}

export function serializeMemoBlock(
	content: string,
	timestampLabel: string,
	status: Partial<MemoStatusState> = {},
): string {
	const normalizedContent = buildMemoContentWithStatus(content, status);
	const indentedContent = normalizedContent
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");

	return `- ${timestampLabel}\n${indentedContent}`;
}

export function buildMemoContentWithStatus(
	content: string,
	status: Partial<MemoStatusState> = {},
): string {
	const normalizedContent = content.replace(/\r\n/g, "\n").trim();
	const markers = buildStatusMarkers(status);
	return [normalizedContent, ...markers].filter(Boolean).join("\n");
}

export function setMemoStatusValue(
	status: MemoStatusState,
	key: MemoStatusKey,
	value: string | null,
): MemoStatusState {
	if (key === "deleted") {
		return {
			deletedAt: value,
			archivedAt: status.archivedAt,
		};
	}

	return {
		deletedAt: status.deletedAt,
		archivedAt: value,
	};
}

export function createMemoStatusTimestamp(date: Date = new Date()): string {
	const year = String(date.getFullYear()).padStart(4, "0");
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");
	return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function extractTags(content: string): string[] {
	const tags = new Set<string>();
	for (const match of content.matchAll(TAG_PATTERN)) {
		const tag = match[2];
		if (tag) {
			tags.add(`#${tag}`);
		}
	}

	return [...tags];
}

function stripMemoStatusMarkers(content: string): { content: string } & MemoStatusState {
	const status: MemoStatusState = {
		deletedAt: null,
		archivedAt: null,
	};
	const contentWithoutMarkers = content.replace(STATUS_MARKER_PATTERN, (_, rawKey: string, rawValue: string) => {
		const key = rawKey.toLowerCase() as MemoStatusKey;
		if (key === "deleted") {
			status.deletedAt = rawValue;
		}
		if (key === "archived") {
			status.archivedAt = rawValue;
		}
		return "";
	});

	return {
		content: contentWithoutMarkers
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim(),
		deletedAt: status.deletedAt,
		archivedAt: status.archivedAt,
	};
}

function buildStatusMarkers(status: Partial<MemoStatusState>): string[] {
	const markers: string[] = [];
	if (status.archivedAt) {
		markers.push(`[archived::${status.archivedAt}]`);
	}
	if (status.deletedAt) {
		markers.push(`[deleted::${status.deletedAt}]`);
	}
	return markers;
}

function getFileDayTimestamp(file: TFile): number {
	const dateMatch = file.basename.match(DATE_IN_FILE_NAME);
	if (dateMatch) {
		const [, year, month, day] = dateMatch;
		return new Date(`${year}-${month}-${day}T00:00:00`).getTime();
	}

	return file.stat.mtime;
}

function createMemoTimestamp(dayTimestamp: number, timestampLabel: string): number {
	const timeParts = timestampLabel.match(/(\d{1,2})/g)?.map((value) => Number(value)) ?? [];
	const hours = timeParts[0];
	const minutes = timeParts[1] ?? 0;
	const seconds = timeParts[2] ?? 0;
	if (hours === undefined) {
		return dayTimestamp;
	}

	const memoDate = new Date(dayTimestamp);
	memoDate.setHours(hours, minutes, seconds, 0);
	return memoDate.getTime();
}

function formatDayKey(timestamp: number): string {
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function getBodyLineOffset(content: string): number {
	const normalizedContent = content.replace(/\r\n/g, "\n");
	let bodyStart = 0;

	if (normalizedContent.startsWith("---")) {
		const frontmatterEnd = normalizedContent.indexOf("\n---", 3);
		if (frontmatterEnd !== -1) {
			bodyStart = frontmatterEnd + 4;
		}
	}

	const bodyWithLeadingWhitespace = normalizedContent.slice(bodyStart);
	const trimmedBody = bodyWithLeadingWhitespace.trimStart();
	const removedPrefixLength = bodyWithLeadingWhitespace.length - trimmedBody.length;
	return countNewlines(normalizedContent.slice(0, bodyStart + removedPrefixLength));
}

function createTimestampPattern(timestampFormat: string): RegExp {
	const normalizedFormat = timestampFormat || "HH:mm";
	const escaped = normalizedFormat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = escaped
		.replace(/HH/g, "(?<HH>\\d{1,2})")
		.replace(/mm/g, "(?<mm>\\d{2})")
		.replace(/ss/g, "(?<ss>\\d{2})");
	return new RegExp(`^${pattern}(?:\\s+(?<content>.*))?$`);
}

function extractTimestampLabel(
	groups: Record<string, string> | undefined,
	timestampFormat: string,
): string | null {
	if (!groups) {
		return null;
	}

	const hours = groups.HH;
	const minutes = groups.mm;
	const seconds = groups.ss;
	if (!hours || !minutes) {
		return null;
	}

	return timestampFormat
		.replace(/HH/g, hours.padStart(2, "0"))
		.replace(/mm/g, minutes.padStart(2, "0"))
		.replace(/ss/g, (seconds ?? "00").padStart(2, "0"));
}

function trimEmptyLines(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;

	while (start < end) {
		const currentLine = lines[start];
		if (currentLine === undefined || currentLine.trim()) {
			break;
		}

		start += 1;
	}

	while (end > start) {
		const currentLine = lines[end - 1];
		if (currentLine === undefined || currentLine.trim()) {
			break;
		}

		end -= 1;
	}

	return lines.slice(start, end);
}

function countNewlines(value: string): number {
	if (!value) {
		return 0;
	}

	return value.split("\n").length - 1;
}
