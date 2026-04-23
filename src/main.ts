import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import {
	createMemoStatusTimestamp,
	getMemoBlockRanges,
	parseMemoBlock,
	type MemoStatusKey,
	serializeMemoBlock,
	setMemoStatusValue,
	splitFrontmatter,
} from "./memos/parser";
import { MemosView } from "./memos/MemosView";
import { DEFAULT_SETTINGS, MemosSettingTab } from "./settings";
import { VIEW_TYPE_MEMOS } from "./types";
import type { DailyNotesConfig, MemoEntry, MemosPluginSettings } from "./types";

export default class MemosViewPlugin extends Plugin {
	settings: MemosPluginSettings = DEFAULT_SETTINGS;
	dailyNotesConfig: DailyNotesConfig | null = null;
	private pendingBoundFileTimer: number | null = null;
	private suppressedVaultRefreshUntil = new Map<string, number>();

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.loadDailyNotesConfig();

		this.registerView(
			VIEW_TYPE_MEMOS,
			(leaf) => new MemosView(leaf, this),
		);

		this.addRibbonIcon("lightbulb", "Open memos view", () => {
			void this.activateMemosView();
		});

		this.addCommand({
			id: "open-memos-view",
			name: "Open memos view",
			callback: () => {
				void this.activateMemosView();
			},
		});

		this.addCommand({
			id: "refresh-memos-view",
			name: "Refresh memos view",
			callback: () => {
				void this.refreshAllMemosViews();
			},
		});

		this.addCommand({
			id: "random-walk-memo",
			name: "Random walk memo",
			callback: () => {
				void this.startRandomWalk();
			},
		});

		this.addSettingTab(new MemosSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				this.scheduleBoundFileActivation(file);
			}),
		);

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				const file = leaf?.view instanceof MarkdownView ? leaf.view.file : null;
				this.scheduleBoundFileActivation(file);
			}),
		);

		this.registerEvent(this.app.vault.on("create", (file) => this.handleVaultChange(file)));
		this.registerEvent(this.app.vault.on("modify", (file) => this.handleVaultChange(file)));
		this.registerEvent(this.app.vault.on("delete", (file) => this.handleVaultChange(file)));
		this.registerEvent(this.app.vault.on("rename", (file) => this.handleVaultChange(file)));
	}

	async onunload(): Promise<void> {
		if (this.pendingBoundFileTimer !== null) {
			window.clearTimeout(this.pendingBoundFileTimer);
			this.pendingBoundFileTimer = null;
		}

		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMOS);
		for (const leaf of leaves) {
			await leaf.setViewState({ type: "empty" });
		}
	}

	async loadSettings(): Promise<void> {
		const rawData = await this.loadData() as Partial<MemosPluginSettings> & {
			boundFilePaths?: string[];
			maxMemos?: number;
		};
		const { boundFilePaths, maxMemos: _legacyMaxMemos, ...restData } = rawData;
		const migratedBoundFilePath =
			restData.boundFilePath ??
			(boundFilePaths && boundFilePaths.length ? boundFilePaths[0] : "");
		const data = Object.assign({}, DEFAULT_SETTINGS, restData, {
			boundFilePath: migratedBoundFilePath,
		});
		this.settings = {
			...data,
			boundFilePath: this.normalizeBoundPath(data.boundFilePath),
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async activateMemosView(boundFilePath?: string, leaf?: WorkspaceLeaf): Promise<void> {
		const targetLeaf = leaf ?? this.app.workspace.getLeaf(false);
		if (!targetLeaf) {
			new Notice("No workspace leaf available.");
			return;
		}

		await targetLeaf.setViewState({
			type: VIEW_TYPE_MEMOS,
			active: true,
			state: { boundFilePath },
		});
		this.app.workspace.revealLeaf(targetLeaf);
	}

	async refreshAllMemosViews(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMOS);
		await Promise.all(
			leaves.map(async (leaf) => {
				if (leaf.view instanceof MemosView) {
					await leaf.view.refresh();
				}
			}),
		);
	}

	suppressVaultRefresh(path: string, durationMs = 400): void {
		this.suppressedVaultRefreshUntil.set(path, Date.now() + durationMs);
	}

	async startRandomWalk(): Promise<void> {
		const memosView = await this.getOrCreateMemosView();
		if (!memosView) {
			new Notice("Could not open memos view.");
			return;
		}

		await memosView.startRandomWalk();
	}

	async openSourceFile(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice("Source file no longer exists.");
			return;
		}

		await this.app.workspace.getLeaf(true).openFile(file);
	}

	async openSourceFileAtLine(path: string, line: number): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice("Source file no longer exists.");
			return;
		}

		const leaf = this.app.workspace.getLeaf(false);
		if (!leaf) {
			new Notice("No workspace leaf available.");
			return;
		}

		const leafWithOpenFile = leaf as WorkspaceLeaf & {
			openFile?: (
				file: TFile,
				options?: {
					eState?: { line: number; mode: string };
				},
			) => Promise<void>;
		};
		if (leafWithOpenFile.openFile) {
			await leafWithOpenFile.openFile(file, {
				eState: {
					line,
					mode: "source",
				},
			});
			return;
		}

		await leaf.openFile(file, {
			eState: {
				line,
				mode: "source",
			},
		});
	}

	async loadDailyNotesConfig(): Promise<void> {
		const configPath = normalizePath(`${this.app.vault.configDir}/daily-notes.json`);
		try {
			const raw = await this.app.vault.adapter.read(configPath);
			const parsed = JSON.parse(raw) as Partial<DailyNotesConfig>;
			this.dailyNotesConfig = {
				folder: (parsed.folder ?? "").trim(),
				format: (parsed.format ?? "YYYY-MM-DD").trim(),
				template: parsed.template,
			};
		} catch (error) {
			this.dailyNotesConfig = null;
			console.error("Failed to read daily-notes config", error);
		}
	}

	getDailyNotesFolder(): string {
		return this.dailyNotesConfig?.folder ?? "";
	}

	getTodayDailyNotePath(): string {
		const folder = this.getDailyNotesFolder();
		const fileName = this.formatDateByPattern(new Date(), this.dailyNotesConfig?.format ?? "YYYY-MM-DD");
		return normalizePath(folder ? `${folder}/${fileName}.md` : `${fileName}.md`);
	}

	async appendMemoToToday(content: string): Promise<void> {
		const normalized = content.trim();
		if (!normalized) {
			return;
		}

		const folder = this.getDailyNotesFolder();
		const fileName = this.formatDateByPattern(new Date(), this.dailyNotesConfig?.format ?? "YYYY-MM-DD");
		const filePath = normalizePath(folder ? `${folder}/${fileName}.md` : `${fileName}.md`);
		const existing = this.app.vault.getAbstractFileByPath(filePath);
		const timestampLabel = this.formatTimeByPattern(new Date(), this.settings.timestampFormat);
		const payload = serializeMemoBlock(normalized, timestampLabel);

		if (existing instanceof TFile) {
			const rawContent = await this.app.vault.cachedRead(existing);
			const { frontmatter, body } = splitFrontmatter(rawContent);
			const normalizedBody = body.replace(/\r\n/g, "\n").trim();
			const nextBody = normalizedBody ? `${payload}\n\n${normalizedBody}` : payload;
			const nextFileContent = frontmatter
				? `${frontmatter}\n\n${nextBody}`
				: nextBody;
			await this.app.vault.modify(existing, nextFileContent);
		} else {
			if (folder) {
				await this.app.vault.createFolder(folder).catch(() => undefined);
			}
			await this.app.vault.create(filePath, payload);
		}

		await this.refreshAllMemosViews();
	}

	async updateMemoEntry(memo: MemoEntry, nextContent: string): Promise<void> {
		const normalized = nextContent.trim();
		if (!normalized) {
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(memo.sourcePath);
		if (!(file instanceof TFile)) {
			new Notice("Source file no longer exists.");
			return;
		}

		const rawContent = await this.app.vault.cachedRead(file);
		const { frontmatter, body } = splitFrontmatter(rawContent);
		const normalizedBody = body.replace(/\r\n/g, "\n").trim();
		const ranges = getMemoBlockRanges(rawContent);
		if (memo.sourceIndex < 0 || memo.sourceIndex >= ranges.length) {
			new Notice("Could not locate the original memo block.");
			return;
		}

		const targetRange = ranges[memo.sourceIndex];
		if (!targetRange) {
			new Notice("Could not locate the original memo block.");
			return;
		}

		const parsedBlock = parseMemoBlock(targetRange.raw, this.settings.timestampFormat);
		if (!parsedBlock) {
			new Notice("Could not parse the original memo block.");
			return;
		}

		const nextBlock = serializeMemoBlock(normalized, parsedBlock.timestampLabel, {
			deletedAt: parsedBlock.deletedAt,
			archivedAt: parsedBlock.archivedAt,
			pinnedAt: parsedBlock.pinnedAt,
		});
		const nextBody = `${normalizedBody.slice(0, targetRange.start)}${nextBlock}${normalizedBody.slice(targetRange.end)}`.trim();
		const nextFileContent = frontmatter
			? nextBody
				? `${frontmatter}\n\n${nextBody}`
				: frontmatter
			: nextBody;

		await this.app.vault.modify(file, nextFileContent);
		await this.refreshAllMemosViews();
	}

	async deleteMemoEntry(memo: MemoEntry): Promise<void> {
		await this.updateMemoStatus(memo, "deleted", !memo.deletedAt);
	}

	async archiveMemoEntry(memo: MemoEntry): Promise<void> {
		await this.updateMemoStatus(memo, "archived", !memo.archivedAt);
	}

	async pinMemoEntry(memo: MemoEntry): Promise<void> {
		await this.updateMemoStatus(memo, "pinned", !memo.pinnedAt);
	}

	async permanentlyDeleteMarkedMemos(memos: MemoEntry[]): Promise<void> {
		const memoGroups = new Map<string, MemoEntry[]>();
		memos.forEach((memo) => {
			const currentGroup = memoGroups.get(memo.sourcePath) ?? [];
			currentGroup.push(memo);
			memoGroups.set(memo.sourcePath, currentGroup);
		});

		for (const [sourcePath, groupMemos] of memoGroups.entries()) {
			const file = this.app.vault.getAbstractFileByPath(sourcePath);
			if (!(file instanceof TFile)) {
				continue;
			}

			const rawContent = await this.app.vault.cachedRead(file);
			const { frontmatter, body } = splitFrontmatter(rawContent);
			let normalizedBody = body.replace(/\r\n/g, "\n").trim();
			const ranges = getMemoBlockRanges(rawContent);
			const targetMemos = [...groupMemos].sort((left, right) => right.sourceIndex - left.sourceIndex);

			for (const memo of targetMemos) {
				if (memo.sourceIndex < 0 || memo.sourceIndex >= ranges.length) {
					continue;
				}

				const targetRange = ranges[memo.sourceIndex];
				if (!targetRange) {
					continue;
				}

				normalizedBody = `${normalizedBody.slice(0, targetRange.start)}${normalizedBody.slice(targetRange.end)}`
					.replace(/\n{3,}/g, "\n\n")
					.trim();
			}

			const nextFileContent = frontmatter
				? normalizedBody
					? `${frontmatter}\n\n${normalizedBody}`
					: frontmatter
				: normalizedBody;

			await this.app.vault.modify(file, nextFileContent);
		}

		await this.refreshAllMemosViews();
	}

	private async updateMemoStatus(memo: MemoEntry, key: MemoStatusKey, enabled: boolean): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(memo.sourcePath);
		if (!(file instanceof TFile)) {
			new Notice("Source file no longer exists.");
			return;
		}

		const rawContent = await this.app.vault.cachedRead(file);
		const { frontmatter, body } = splitFrontmatter(rawContent);
		const normalizedBody = body.replace(/\r\n/g, "\n").trim();
		const ranges = getMemoBlockRanges(rawContent);
		if (memo.sourceIndex < 0 || memo.sourceIndex >= ranges.length) {
			new Notice("Could not locate the original memo block.");
			return;
		}

		const targetRange = ranges[memo.sourceIndex];
		if (!targetRange) {
			new Notice("Could not locate the original memo block.");
			return;
		}

		const parsedBlock = parseMemoBlock(targetRange.raw, this.settings.timestampFormat);
		if (!parsedBlock) {
			new Notice("Could not parse the original memo block.");
			return;
		}

		const nextStatus = setMemoStatusValue(
			{
				deletedAt: parsedBlock.deletedAt,
				archivedAt: parsedBlock.archivedAt,
				pinnedAt: parsedBlock.pinnedAt,
			},
			key,
			enabled ? createMemoStatusTimestamp() : null,
		);
		const nextBlock = serializeMemoBlock(parsedBlock.content, parsedBlock.timestampLabel, nextStatus);
		const nextBody = `${normalizedBody.slice(0, targetRange.start)}${nextBlock}${normalizedBody.slice(targetRange.end)}`.trim();
		const nextFileContent = frontmatter
			? nextBody
				? `${frontmatter}\n\n${nextBody}`
				: frontmatter
			: nextBody;

		await this.app.vault.modify(file, nextFileContent);
		await this.refreshAllMemosViews();
	}

	private scheduleBoundFileActivation(file: TFile | null): void {
		if (this.pendingBoundFileTimer !== null) {
			window.clearTimeout(this.pendingBoundFileTimer);
			this.pendingBoundFileTimer = null;
		}

		this.pendingBoundFileTimer = window.setTimeout(() => {
			this.pendingBoundFileTimer = null;
			void this.handleFileOpen(file);
		}, 40);
	}

	private async getOrCreateMemosView(): Promise<MemosView | null> {
		const existingView = this.app.workspace
			.getLeavesOfType(VIEW_TYPE_MEMOS)
			.find((leaf) => leaf.view instanceof MemosView)?.view;
		if (existingView instanceof MemosView) {
			return existingView;
		}

		await this.activateMemosView();
		const nextView = this.app.workspace
			.getLeavesOfType(VIEW_TYPE_MEMOS)
			.find((leaf) => leaf.view instanceof MemosView)?.view;
		return nextView instanceof MemosView ? nextView : null;
	}

	private handleVaultChange(file: unknown): void {
		if (!(file instanceof TFile) || file.extension !== "md") {
			return;
		}

		const suppressedUntil = this.suppressedVaultRefreshUntil.get(file.path);
		if (suppressedUntil && suppressedUntil > Date.now()) {
			this.suppressedVaultRefreshUntil.delete(file.path);
			return;
		}

		if (suppressedUntil) {
			this.suppressedVaultRefreshUntil.delete(file.path);
		}

		void this.refreshAllMemosViews();
	}

	private async handleFileOpen(file: TFile | null): Promise<void> {
		if (!file) {
			return;
		}

		const boundFilePath = this.normalizeBoundPath(this.settings.boundFilePath);
		if (!boundFilePath || this.normalizeBoundPath(file.path) !== boundFilePath) {
			return;
		}

		const targetLeaf = this.findLeafForFile(file.path);
		if (!targetLeaf || targetLeaf.view.getViewType() === VIEW_TYPE_MEMOS) {
			return;
		}

		await this.activateMemosView(file.path, targetLeaf);
	}

	private formatDateByPattern(date: Date, pattern: string): string {
		const year = String(date.getFullYear());
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		return pattern
			.replace(/YYYY/g, year)
			.replace(/MM/g, month)
			.replace(/DD/g, day);
	}

	private formatTimeByPattern(date: Date, pattern: string): string {
		const hours = String(date.getHours()).padStart(2, "0");
		const minutes = String(date.getMinutes()).padStart(2, "0");
		const seconds = String(date.getSeconds()).padStart(2, "0");
		return (pattern || "HH:mm")
			.replace(/HH/g, hours)
			.replace(/mm/g, minutes)
			.replace(/ss/g, seconds);
	}

	private normalizeBoundPath(path: string | undefined): string {
		const trimmed = path?.trim();
		if (!trimmed) {
			return "";
		}

		return normalizePath(trimmed.replace(/\\/g, "/"));
	}

	private findLeafForFile(path: string): WorkspaceLeaf | null {
		const normalizedPath = this.normalizeBoundPath(path);
		const activeLeaf = this.app.workspace.activeLeaf;
		if (
			activeLeaf?.view instanceof MarkdownView &&
			this.normalizeBoundPath(activeLeaf.view.file?.path) === normalizedPath
		) {
			return activeLeaf;
		}

		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (
				leaf.view instanceof MarkdownView &&
				this.normalizeBoundPath(leaf.view.file?.path) === normalizedPath
			) {
				return leaf;
			}
		}

		return null;
	}
}
