export const VIEW_TYPE_MEMOS = "memos-view";

export interface MemosPluginSettings {
	boundFilePath: string;
	displayName: string;
	timestampFormat: string;
}

export interface MemoEntry {
	id: string;
	content: string;
	sourcePath: string;
	sourceBasename: string;
	sourceIndex: number;
	sourceLine: number;
	tags: string[];
	createdAt: number;
	createdLabel: string;
	updatedAt: number;
	dayKey: string;
	deletedAt: string | null;
	archivedAt: string | null;
	pinnedAt: string | null;
}

export interface MemosViewState extends Record<string, unknown> {
	boundFilePath?: string;
}

export interface DailyNotesConfig {
	folder: string;
	format: string;
	template?: string;
}
