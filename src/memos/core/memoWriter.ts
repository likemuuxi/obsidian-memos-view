import { App, Notice, TFile } from "obsidian";
import {
	createMemoStatusTimestamp,
	getMemoBlockRanges,
	parseMemoBlock,
	type MemoStatusKey,
	type MemoStatusState,
	setMemoStatusValue,
	splitFrontmatter,
} from "./parser";
import type { MemoEntry } from "../../types";
import { t } from "../../i18n";

/**
 * 备忘录文件写入服务:封装 frontmatter 拆分/重组、memo 块定位与替换的重复逻辑。
 * 所有操作均为纯函数(传入 rawContent,返回新内容),不直接触碰 vault。
 */

/** 重组文件内容:frontmatter + body,处理空 body 情况 */
export function composeFileContent(frontmatter: string, body: string): string {
	if (!frontmatter) {
		return body;
	}
	return body ? `${frontmatter}\n\n${body}` : frontmatter;
}

/** 定位并读取单个 memo 块;失败时返回 null 并弹出对应 Notice */
export function locateMemoBlock(
	rawContent: string,
	sourceIndex: number,
	timestampFormat: string,
) {
	const ranges = getMemoBlockRanges(rawContent);
	if (sourceIndex < 0 || sourceIndex >= ranges.length) {
		new Notice(t("notices.couldNotLocateBlock"));
		return null;
	}

	const targetRange = ranges[sourceIndex];
	if (!targetRange) {
		new Notice(t("notices.couldNotLocateBlock"));
		return null;
	}

	const parsedBlock = parseMemoBlock(targetRange.raw, timestampFormat);
	if (!parsedBlock) {
		new Notice(t("notices.couldNotParseBlock"));
		return null;
	}

	return { ranges, targetRange, parsedBlock };
}

/** 用新块文本替换 body 中指定范围的旧块 */
export function replaceBlockInRange(
	normalizedBody: string,
	start: number,
	end: number,
	nextBlock: string,
): string {
	return `${normalizedBody.slice(0, start)}${nextBlock}${normalizedBody.slice(end)}`.trim();
}

/** 从 body 中删除指定范围的块,并清理多余空行 */
export function removeBlockFromRange(
	normalizedBody: string,
	start: number,
	end: number,
): string {
	return `${normalizedBody.slice(0, start)}${normalizedBody.slice(end)}`
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** 读取文件原始内容并拆分为 frontmatter + 规范化 body;文件不存在返回 null */
export async function readFileForRewrite(
	app: App,
	path: string,
): Promise<{ file: TFile; rawContent: string; frontmatter: string; normalizedBody: string } | null> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		new Notice(t("notices.sourceFileNoLongerExists"));
		return null;
	}

	const rawContent = await app.vault.cachedRead(file);
	const { frontmatter, body } = splitFrontmatter(rawContent);
	const normalizedBody = body.replace(/\r\n/g, "\n").trim();
	return { file, rawContent, frontmatter, normalizedBody };
}

/**
 * 重写单个 memo 块:定位 → 用 transform 计算新块 → 拼回文件内容。
 * 返回目标文件与组装好的完整文件内容,或 null(定位失败/文件不存在)。
 */
export async function rewriteMemoBlock(
	app: App,
	memo: MemoEntry,
	timestampFormat: string,
	transform: (parsedBlock: NonNullable<ReturnType<typeof parseMemoBlock>>, range: { start: number; end: number }) => string,
): Promise<{ file: TFile; content: string } | null> {
	const ctx = await readFileForRewrite(app, memo.sourcePath);
	if (!ctx) {
		return null;
	}

	const located = locateMemoBlock(ctx.rawContent, memo.sourceIndex, timestampFormat);
	if (!located) {
		return null;
	}

	const nextBlock = transform(located.parsedBlock, located.targetRange);
	const nextBody = replaceBlockInRange(ctx.normalizedBody, located.targetRange.start, located.targetRange.end, nextBlock);
	return { file: ctx.file, content: composeFileContent(ctx.frontmatter, nextBody) };
}

/** 构造下一个 memo 状态(用于 delete/archive/pin 切换) */
export function buildNextMemoStatus(
	parsedBlock: NonNullable<ReturnType<typeof parseMemoBlock>>,
	key: MemoStatusKey,
	enabled: boolean,
): MemoStatusState {
	return setMemoStatusValue(
		{
			deletedAt: parsedBlock.deletedAt,
			archivedAt: parsedBlock.archivedAt,
			pinnedAt: parsedBlock.pinnedAt,
		},
		key,
		enabled ? createMemoStatusTimestamp() : null,
	);
}
