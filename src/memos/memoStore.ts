import { App, TFile } from "obsidian";
import { parseDailyNoteToMemos } from "./parser";
import type { MemoEntry } from "../types";

export async function loadMemosFromDailyNotes(
	app: App,
	dailyNotesFolder: string,
	timestampFormat: string,
	excludedFilePath?: string,
): Promise<MemoEntry[]> {
	const files = app.vault
		.getMarkdownFiles()
		.filter((file) => isDailyNoteFile(file, dailyNotesFolder))
		.filter((file) => !excludedFilePath || file.path !== excludedFilePath);

	const memoGroups = await Promise.all(
		files.map(async (file) => {
			const content = await app.vault.cachedRead(file);
			return parseDailyNoteToMemos(file, content, timestampFormat);
		}),
	);

	return memoGroups
		.flat();
}

function isDailyNoteFile(file: TFile, dailyNotesFolder: string): boolean {
	const normalizedFolder = normalizeFolder(dailyNotesFolder);
	if (!normalizedFolder) {
		return true;
	}

	return file.path.startsWith(`${normalizedFolder}/`) || file.parent?.path === normalizedFolder;
}

function normalizeFolder(folder: string): string {
	return folder.trim().replace(/^\/+|\/+$/g, "");
}
