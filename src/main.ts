import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import {
	getMemoBlockRanges,
	serializeMemoBlock,
	splitFrontmatter,
} from "./memos/core/parser";
import {
	buildNextMemoStatus,
	composeFileContent,
	readFileForRewrite,
	removeBlockFromRange,
	rewriteMemoBlock,
} from "./memos/core/memoWriter";
import { MemosView } from "./memos/ui/memosView";
import { MemosSidebarView } from "./memos/ui/memosSidebar";
import { DEFAULT_SETTINGS, MemosSettingTab } from "./settings";
import { VIEW_TYPE_MEMOS, VIEW_TYPE_MEMOS_SIDEBAR } from "./types";
import type { DailyNotesConfig, MemoEntry, MemosPluginSettings } from "./types";
import type { MemoStatusKey } from "./memos/core/parser";
import { t } from "./i18n";
import { normalizeBoundPath } from "./utils/path";
import { readDailyNoteTemplate, renderDailyNoteTemplate } from "./dailyNotes/template";
import { WechatIntegration } from "./wechat/wechatPlugin";
import { DEFAULT_WECHAT_SETTINGS } from "./wechat/types";
import { isNodeTransportAvailable } from "./wechat/http";

export default class MemosViewPlugin extends Plugin {
	settings: MemosPluginSettings = DEFAULT_SETTINGS;
	dailyNotesConfig: DailyNotesConfig | null = null;
	wechat = new WechatIntegration(this);
	settingTab: MemosSettingTab | null = null;
	private pendingBoundFileTimer: number | null = null;
	private suppressedVaultRefreshUntil = new Map<string, number>();

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.loadDailyNotesConfig();

		this.registerView(
			VIEW_TYPE_MEMOS,
			(leaf) => new MemosView(leaf, this),
		);
		this.registerView(
			VIEW_TYPE_MEMOS_SIDEBAR,
			(leaf) => new MemosSidebarView(leaf, this),
		);
		this.registerHoverLinkSource(VIEW_TYPE_MEMOS, {
			display: "Memos",
			defaultMod: false,
		});

		this.addRibbonIcon("lightbulb", t("commands.openMemosView"), () => {
			void this.activateMemosView();
		});

		this.addCommand({
			id: "open-view",
			name: t("commands.openMemosView"),
			callback: () => {
				void this.activateMemosView();
			},
		});

		this.addCommand({
			id: "open-sidebar",
			name: t("commands.openMemosSidebar"),
			callback: () => {
				void this.activateMemosSidebarView();
			},
		});

		this.addCommand({
			id: "wechat-start",
			name: t("commands.wechatStart"),
			callback: () => {
				void this.wechat.start();
			},
		});

		this.addCommand({
			id: "wechat-stop",
			name: t("commands.wechatStop"),
			callback: async () => {
				if (!isNodeTransportAvailable()) {
					new Notice(t("notices.wechatDesktopOnly"));
					return;
				}
				await this.wechat.stop({ notify: true });
				new Notice(t("notices.wechatStopped"));
			},
		});

		this.addCommand({
			id: "wechat-login",
			name: t("commands.wechatLogin"),
			callback: () => {
				this.wechat.openLogin();
			},
		});

		if (
			isNodeTransportAvailable() &&
			this.settings.wechat.botToken.trim()
		) {
			void this.wechat.start();
		}

		this.settingTab = new MemosSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

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

	onunload(): void {
		if (this.pendingBoundFileTimer !== null) {
			window.clearTimeout(this.pendingBoundFileTimer);
			this.pendingBoundFileTimer = null;
		}

		void this.wechat?.stop();

		const leaves = [
			...this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMOS),
			...this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMOS_SIDEBAR),
		];
		for (const leaf of leaves) {
			void leaf.setViewState({ type: "empty" });
		}
	}

	async loadSettings(): Promise<void> {
		const rawData = ((await this.loadData()) ?? {}) as Partial<MemosPluginSettings> & {
			boundFilePaths?: string[];
			maxMemos?: number;
		};
		const { boundFilePaths, wechat: rawWechat, ...restData } = rawData;
		// maxMemos 设置已废弃,删除遗留字段避免回写
		delete restData.maxMemos;
		const migratedBoundFilePath =
			restData.boundFilePath ??
			(boundFilePaths && boundFilePaths.length ? boundFilePaths[0] : "");
		const data = Object.assign({}, DEFAULT_SETTINGS, restData, {
			boundFilePath: migratedBoundFilePath,
		});
		this.settings = {
			...data,
			boundFilePath: normalizeBoundPath(data.boundFilePath),
			wechat: { ...DEFAULT_WECHAT_SETTINGS, ...(rawWechat ?? {}) },
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async activateMemosView(boundFilePath?: string, leaf?: WorkspaceLeaf): Promise<void> {
		// 未指定 leaf 时优先复用已存在的视图,避免出现重复的 memos-view
		let targetLeaf: WorkspaceLeaf | null = leaf ?? null;
		if (!targetLeaf) {
			const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMOS);
			targetLeaf = existing[0] ?? this.app.workspace.getLeaf(false);
		}
		if (!targetLeaf) {
			new Notice(t("notices.noWorkspaceLeaf"));
			return;
		}

		await targetLeaf.setViewState({
			type: VIEW_TYPE_MEMOS,
			active: true,
			state: { boundFilePath },
		});
		void this.app.workspace.revealLeaf(targetLeaf);
	}

	async activateMemosSidebarView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMOS_SIDEBAR);
		const targetLeaf = existing[0] ?? this.app.workspace.getRightLeaf(false);
		if (!targetLeaf) {
			new Notice(t("notices.noWorkspaceLeaf"));
			return;
		}

		await targetLeaf.setViewState({
			type: VIEW_TYPE_MEMOS_SIDEBAR,
			active: true,
		});
		void this.app.workspace.revealLeaf(targetLeaf);
	}

	/** 微信登录状态等外部变化后刷新设置界面；未打开时重建无副作用。 */
	refreshSettingTab(): void {
		this.settingTab?.display();
	}

	async refreshAllMemosViews(): Promise<void> {
		const leaves = [
			...this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMOS),
			...this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMOS_SIDEBAR),
		];
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

	async openSourceFile(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(t("notices.sourceFileNoLongerExists"));
			return;
		}

		await this.app.workspace.getLeaf(true).openFile(file);
	}

	async openSourceFileAtLine(path: string, line: number): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(t("notices.sourceFileNoLongerExists"));
			return;
		}

		const leaf = this.app.workspace.getLeaf(false);
		if (!leaf) {
			new Notice(t("notices.noWorkspaceLeaf"));
			return;
		}

		await leaf.openFile(file, {
			eState: {
				line,
				mode: "source",
			},
		});
	}

	async openSourceFileAtHeading(path: string, heading: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(t("notices.sourceFileNoLongerExists"));
			return;
		}

		await this.app.workspace.openLinkText(`${file.basename}#${heading}`, file.path, false);
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
		if (this.settings.memoStoreMode === "yearly") {
			return this.getYearlyNotePath(new Date());
		}
		const folder = this.getDailyNotesFolder();
		const fileName = this.formatDateByPattern(new Date(), this.dailyNotesConfig?.format ?? "YYYY-MM-DD");
		return normalizePath(folder ? `${folder}/${fileName}.md` : `${fileName}.md`);
	}

	private getYearlyNotePath(date: Date): string {
		const folder = this.getDailyNotesFolder();
		const year = String(date.getFullYear());
		return normalizePath(folder ? `${folder}/${year}.md` : `${year}.md`);
	}

	private getYearlyDayHeading(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
		return `## ${year}-${month}-${day} ${weekdays[date.getDay()]}`;
	}

	private insertPayloadUnderHeading(body: string, payload: string, heading: string): string {
		if (!body) {
			return `${heading}\n\n${payload}`;
		}
		const headingLine = heading.startsWith("#") ? heading : `## ${heading}`;
		const headingIndex = body.indexOf(headingLine);
		if (headingIndex === -1) {
			return `${headingLine}\n\n${payload}\n\n${body}`;
		}
		const afterHeading = headingIndex + headingLine.length;
		const headingLevel = headingLine.match(/^(#{1,6})\s/)?.[1]?.length ?? 2;
		const nextHeadingPattern = new RegExp(`\\n#{1,${headingLevel}} `);
		const nextHeadingMatch = body.slice(afterHeading).search(nextHeadingPattern);
		const sectionEnd = nextHeadingMatch === -1 ? body.length : afterHeading + nextHeadingMatch;
		const before = body.slice(0, sectionEnd);
		const after = body.slice(sectionEnd);
		return `${before}\n${payload}\n${after}`;
	}

	async appendMemoToToday(
		content: string,
		options: { refresh?: boolean; timestamp?: Date } = {},
	): Promise<{ filePath: string; payload: string } | null> {
		const normalized = content.trim();
		if (!normalized) {
			return null;
		}

		try {
			const now = options.timestamp ?? new Date();
			const timestampLabel = this.formatTimeByPattern(now, this.settings.timestampFormat);
			const payload = serializeMemoBlock(normalized, timestampLabel);

			if (this.settings.memoStoreMode === "yearly") {
				return await this.appendMemoToYearlyFile(payload, options);
			}

			await this.loadDailyNotesConfig();
			const folder = this.getDailyNotesFolder();
			const fileName = this.formatDateByPattern(now, this.dailyNotesConfig?.format ?? "YYYY-MM-DD");
			const filePath = normalizePath(folder ? `${folder}/${fileName}.md` : `${fileName}.md`);
			const existing = this.app.vault.getAbstractFileByPath(filePath);

			if (existing instanceof TFile) {
				const rawContent = await this.app.vault.cachedRead(existing);
				const { frontmatter, body } = splitFrontmatter(rawContent);
				const normalizedBody = body.replace(/\r\n/g, "\n").trim();
				let nextBody: string;
				const storeHeading = this.settings.memoStoreHeading.trim();
				if (storeHeading) {
					nextBody = this.insertPayloadUnderHeading(normalizedBody, payload, storeHeading);
				} else {
					nextBody = normalizedBody ? `${payload}\n\n${normalizedBody}` : payload;
				}
				const nextFileContent = composeFileContent(frontmatter, nextBody);
				this.suppressVaultRefresh(existing.path);
				await this.app.vault.modify(existing, nextFileContent);
			} else {
				if (folder) {
					await this.app.vault.createFolder(folder).catch(() => undefined);
				}
				const template = await readDailyNoteTemplate(this.app, this.dailyNotesConfig?.template);
				const renderedTemplate = renderDailyNoteTemplate(template, now, fileName);
				const { frontmatter, body } = splitFrontmatter(renderedTemplate);
				const normalizedBody = body.replace(/\r\n/g, "\n").trim();
				const storeHeading = this.settings.memoStoreHeading.trim();
				let nextBody: string;
				if (storeHeading) {
					nextBody = this.insertPayloadUnderHeading(normalizedBody, payload, storeHeading);
				} else {
					nextBody = normalizedBody ? `${payload}\n\n${normalizedBody}` : payload;
				}
				const fileContent = composeFileContent(frontmatter, nextBody);
				this.suppressVaultRefresh(filePath);
				await this.app.vault.create(filePath, fileContent);
			}

			if (options.refresh !== false) {
				await this.refreshAllMemosViews();
			}
			return { filePath, payload };
		} catch (error) {
			console.error("Failed to append memo", error);
			new Notice(t("notices.memoUpdateFailed"));
			return null;
		}
	}

	private async appendMemoToYearlyFile(
		payload: string,
		options: { refresh?: boolean; timestamp?: Date },
	): Promise<{ filePath: string; payload: string } | null> {
		try {
			const now = options.timestamp ?? new Date();
			const filePath = this.getYearlyNotePath(now);
			const year = String(now.getFullYear());
			const dayHeading = this.getYearlyDayHeading(now);
			const existing = this.app.vault.getAbstractFileByPath(filePath);

			if (existing instanceof TFile) {
				const rawContent = await this.app.vault.cachedRead(existing);
				const { frontmatter, body } = splitFrontmatter(rawContent);
				const normalizedBody = body.replace(/\r\n/g, "\n").trim();
				const sectionBlock = `\n${payload}\n`;
				const headingIndex = normalizedBody.indexOf(dayHeading);
				let nextBody: string;
				if (headingIndex === -1) {
					const yearHeading = `# ${year}`;
					const yearHeadingIndex = normalizedBody.indexOf(yearHeading);
					if (yearHeadingIndex !== -1) {
						const afterYearHeading = yearHeadingIndex + yearHeading.length;
						const afterYearHeadingText = normalizedBody.slice(afterYearHeading);
						const nextH2Match = afterYearHeadingText.search(/\n## /);
						let insertPos: number;
						if (nextH2Match !== -1) {
							insertPos = afterYearHeading + nextH2Match;
						} else {
							insertPos = normalizedBody.length;
						}
						const before = normalizedBody.slice(0, insertPos);
						const after = normalizedBody.slice(insertPos);
						nextBody = `${before}\n\n${dayHeading}\n${sectionBlock}\n${after}`.replace(/\n{3,}/g, "\n\n");
					} else {
						nextBody = `# ${year}\n\n${dayHeading}\n${sectionBlock}\n${normalizedBody ? normalizedBody : ""}`.trim();
					}
				} else {
					const afterHeading = headingIndex + dayHeading.length;
					const nextHeadingMatch = normalizedBody.slice(afterHeading).search(/\n## /);
					const sectionEnd = nextHeadingMatch === -1 ? normalizedBody.length : afterHeading + nextHeadingMatch;
					const beforeSection = normalizedBody.slice(0, sectionEnd);
					const afterSection = normalizedBody.slice(sectionEnd);
					nextBody = `${beforeSection}\n${payload}\n${afterSection}`;
				}
				const nextFileContent = composeFileContent(frontmatter, nextBody);
				this.suppressVaultRefresh(existing.path);
				await this.app.vault.modify(existing, nextFileContent);
			} else {
				const folder = this.getDailyNotesFolder();
				if (folder) {
					await this.app.vault.createFolder(folder).catch(() => undefined);
				}
				const fileContent = `# ${year}\n\n${dayHeading}\n\n${payload}\n`;
				this.suppressVaultRefresh(filePath);
				await this.app.vault.create(filePath, fileContent);
			}

			if (options.refresh !== false) {
				await this.refreshAllMemosViews();
			}
			return { filePath, payload };
		} catch (error) {
			console.error("Failed to append memo to yearly file", error);
			new Notice(t("notices.memoUpdateFailed"));
			return null;
		}
	}

	async updateMemoEntry(
		memo: MemoEntry,
		nextContent: string,
		options: { refresh?: boolean } = {},
	): Promise<void> {
		const normalized = nextContent.trim();
		if (!normalized) {
			return;
		}

		try {
			const result = await rewriteMemoBlock(
				this.app,
				memo,
				this.settings.timestampFormat,
				(parsedBlock) => serializeMemoBlock(normalized, parsedBlock.timestampLabel, {
					deletedAt: parsedBlock.deletedAt,
					archivedAt: parsedBlock.archivedAt,
					pinnedAt: parsedBlock.pinnedAt,
				}),
			);
			if (!result) {
				return;
			}

			this.suppressVaultRefresh(result.file.path);
			await this.app.vault.modify(result.file, result.content);
			if (options.refresh !== false) {
				await this.refreshAllMemosViews();
			}
		} catch (error) {
			console.error("Failed to update memo entry", error);
			new Notice(t("notices.memoUpdateFailed"));
		}
	}

	async deleteMemoEntry(memo: MemoEntry, options: { refresh?: boolean } = {}): Promise<void> {
		await this.updateMemoStatus(memo, "deleted", !memo.deletedAt, options);
	}

	async archiveMemoEntry(memo: MemoEntry, options: { refresh?: boolean } = {}): Promise<void> {
		await this.updateMemoStatus(memo, "archived", !memo.archivedAt, options);
	}

	async pinMemoEntry(memo: MemoEntry, options: { refresh?: boolean } = {}): Promise<void> {
		await this.updateMemoStatus(memo, "pinned", !memo.pinnedAt, options);
	}

	async permanentlyDeleteMarkedMemos(memos: MemoEntry[], attachments: TFile[] = []): Promise<void> {
		const memoGroups = new Map<string, MemoEntry[]>();
		memos.forEach((memo) => {
			const currentGroup = memoGroups.get(memo.sourcePath) ?? [];
			currentGroup.push(memo);
			memoGroups.set(memo.sourcePath, currentGroup);
		});

		try {
			for (const [sourcePath, groupMemos] of memoGroups.entries()) {
				const ctx = await readFileForRewrite(this.app, sourcePath);
				if (!ctx) {
					continue;
				}

				const ranges = getMemoBlockRanges(ctx.rawContent);
				// 按 sourceIndex 倒序删除,避免删除前面的块后影响后面块的位置
				let normalizedBody = ctx.normalizedBody;
				const targetMemos = [...groupMemos].sort((left, right) => right.sourceIndex - left.sourceIndex);
				for (const memo of targetMemos) {
					if (memo.sourceIndex < 0 || memo.sourceIndex >= ranges.length) {
						continue;
					}
					const targetRange = ranges[memo.sourceIndex];
					if (!targetRange) {
						continue;
					}
					normalizedBody = removeBlockFromRange(normalizedBody, targetRange.start, targetRange.end);
				}

				const nextFileContent = composeFileContent(ctx.frontmatter, normalizedBody);
				this.suppressVaultRefresh(ctx.file.path);
				await this.app.vault.modify(ctx.file, nextFileContent);
			}

			// 将用户勾选的附件按用户删除偏好移入回收站(FileManager 会遵循「删除文件」设置)
			for (const attachment of attachments) {
				try {
					await this.app.fileManager.trashFile(attachment);
				} catch (error) {
					console.error("Failed to trash attachment", attachment.path, error);
				}
			}

			await this.refreshAllMemosViews();
		} catch (error) {
			console.error("Failed to permanently delete marked memos", error);
			new Notice(t("notices.memoUpdateFailed"));
		}
	}

	private async updateMemoStatus(memo: MemoEntry, key: MemoStatusKey, enabled: boolean, options: { refresh?: boolean } = {}): Promise<void> {
		try {
			const result = await rewriteMemoBlock(
				this.app,
				memo,
				this.settings.timestampFormat,
				(parsedBlock) => {
					const nextStatus = buildNextMemoStatus(parsedBlock, key, enabled);
					return serializeMemoBlock(parsedBlock.content, parsedBlock.timestampLabel, nextStatus);
				},
			);
			if (!result) {
				return;
			}

			this.suppressVaultRefresh(result.file.path);
			await this.app.vault.modify(result.file, result.content);
			if (options.refresh !== false) {
				await this.refreshAllMemosViews();
			}
		} catch (error) {
			console.error("Failed to update memo status", error);
			new Notice(t("notices.memoUpdateFailed"));
		}
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

		const boundFilePath = normalizeBoundPath(this.settings.boundFilePath);
		if (!boundFilePath || normalizeBoundPath(file.path) !== boundFilePath) {
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

	private findLeafForFile(path: string): WorkspaceLeaf | null {
		const normalizedPath = normalizeBoundPath(path);

		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (
				leaf.view instanceof MarkdownView &&
				normalizeBoundPath(leaf.view.file?.path) === normalizedPath
			) {
				return leaf;
			}
		}

		return null;
	}
}
