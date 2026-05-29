import { App, TFile } from "obsidian";
import { parseDailyNoteToMemos, parseYearlyNoteToMemos } from "./parser";
import type { MemoEntry } from "../types";

export async function loadMemosFromDailyNotes(
	app: App,
	dailyNotesFolder: string,
	timestampFormat: string,
	memoStoreMode: "daily" | "yearly",
	memoReadMode: "all" | "daily" | "yearly",
	memoReadHeading: string,
	excludedFilePath?: string,
): Promise<MemoEntry[]> {
	const effectiveReadMode = memoReadMode === "all" ? "all" : memoReadMode;
	const files = app.vault
		.getMarkdownFiles()
		.filter((file) => isMemoStoreFile(file, dailyNotesFolder, effectiveReadMode))
		.filter((file) => !excludedFilePath || file.path !== excludedFilePath);

	const memoGroups = await Promise.all(
		files.map(async (file) => {
			const content = await app.vault.cachedRead(file);
			if (isYearlyFile(file)) {
				return parseYearlyNoteToMemos(file, content, timestampFormat);
			}
			return parseDailyNoteToMemos(file, content, timestampFormat, memoReadHeading);
		}),
	);

	return memoGroups
		.flat();
}

function isMemoStoreFile(file: TFile, dailyNotesFolder: string, readMode: "all" | "daily" | "yearly"): boolean {
	const normalizedFolder = normalizeFolder(dailyNotesFolder);
	if (!normalizedFolder) {
		return true;
	}
	const inFolder = file.path.startsWith(`${normalizedFolder}/`) || file.parent?.path === normalizedFolder;
	if (!inFolder) {
		return false;
	}
	if (readMode === "all") {
		return true;
	}
	if (readMode === "yearly") {
		return isYearlyFile(file);
	}
	return !isYearlyFile(file);
}

function isYearlyFile(file: TFile): boolean {
	return /^\d{4}$/.test(file.basename);
}

function normalizeFolder(folder: string): string {
	return folder.trim().replace(/^\/+|\/+$/g, "");
}
