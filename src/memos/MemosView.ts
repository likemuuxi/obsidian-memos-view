import { ItemView, MarkdownRenderer, Menu, Notice, WorkspaceLeaf, setIcon, type ViewStateResult } from "obsidian";
import { Scope } from "obsidian";
import type MemosViewPlugin from "../main";
import { Modal, TFile, setTooltip } from "obsidian";
import { VIEW_TYPE_MEMOS } from "../types";
import type { MemoEntry, MemosViewState } from "../types";
import { loadMemosFromDailyNotes } from "./memoStore";
import { buildViewModel } from "./viewModel";
import type { MemosSortOrder, MemosStatusFilter } from "./viewModel";
import {
	applyWikilinkSuggestion,
	createBlockId,
	expandEmptyAnchorToCurrentFile,
	getWikilinkSuggestions,
	parseWikilinkContext,
	type WikilinkContext,
	type WikilinkSuggestion,
} from "./wikilink";

const MEMOS_PAGE_SIZE = 50;

interface TagTreeNode {
	name: string;
	path: string;
	count: number;
	children: TagTreeNode[];
}

interface MutableTagTreeNode extends TagTreeNode {
	childMap: Map<string, MutableTagTreeNode>;
}

export class MemosView extends ItemView {
	private plugin: MemosViewPlugin;
	private state: MemosViewState = {};
	private memos: MemoEntry[] = [];
	private memoStreamContainerEl: HTMLElement | null = null;
	private collapsedTagPaths = new Set<string>();
	private searchTerm = "";
	private isSearchComposing = false;
	private activeTag: string | null = null;
	private activeDayKey: string | null = null;
	private sortOrder: MemosSortOrder = "created-desc";
	private statusFilter: MemosStatusFilter = "all";
	private visibleMemoCount = MEMOS_PAGE_SIZE;
	private composerValue = "";
	private isComposerExpanded = false;
	private hasScrolledMemoStream = false;
	private editingMemo: MemoEntry | null = null;
	private inlineEditingMemoId: string | null = null;
	private inlineEditorValue = "";

	constructor(leaf: WorkspaceLeaf, plugin: MemosViewPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_MEMOS;
	}

	getDisplayText(): string {
		return "Memos";
	}

	getIcon(): string {
		return "lightbulb";
	}

	async onOpen(): Promise<void> {
		this.containerEl.addClass("memos-view");
		this.scope = new Scope(this.app.scope);
		this.scope.register([], "Escape", () => false);
		this.registerDomEvent(this.containerEl, "keydown", (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}

			const target = event.target as HTMLElement | null;
			if (!target || !this.containerEl.contains(target)) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
		}, { capture: true });
		this.registerDomEvent(this.containerEl, "keyup", (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}

			const target = event.target as HTMLElement | null;
			if (!target || !this.containerEl.contains(target)) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
		}, { capture: true });
		await this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	async setState(state: MemosViewState, result: ViewStateResult): Promise<void> {
		this.state = state ?? {};
		await super.setState(state, result);
		await this.render();
	}

	getState(): MemosViewState {
		return this.state;
	}

	async refresh(): Promise<void> {
		await this.render();
	}

	private async render(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();

		const shellEl = contentEl.createDiv({ cls: "memos-shell" });
		this.memos = await loadMemosFromDailyNotes(
			this.app,
			this.plugin.getDailyNotesFolder(),
			this.plugin.settings.timestampFormat,
			this.plugin.settings.boundFilePath || undefined,
		);
		const viewModel = buildViewModel(
			this.memos,
			this.searchTerm,
			this.activeTag,
			this.activeDayKey,
			this.sortOrder,
			this.statusFilter,
		);

		const layoutEl = shellEl.createDiv({ cls: "memos-layout" });
		this.renderSidebar(
			layoutEl,
			viewModel.totalMemos,
			viewModel.totalTags,
			viewModel.totalDays,
			viewModel.heatmap,
			viewModel.heatmapMonths,
			viewModel.tagStats,
			this.getStatusCounts(),
		);

		const mainEl = layoutEl.createDiv({ cls: "memos-main" });
		const mainHeaderEl = mainEl.createDiv({ cls: "memos-main-header" });
		this.renderTopbar(mainHeaderEl);
		const composerEl = this.renderComposer(mainHeaderEl);
		const bodyEl = mainEl.createDiv({ cls: "memos-main-body" });
		const backToTopButtonEl = this.createBackToTopButton(mainEl, bodyEl);
		this.memoStreamContainerEl = bodyEl;
		this.renderMemoStream(bodyEl, viewModel.filteredMemos);
		this.bindMainInteractions(shellEl, composerEl, bodyEl, backToTopButtonEl);
	}

	private renderSidebar(
		parentEl: HTMLElement,
		totalMemos: number,
		totalTags: number,
		totalDays: number,
		heatmap: Array<{
			key: string;
			cells: Array<{ dayKey: string; count: number; level: number; isToday: boolean }>;
		}>,
		heatmapMonths: Array<{ label: string; column: number }>,
		tagStats: Array<{ tag: string; count: number }>,
		statusCounts: Record<MemosStatusFilter, number>,
	): void {
		const sidebarEl = parentEl.createDiv({ cls: "memos-sidebar" });
		sidebarEl.createEl("div", {
			cls: "memos-brand",
			text: this.plugin.settings.displayName || "memos",
		});

		const statsEl = sidebarEl.createDiv({ cls: "memos-stats" });
		this.renderStat(statsEl, String(totalMemos), "Notes");
		this.renderStat(statsEl, String(totalTags), "Tags");
		this.renderStat(statsEl, String(totalDays), "Days");

		const heatmapSectionEl = sidebarEl.createDiv({ cls: "memos-heatmap-section" });
		const heatmapGridEl = heatmapSectionEl.createDiv({ cls: "memos-heatmap-grid" });
		heatmapGridEl.style.setProperty("--memos-heatmap-columns", String(heatmap.length));
		heatmap.forEach((week) => {
			const weekEl = heatmapGridEl.createDiv({ cls: "memos-heatmap-week" });
			week.cells.forEach((cell) => {
				const cellEl = weekEl.createEl("button", {
					cls: `memos-heatmap-cell memos-heatmap-level-${cell.level}${cell.isToday ? " is-today" : ""}${this.activeDayKey === cell.dayKey ? " is-active" : ""}`,
					attr: {
						type: "button",
						"aria-label": cell.dayKey,
						"aria-pressed": String(this.activeDayKey === cell.dayKey),
					},
				});
				setTooltip(cellEl, cell.dayKey, {
					placement: "top",
					delay: 120,
				});
				cellEl.addEventListener("click", () => {
					this.activeDayKey = this.activeDayKey === cell.dayKey ? null : cell.dayKey;
					this.resetVisibleMemoCount();
					void this.render();
				});
			});
		});

		const heatmapMonthsEl = heatmapSectionEl.createDiv({ cls: "memos-heatmap-months" });
		heatmapMonthsEl.style.setProperty("--memos-heatmap-columns", String(heatmap.length));
		heatmapMonths.forEach((month) => {
			const monthEl = heatmapMonthsEl.createDiv({ cls: "memos-heatmap-month" });
			monthEl.setText(month.label);
			monthEl.style.setProperty("grid-column", String(month.column));
		});

		const filtersEl = sidebarEl.createDiv({ cls: "memos-filters" });
		this.renderStatusFilters(filtersEl, statusCounts);
		filtersEl.createEl("div", { cls: "memos-filters-heading", text: "All tags" });
		const treeEl = filtersEl.createDiv({ cls: "memos-filter-tree" });
		this.renderTagTree(treeEl, buildTagTree(tagStats), 0);
	}

	private renderStatusFilters(
		parentEl: HTMLElement,
		statusCounts: Record<MemosStatusFilter, number>,
	): void {
		const wrapEl = parentEl.createDiv({ cls: "memos-status-filters" });
		this.createStatusFilterButton(wrapEl, "all", "All", "layers", statusCounts.all);
		this.createStatusFilterButton(wrapEl, "archived", "Archived", "archive", statusCounts.archived);
		this.createStatusFilterButton(wrapEl, "deleted", "Deleted", "trash-2", statusCounts.deleted);
	}

	private createStatusFilterButton(
		parentEl: HTMLElement,
		filter: Exclude<MemosStatusFilter, "active">,
		label: string,
		icon: string,
		count: number,
	): void {
		const buttonEl = parentEl.createEl("button", {
			cls: `memos-status-filter-button${this.statusFilter === filter ? " is-active" : ""}`,
			attr: {
				type: "button",
				"aria-pressed": String(this.statusFilter === filter),
				"aria-label": `${label} memos (${count})`,
			},
		});
		const labelEl = buttonEl.createSpan({ cls: "memos-status-filter-label" });
		const iconEl = labelEl.createSpan({ cls: "memos-status-filter-icon" });
		setIcon(iconEl, icon);
		labelEl.createSpan({ text: label });
		buttonEl.createSpan({ cls: "memos-status-filter-count", text: String(count) });
		buttonEl.addEventListener("click", () => {
			this.statusFilter = this.statusFilter === filter ? "active" : filter;
			this.activeTag = null;
			this.activeDayKey = null;
			this.resetVisibleMemoCount();
			void this.render();
		});
		if (filter === "deleted") {
			buttonEl.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				this.openDeletedFilterMenu(event);
			});
		}
	}

	private renderTopbar(parentEl: HTMLElement): HTMLInputElement {
		const topbarEl = parentEl.createDiv({ cls: "memos-topbar" });
		const titleEl = topbarEl.createDiv({ cls: "memos-title" });
		if (this.activeDayKey) {
			const homeButton = titleEl.createEl("button", {
				cls: "memos-title-home is-icon",
				attr: {
					type: "button",
					"aria-label": `Clear date filter ${this.activeDayKey}`,
				},
			});
			setIcon(homeButton, "house");
			homeButton.addEventListener("click", () => {
				this.activeDayKey = null;
				this.resetVisibleMemoCount();
				void this.render();
			});

			titleEl.createSpan({ cls: "memos-title-separator", text: "/" });
			titleEl.createSpan({ cls: "memos-title-date-label", text: this.activeDayKey });
		} else {
			const homeButton = titleEl.createEl("button", {
				cls: "memos-title-home",
				attr: {
					type: "button",
					"aria-label": "Memos",
				},
			});
			homeButton.setText(this.plugin.settings.displayName || "memos");
		}

		const sortButton = titleEl.createEl("button", {
			cls: "memos-title-menu-button",
			attr: {
				type: "button",
				"aria-label": `Choose sort order, current ${getSortLabel(this.sortOrder)}`,
			},
		});
		const chevronEl = sortButton.createSpan({ cls: "memos-title-date-chevron" });
		setIcon(chevronEl, "chevron-down");
		sortButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.openSortMenu(event);
		});

		const actionsEl = topbarEl.createDiv({ cls: "memos-topbar-actions" });
		const randomWalkButtonEl = actionsEl.createEl("button", {
			cls: "memos-topbar-icon-button",
			attr: {
				type: "button",
				"aria-label": "Random walk",
			},
		});
		setIcon(randomWalkButtonEl, "shuffle");
		randomWalkButtonEl.addEventListener("click", () => {
			void this.startRandomWalk();
		});

		const searchEl = actionsEl.createEl("input", {
			type: "search",
			cls: "memos-search",
			placeholder: "Search memos, files, tags",
		});
		searchEl.value = this.searchTerm;
		searchEl.addEventListener("compositionstart", () => {
			this.isSearchComposing = true;
		});
		searchEl.addEventListener("compositionend", () => {
			this.isSearchComposing = false;
			this.updateSearch(searchEl.value);
		});
		searchEl.addEventListener("input", () => {
			if (this.isSearchComposing) {
				return;
			}

			this.updateSearch(searchEl.value);
		});
		return searchEl;
	}

	private updateSearch(value: string): void {
		if (this.searchTerm === value) {
			return;
		}

		this.searchTerm = value;
		this.resetVisibleMemoCount();
		this.renderFilteredMemoStream();
	}

	private renderComposer(parentEl: HTMLElement): HTMLElement {
		const composerEl = parentEl.createDiv({
			cls: `memos-composer ${this.editingMemo ? "is-editing" : ""}`,
		});
		const editorWrapEl = composerEl.createDiv({ cls: "memos-composer-editor" });
		const textareaEl = editorWrapEl.createEl("textarea", {
			cls: "memos-composer-input",
			placeholder: "Type your thoughts here...",
		});
		const wikilinkSuggestEl = editorWrapEl.createDiv({ cls: "memos-wikilink-suggest", attr: { hidden: "hidden" } });
		textareaEl.value = this.composerValue;
		textareaEl.addEventListener("input", () => {
			this.composerValue = textareaEl.value;
		});
		textareaEl.addEventListener("paste", (event) => {
			void this.handleTextareaPaste(
				event,
				textareaEl,
				this.editingMemo?.sourcePath ?? this.plugin.getTodayDailyNotePath(),
				(value) => {
					this.composerValue = value;
				},
			);
		});

		const footerEl = composerEl.createDiv({ cls: "memos-composer-footer" });
		const toolsEl = footerEl.createDiv({ cls: "memos-composer-tools" });
		this.createFormattingTools(toolsEl, textareaEl, (value) => {
			this.composerValue = value;
		});
		this.bindTextareaWikilinkSuggest(
			textareaEl,
			wikilinkSuggestEl,
			this.editingMemo?.sourcePath ?? this.plugin.getTodayDailyNotePath(),
			(value) => {
				this.composerValue = value;
			},
		);

		const statusEl = footerEl.createDiv({ cls: "memos-composer-status" });
		statusEl.createEl("span", {
			text: this.editingMemo
				? `Editing: ${this.editingMemo.sourceBasename}`
				: `Today: ${this.plugin.getTodayDailyNotePath()}`,
		});

		const submitButton = footerEl.createEl("button", {
			cls: "memos-submit",
			text: "",
		});
		setIcon(submitButton, "send");
		submitButton.setAttribute("aria-label", "Save memo");
		textareaEl.addEventListener("keydown", (event) => {
			if (event.defaultPrevented) {
				return;
			}

			if (event.key !== "Enter" || event.shiftKey) {
				return;
			}

			event.preventDefault();
			submitButton.click();
		});
		submitButton.addEventListener("click", async () => {
			if (!this.composerValue.trim()) {
				new Notice("Write something first.");
				return;
			}

			if (this.editingMemo) {
				await this.plugin.updateMemoEntry(this.editingMemo, this.composerValue);
				new Notice("Memo updated.");
			} else {
				await this.plugin.appendMemoToToday(this.composerValue);
				new Notice("Saved to today's daily note.");
			}

			this.composerValue = "";
			this.editingMemo = null;
			this.isComposerExpanded = false;
			await this.render();
		});

		this.updateComposerStateClasses(composerEl, this.isComposerExpanded || Boolean(this.composerValue.trim()));
		return composerEl;
	}

	private renderMemoStream(parentEl: HTMLElement, memos: MemoEntry[]): void {
		parentEl.empty();
		const listEl = parentEl.createDiv({ cls: "memos-stream" });
		if (!memos.length) {
			const emptyEl = listEl.createDiv({ cls: "memos-empty" });
			emptyEl.createEl("h3", { text: "No matching memos" });
			emptyEl.createEl("p", {
				text: "Check your Daily notes setup, search keyword, or tag filter.",
			});
			return;
		}

		const visibleMemos = memos.slice(0, this.visibleMemoCount);
		visibleMemos.forEach((memo) => {
			void this.renderMemoCard(listEl, memo);
		});

		if (visibleMemos.length < memos.length) {
			const loadMoreWrapEl = listEl.createDiv({ cls: "memos-load-more-wrap" });
			const remainingCount = memos.length - visibleMemos.length;
			const loadMoreButtonEl = loadMoreWrapEl.createEl("button", {
				cls: "memos-load-more-button",
				text: `Load more (${remainingCount} remaining)`,
				attr: {
					type: "button",
					"aria-label": `Load ${Math.min(MEMOS_PAGE_SIZE, remainingCount)} more memos`,
				},
			});
			loadMoreButtonEl.addEventListener("click", () => {
				this.visibleMemoCount += MEMOS_PAGE_SIZE;
				this.renderFilteredMemoStream();
			});
		}
	}

	private renderFilteredMemoStream(): void {
		if (!this.memoStreamContainerEl) {
			return;
		}

		const viewModel = buildViewModel(
			this.memos,
			this.searchTerm,
			this.activeTag,
			this.activeDayKey,
			this.sortOrder,
			this.statusFilter,
		);
		this.renderMemoStream(this.memoStreamContainerEl, viewModel.filteredMemos);
	}

	private createBackToTopButton(parentEl: HTMLElement, bodyEl: HTMLElement): HTMLButtonElement {
		const buttonEl = parentEl.createEl("button", {
			cls: "memos-back-to-top",
			attr: {
				type: "button",
				"aria-label": "Back to top",
			},
		});
		setIcon(buttonEl, "arrow-up");
		buttonEl.addEventListener("click", () => {
			bodyEl.scrollTo({ top: 0, behavior: "smooth" });
		});
		return buttonEl;
	}

	private openSortMenu(event: MouseEvent): void {
		const menu = new Menu();
		getSortMenuItems().forEach((item) => {
			menu.addItem((menuItem) => {
				menuItem.setTitle(item.title).onClick(() => {
					if (this.sortOrder === item.value) {
						return;
					}

					this.sortOrder = item.value;
					this.resetVisibleMemoCount();
					this.renderFilteredMemoStream();
				});

				if (this.sortOrder === item.value) {
					menuItem.setIcon("check");
				}
			});
		});
		menu.showAtMouseEvent(event);
	}

	private renderStat(parentEl: HTMLElement, value: string, label: string): void {
		const statEl = parentEl.createDiv({ cls: "memos-stat" });
		statEl.createEl("strong", { text: value });
		statEl.createEl("span", { text: label });
	}

	private createToolButton(
		parentEl: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void,
	): void {
		const buttonEl = parentEl.createEl("button", {
			cls: "memos-tool-button",
			attr: { "aria-label": label, type: "button" },
		});
		setIcon(buttonEl, icon);
		buttonEl.addEventListener("click", onClick);
	}

	private createToolDivider(parentEl: HTMLElement): void {
		parentEl.createDiv({ cls: "memos-tool-divider" });
	}

	private autosizeTextarea(textareaEl: HTMLTextAreaElement): void {
		textareaEl.style.height = "auto";
		textareaEl.style.height = `${Math.max(textareaEl.scrollHeight, 260)}px`;
	}

	private createFormattingTools(
		parentEl: HTMLElement,
		textareaEl: HTMLTextAreaElement,
		onChange: (value: string) => void,
	): void {
		this.createToolButton(parentEl, "at-sign", "Insert mention", () => {
			this.insertIntoTextarea(textareaEl, "@", onChange);
		});
		this.createToolButton(parentEl, "hash", "Insert tag", () => {
			this.insertIntoTextarea(textareaEl, "#", onChange);
		});
		this.createToolButton(parentEl, "image", "Insert image", () => {
			this.insertIntoTextarea(textareaEl, "\n![]()", onChange);
		});
		this.createToolDivider(parentEl);
		this.createToolButton(parentEl, "bold", "Bold selection", () => {
			this.toggleWrapSelection(textareaEl, "**", "**", onChange);
		});
		this.createToolButton(parentEl, "italic", "Italic selection", () => {
			this.toggleWrapSelection(textareaEl, "*", "*", onChange);
		});
		this.createToolButton(parentEl, "strikethrough", "Strike selection", () => {
			this.toggleWrapSelection(textareaEl, "~~", "~~", onChange);
		});
		this.createToolDivider(parentEl);
		this.createToolButton(parentEl, "list", "Insert bullet list", () => {
			this.toggleLinePrefix(textareaEl, "- ", onChange);
		});
		this.createToolButton(parentEl, "list-ordered", "Insert numbered list", () => {
			this.toggleOrderedList(textareaEl, onChange);
		});
		this.createToolButton(parentEl, "square-check", "Insert task list", () => {
			this.toggleLinePrefix(textareaEl, "- [ ] ", onChange);
		});
	}

	private insertIntoTextarea(
		textareaEl: HTMLTextAreaElement,
		text: string,
		onChange?: (value: string) => void,
	): void {
		const start = textareaEl.selectionStart ?? textareaEl.value.length;
		const end = textareaEl.selectionEnd ?? textareaEl.value.length;
		const currentValue = textareaEl.value;
		const nextValue = `${currentValue.slice(0, start)}${text}${currentValue.slice(end)}`;
		textareaEl.value = nextValue;
		if (onChange) {
			onChange(nextValue);
		} else {
			this.composerValue = nextValue;
		}
		const nextCursor = start + text.length;
		textareaEl.focus();
		textareaEl.setSelectionRange(nextCursor, nextCursor);
		textareaEl.dispatchEvent(new Event("input"));
	}

	private async handleTextareaPaste(
		event: ClipboardEvent,
		textareaEl: HTMLTextAreaElement,
		sourcePath: string,
		onChange?: (value: string) => void,
	): Promise<void> {
		const imageFile = this.getPastedImageFile(event);
		if (!imageFile) {
			return;
		}

		event.preventDefault();
		const selectionStart = textareaEl.selectionStart ?? textareaEl.value.length;
		const selectionEnd = textareaEl.selectionEnd ?? textareaEl.value.length;
		const currentValue = textareaEl.value;
		try {
			const attachmentFile = await this.savePastedImage(imageFile, sourcePath);
			const markdownLink = this.createAttachmentEmbedMarkdown(attachmentFile, sourcePath);
			const nextValue = `${currentValue.slice(0, selectionStart)}${markdownLink}${currentValue.slice(selectionEnd)}`;
			textareaEl.value = nextValue;
			onChange?.(nextValue);
			textareaEl.focus();
			const nextCursor = selectionStart + markdownLink.length;
			textareaEl.setSelectionRange(nextCursor, nextCursor);
			textareaEl.dispatchEvent(new Event("input", { bubbles: true }));
			new Notice("Image saved and embedded.");
		} catch (error) {
			console.error("Failed to save pasted image", error);
			new Notice("Failed to save pasted image.");
		}
	}

	private getPastedImageFile(event: ClipboardEvent): File | null {
		const items = event.clipboardData?.items;
		if (!items?.length) {
			return null;
		}

		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			if (!item) {
				continue;
			}

			if (!item.type.startsWith("image/")) {
				continue;
			}

			const file = item.getAsFile();
			if (file) {
				return file;
			}
		}

		return null;
	}

	private async savePastedImage(file: File, sourcePath: string): Promise<TFile> {
		const extension = this.getImageExtension(file);
		const filename = `Pasted image ${createLocalTimestampForFileName(new Date())}.${extension}`;
		const attachmentPath = await this.app.fileManager.getAvailablePathForAttachment(filename, sourcePath);
		const fileBuffer = await file.arrayBuffer();
		return this.app.vault.createBinary(attachmentPath, fileBuffer);
	}

	private createAttachmentEmbedMarkdown(file: TFile, sourcePath: string): string {
		const normalizedPath = sourcePath.replace(/\\/g, "/");
		const sourceDir = normalizedPath.includes("/") ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/")) : "";
		const targetPath = file.path.replace(/\\/g, "/");
		const relativePath = sourceDir && targetPath.startsWith(`${sourceDir}/`)
			? targetPath.slice(sourceDir.length + 1)
			: targetPath;
		return `\n![[${relativePath}]]\n`;
	}

	private getImageExtension(file: File): string {
		const mimeToExtension: Record<string, string> = {
			"image/png": "png",
			"image/jpeg": "jpg",
			"image/webp": "webp",
			"image/gif": "gif",
			"image/svg+xml": "svg",
			"image/bmp": "bmp",
		};
		return mimeToExtension[file.type] ?? "png";
	}

	private toggleWrapSelection(
		textareaEl: HTMLTextAreaElement,
		prefix: string,
		suffix: string,
		onChange?: (value: string) => void,
	): void {
		const start = textareaEl.selectionStart ?? 0;
		const end = textareaEl.selectionEnd ?? 0;
		const currentValue = textareaEl.value;
		const selectedText = currentValue.slice(start, end);
		const before = currentValue.slice(Math.max(0, start - prefix.length), start);
		const after = currentValue.slice(end, end + suffix.length);
		let nextValue = currentValue;
		let nextSelectionStart = start;
		let nextSelectionEnd = end;

		if (selectedText && before === prefix && after === suffix) {
			nextValue =
				`${currentValue.slice(0, start - prefix.length)}${selectedText}${currentValue.slice(end + suffix.length)}`;
			nextSelectionStart = start - prefix.length;
			nextSelectionEnd = nextSelectionStart + selectedText.length;
		} else if (selectedText.startsWith(prefix) && selectedText.endsWith(suffix)) {
			const unwrapped = selectedText.slice(prefix.length, selectedText.length - suffix.length);
			nextValue = `${currentValue.slice(0, start)}${unwrapped}${currentValue.slice(end)}`;
			nextSelectionStart = start;
			nextSelectionEnd = start + unwrapped.length;
		} else {
			const targetText = selectedText || "text";
			const formattedText = `${prefix}${targetText}${suffix}`;
			nextValue = `${currentValue.slice(0, start)}${formattedText}${currentValue.slice(end)}`;
			nextSelectionStart = start + prefix.length;
			nextSelectionEnd = nextSelectionStart + targetText.length;
		}
		textareaEl.value = nextValue;

		if (onChange) {
			onChange(nextValue);
		}

		textareaEl.focus();
		textareaEl.setSelectionRange(nextSelectionStart, nextSelectionEnd);
		textareaEl.dispatchEvent(new Event("input"));
	}

	private toggleLinePrefix(
		textareaEl: HTMLTextAreaElement,
		prefix: string,
		onChange?: (value: string) => void,
	): void {
		const start = textareaEl.selectionStart ?? 0;
		const end = textareaEl.selectionEnd ?? 0;
		const currentValue = textareaEl.value;
		const lineStart = currentValue.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
		const lineEndIndex = currentValue.indexOf("\n", end);
		const lineEnd = lineEndIndex === -1 ? currentValue.length : lineEndIndex;
		const selectedBlock = currentValue.slice(lineStart, lineEnd);
		const lines = selectedBlock.split("\n");
		const shouldRemove = lines.every((line) => line.startsWith(prefix));
		const formattedBlock = lines
			.map((line) => (shouldRemove ? line.slice(prefix.length) : `${prefix}${line}`))
			.join("\n");
		const nextValue = `${currentValue.slice(0, lineStart)}${formattedBlock}${currentValue.slice(lineEnd)}`;
		textareaEl.value = nextValue;

		onChange?.(nextValue);
		textareaEl.focus();
		textareaEl.setSelectionRange(lineStart, lineStart + formattedBlock.length);
		textareaEl.dispatchEvent(new Event("input"));
	}

	private toggleOrderedList(
		textareaEl: HTMLTextAreaElement,
		onChange?: (value: string) => void,
	): void {
		const start = textareaEl.selectionStart ?? 0;
		const end = textareaEl.selectionEnd ?? 0;
		const currentValue = textareaEl.value;
		const lineStart = currentValue.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
		const lineEndIndex = currentValue.indexOf("\n", end);
		const lineEnd = lineEndIndex === -1 ? currentValue.length : lineEndIndex;
		const selectedBlock = currentValue.slice(lineStart, lineEnd);
		const lines = selectedBlock.split("\n");
		const orderedPattern = /^\d+\.\s+/;
		const shouldRemove = lines.every((line) => orderedPattern.test(line));
		const formattedBlock = lines
			.map((line, index) => (shouldRemove ? line.replace(orderedPattern, "") : `${index + 1}. ${line}`))
			.join("\n");
		const nextValue = `${currentValue.slice(0, lineStart)}${formattedBlock}${currentValue.slice(lineEnd)}`;
		textareaEl.value = nextValue;

		onChange?.(nextValue);
		textareaEl.focus();
		textareaEl.setSelectionRange(lineStart, lineStart + formattedBlock.length);
		textareaEl.dispatchEvent(new Event("input"));
	}

	private bindMainInteractions(
		shellEl: HTMLElement,
		composerEl: HTMLElement,
		bodyEl: HTMLElement,
		backToTopButtonEl: HTMLElement,
	): void {
		this.updateShellCompactState(shellEl, this.shouldCompactComposer(bodyEl) && !this.isComposerExpanded);
		this.updateBackToTopButtonState(backToTopButtonEl, bodyEl.scrollTop > 240);

		bodyEl.addEventListener("scroll", () => {
			this.hasScrolledMemoStream = true;
			const shouldCompact = this.shouldCompactComposer(bodyEl) && !this.isComposerExpanded;
			this.updateShellCompactState(shellEl, shouldCompact);
			this.updateBackToTopButtonState(backToTopButtonEl, bodyEl.scrollTop > 240);
		});

		composerEl.addEventListener("focusin", () => {
			this.isComposerExpanded = true;
			this.updateComposerStateClasses(composerEl, true);
			this.updateShellCompactState(shellEl, false);
		});

		composerEl.addEventListener("focusout", () => {
			window.setTimeout(() => {
				const activeElement = document.activeElement;
				if (activeElement && composerEl.contains(activeElement)) {
					return;
				}

				const expanded = Boolean(this.composerValue.trim());
				this.isComposerExpanded = expanded;
				this.updateComposerStateClasses(composerEl, expanded);
				this.updateShellCompactState(shellEl, this.shouldCompactComposer(bodyEl) && !expanded);
			}, 0);
		});
	}

	private shouldCompactComposer(bodyEl: HTMLElement): boolean {
		return this.hasScrolledMemoStream || bodyEl.scrollTop > 0;
	}

	private updateComposerStateClasses(composerEl: HTMLElement, expanded: boolean): void {
		composerEl.toggleClass("is-expanded", expanded);
		composerEl.toggleClass("is-compact", !expanded);
	}

	private updateShellCompactState(shellEl: HTMLElement, compact: boolean): void {
		shellEl.toggleClass("is-composer-compact", compact);
	}

	private updateBackToTopButtonState(buttonEl: HTMLElement, visible: boolean): void {
		buttonEl.toggleClass("is-visible", visible);
	}

	private renderTagTree(parentEl: HTMLElement, nodes: TagTreeNode[], depth: number): void {
		nodes.forEach((node) => {
			const hasChildren = node.children.length > 0;
			const isCollapsed = this.collapsedTagPaths.has(node.path);
			const rowEl = parentEl.createDiv({ cls: "memos-filter-tree-row" });
			rowEl.style.setProperty("--memos-tag-depth", String(depth));

			const guideEl = hasChildren
				? rowEl.createEl("button", {
						cls: `memos-filter-guide has-toggle ${isCollapsed ? "is-collapsed" : "is-expanded"}`,
						attr: {
							type: "button",
							"aria-label": isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`,
							"aria-expanded": String(!isCollapsed),
						},
				  })
				: rowEl.createDiv({ cls: "memos-filter-guide" });
			if (hasChildren) {
				guideEl.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					this.toggleTagTreeNode(node.path);
				});
			}

			const button = rowEl.createEl("button", {
				cls: `memos-filter-item memos-filter-item-tree ${this.activeTag === node.path ? "is-active" : ""}${node.count === 0 ? " is-branch" : ""}` ,
			});
			const labelEl = button.createSpan({ cls: "memos-filter-label" });
			const iconEl = labelEl.createSpan({ cls: "memos-filter-icon" });
			setIcon(iconEl, "tag");
			labelEl.createSpan({ text: node.name });
			button.createSpan({ cls: "memos-filter-count", text: String(node.count) });
			button.addEventListener("click", () => {
				if (node.count === 0) {
					return;
				}

				this.activeTag = this.activeTag === node.path ? null : node.path;
				this.expandTagAncestors(node.path);
				this.resetVisibleMemoCount();
				void this.render();
			});

			if (node.count === 0) {
				button.disabled = true;
			}

			if (hasChildren && !isCollapsed) {
				const childrenEl = parentEl.createDiv({ cls: "memos-filter-tree-children" });
				this.renderTagTree(childrenEl, node.children, depth + 1);
			}
		});
	}

	private toggleTagTreeNode(path: string): void {
		if (this.collapsedTagPaths.has(path)) {
			this.collapsedTagPaths.delete(path);
		} else {
			this.collapsedTagPaths.add(path);
		}

		void this.render();
	}

	private expandTagAncestors(tagPath: string): void {
		getAncestorTagPaths(tagPath).forEach((path) => {
			this.collapsedTagPaths.delete(path);
		});
	}

	private resetVisibleMemoCount(): void {
		this.visibleMemoCount = MEMOS_PAGE_SIZE;
	}

	private getFilteredMemos(): MemoEntry[] {
		return buildViewModel(
			this.memos,
			this.searchTerm,
			this.activeTag,
			this.activeDayKey,
			this.sortOrder,
			this.statusFilter,
		).filteredMemos;
	}

	async startRandomWalk(): Promise<void> {
		const randomWalkMemos = this.getFilteredMemos().filter((memo) => !memo.archivedAt && !memo.deletedAt);
		if (!randomWalkMemos.length) {
			new Notice("No active memos available for random walk in the current filter.");
			return;
		}

		new MemosRandomWalkModal(this, randomWalkMemos).open();
	}

	async openMemoSourceAtLine(memo: MemoEntry): Promise<void> {
		await this.plugin.openSourceFileAtLine(memo.sourcePath, memo.sourceLine);
	}

	private getStatusCounts(): Record<MemosStatusFilter, number> {
		return {
			all: this.memos.filter((memo) => !memo.archivedAt && !memo.deletedAt).length,
			active: this.memos.filter((memo) => !memo.archivedAt && !memo.deletedAt).length,
			archived: this.memos.filter((memo) => Boolean(memo.archivedAt)).length,
			deleted: this.memos.filter((memo) => Boolean(memo.deletedAt)).length,
		};
	}

	private async purgeDeletedMemos(): Promise<void> {
		const deletedMemos = this.memos.filter((memo) => Boolean(memo.deletedAt));
		if (!deletedMemos.length) {
			new Notice("No deleted memos to remove.");
			return;
		}

		const confirmed = window.confirm(`Permanently delete ${deletedMemos.length} deleted memos?`);
		if (!confirmed) {
			return;
		}

		await this.plugin.permanentlyDeleteMarkedMemos(deletedMemos);
		this.inlineEditingMemoId = null;
		this.inlineEditorValue = "";
		if (this.statusFilter === "deleted") {
			this.statusFilter = "all";
		}
		new Notice(`Permanently deleted ${deletedMemos.length} memos.`);
		await this.render();
	}

	private openDeletedFilterMenu(event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(`Delete all`)
				.setIcon("trash")
				.onClick(() => {
					void this.purgeDeletedMemos();
				}),
		);
		menu.showAtMouseEvent(event);
	}

	private async renderMemoCard(parentEl: HTMLElement, memo: MemoEntry): Promise<void> {
		const cardEl = parentEl.createDiv({ cls: "memos-card" });
		cardEl.addEventListener("dblclick", (event) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest("button, a, input, textarea")) {
				return;
			}

			if (window.getSelection()?.toString().trim()) {
				return;
			}

			void this.beginInlineEditingMemo(memo);
		});

		const metaEl = cardEl.createDiv({ cls: "memos-card-meta" });
		const metaInfoEl = metaEl.createDiv({ cls: "memos-card-meta-info" });
		const sourceButton = metaInfoEl.createEl("button", {
			cls: "memos-source-button",
			text: memo.sourceBasename,
		});
		this.highlightSearchMatches(sourceButton);
		sourceButton.addEventListener("click", () => {
			void this.plugin.openSourceFile(memo.sourcePath);
		});
		const timestampButton = metaInfoEl.createEl("button", {
			cls: "memos-timestamp-button",
			text: memo.createdLabel,
		});
		timestampButton.addEventListener("click", () => {
			void this.plugin.openSourceFileAtLine(memo.sourcePath, memo.sourceLine);
		});
		if (memo.archivedAt) {
			this.renderStatusBadge(metaInfoEl, "Archived", "archive");
		}
		if (memo.deletedAt) {
			this.renderStatusBadge(metaInfoEl, "Deleted", "trash-2");
		}

		const metaActionsEl = metaEl.createDiv({ cls: "memos-card-actions" });

		const menuButton = metaActionsEl.createEl("button", {
			cls: "memos-menu-button",
			attr: { "aria-label": "More actions", type: "button" },
		});
		setIcon(menuButton, "ellipsis");
		menuButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.openMemoMenu(event, memo, menuButton);
		});

		if (this.inlineEditingMemoId === memo.id) {
			this.renderInlineMemoEditor(cardEl, memo);
			return;
		}

		const contentEl = cardEl.createDiv({ cls: "memos-card-content markdown-rendered" });
		await MarkdownRenderer.render(this.app, memo.content, contentEl, memo.sourcePath, this);
		contentEl.addEventListener("click", (event) => {
			const target = event.target as HTMLElement | null;
			const linkEl = target?.closest("a.internal-link");
			if (!(linkEl instanceof HTMLAnchorElement)) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			void this.app.workspace.openLinkText(
				linkEl.getAttribute("data-href") ?? linkEl.getAttribute("href") ?? "",
				memo.sourcePath,
				false,
			);
		});
		this.highlightSearchMatches(contentEl);
	}

	private highlightSearchMatches(rootEl: HTMLElement): void {
		const keyword = this.searchTerm.trim();
		if (!keyword) {
			return;
		}

		const pattern = new RegExp(`(${escapeRegExp(keyword)})`, "gi");
		const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
			acceptNode: (node) => {
				const parentElement = node.parentElement;
				if (!parentElement) {
					return NodeFilter.FILTER_REJECT;
				}

				if (parentElement.closest("mark, code, pre, textarea, input")) {
					return NodeFilter.FILTER_REJECT;
				}

				if (!node.textContent?.trim()) {
					return NodeFilter.FILTER_REJECT;
				}

				pattern.lastIndex = 0;
				return pattern.test(node.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
			},
		});
		const textNodes: Text[] = [];
		let currentNode = walker.nextNode();
		while (currentNode) {
			if (currentNode instanceof Text) {
				textNodes.push(currentNode);
			}
			currentNode = walker.nextNode();
		}

		textNodes.forEach((textNode) => {
			const text = textNode.textContent;
			if (!text) {
				return;
			}

			pattern.lastIndex = 0;
			if (!pattern.test(text)) {
				return;
			}

			pattern.lastIndex = 0;
			const fragment = document.createDocumentFragment();
			let lastIndex = 0;
			let match;

			while ((match = pattern.exec(text)) !== null) {
				const matchText = match[0];
				const startIndex = match.index;
				if (startIndex > lastIndex) {
					fragment.append(text.slice(lastIndex, startIndex));
				}

				const markEl = document.createElement("mark");
				markEl.addClass("memos-search-highlight");
				markEl.textContent = matchText;
				fragment.append(markEl);
				lastIndex = startIndex + matchText.length;
			}

			if (lastIndex < text.length) {
				fragment.append(text.slice(lastIndex));
			}

			textNode.replaceWith(fragment);
		});
	}

	private renderInlineMemoEditor(parentEl: HTMLElement, memo: MemoEntry): void {
		const editorEl = parentEl.createDiv({ cls: "memos-inline-editor" });
		const editorWrapEl = editorEl.createDiv({ cls: "memos-inline-editor-body" });
		const textareaEl = editorWrapEl.createEl("textarea", {
			cls: "memos-inline-editor-input",
			placeholder: "Type your thoughts here...",
		});
		const wikilinkSuggestEl = editorWrapEl.createDiv({ cls: "memos-wikilink-suggest", attr: { hidden: "hidden" } });
		textareaEl.value = this.inlineEditorValue;
		textareaEl.addEventListener("input", () => {
			this.inlineEditorValue = textareaEl.value;
			this.autosizeTextarea(textareaEl);
		});
		textareaEl.addEventListener("paste", (event) => {
			void this.handleTextareaPaste(event, textareaEl, memo.sourcePath, (value) => {
				this.inlineEditorValue = value;
				this.autosizeTextarea(textareaEl);
			});
		});
		this.autosizeTextarea(textareaEl);

		const footerEl = editorEl.createDiv({ cls: "memos-inline-editor-footer" });
		const toolsEl = footerEl.createDiv({ cls: "memos-inline-editor-tools" });
		this.createFormattingTools(toolsEl, textareaEl, (value) => {
			this.inlineEditorValue = value;
		});
		this.bindTextareaWikilinkSuggest(textareaEl, wikilinkSuggestEl, memo.sourcePath, (value) => {
			this.inlineEditorValue = value;
		});

		const actionsEl = footerEl.createDiv({ cls: "memos-inline-editor-actions" });
		const counterEl = actionsEl.createDiv({
			cls: "memos-inline-editor-count",
			text: String(this.inlineEditorValue.length),
		});
		textareaEl.addEventListener("input", () => {
			counterEl.setText(String(this.inlineEditorValue.length));
		});

		const cancelButton = actionsEl.createEl("button", {
			cls: "memos-inline-editor-cancel",
			text: "Cancel",
			attr: { type: "button" },
		});
		cancelButton.addEventListener("click", () => {
			this.cancelInlineEditing();
		});

		const submitButton = actionsEl.createEl("button", {
			cls: "memos-inline-editor-submit",
			attr: { "aria-label": "Save memo", type: "button" },
		});
		setIcon(submitButton, "send");
		submitButton.addEventListener("click", async () => {
			await this.saveInlineEditedMemo(memo);
		});

		textareaEl.addEventListener("keydown", (event) => {
			if (event.defaultPrevented) {
				return;
			}

			if (event.key !== "Enter" || event.shiftKey) {
				return;
			}

			event.preventDefault();
			void this.saveInlineEditedMemo(memo);
		});

		window.setTimeout(() => {
			textareaEl.focus();
			textareaEl.setSelectionRange(textareaEl.value.length, textareaEl.value.length);
		}, 0);
	}

	private bindTextareaWikilinkSuggest(
		textareaEl: HTMLTextAreaElement,
		panelEl: HTMLElement,
		sourcePath: string,
		onChange: (value: string) => void,
	): void {
		let suggestions: WikilinkSuggestion[] = [];
		let selectedIndex = 0;
		let activeContext: WikilinkContext | null = null;
		let lockedAnchorTargetPath: string | null = null;
		let syncRequestId = 0;
		let isComposing = false;

		const hidePanel = (): void => {
			suggestions = [];
			selectedIndex = 0;
			activeContext = null;
			lockedAnchorTargetPath = null;
			panelEl.empty();
			panelEl.setAttr("hidden", "hidden");
		};

		const applySuggestion = async (item: WikilinkSuggestion): Promise<void> => {
			const contextAtSelection = activeContext;
			if (!contextAtSelection) {
				hidePanel();
				return;
			}

			if (item.type === "paragraph") {
				const blockId = await this.ensureParagraphBlockId(item);
				if (!blockId) {
					hidePanel();
					return;
				}

				const result = applyWikilinkSuggestion(
					textareaEl.value,
					contextAtSelection.matchEnd,
					contextAtSelection,
					{
						type: "block",
						file: item.file,
						blockId,
						displayText: `^${blockId}`,
						path: item.path,
					},
				);
				textareaEl.value = result.newText;
				onChange(result.newText);
				hidePanel();
				textareaEl.focus();
				textareaEl.setSelectionRange(result.newCursor, result.newCursor);
				textareaEl.dispatchEvent(new Event("input", { bubbles: true }));
				return;
			}

			const result = applyWikilinkSuggestion(
				textareaEl.value,
				contextAtSelection.matchEnd,
				contextAtSelection,
				item,
			);
			textareaEl.value = result.newText;
			onChange(result.newText);
			hidePanel();
			textareaEl.focus();
			textareaEl.setSelectionRange(result.newCursor, result.newCursor);
			textareaEl.dispatchEvent(new Event("input", { bubbles: true }));
		};

		const applyAnchorTransition = (): void => {
			if (!activeContext || !suggestions.length) {
				return;
			}

			const selectedItem = suggestions[selectedIndex];
			const targetFile = selectedItem?.file ?? null;
			const baseName = targetFile?.basename ?? (activeContext.filePart.trim() || "");
			if (!baseName) {
				return;
			}

			lockedAnchorTargetPath = targetFile?.path ?? lockedAnchorTargetPath;

			const before = textareaEl.value.slice(0, activeContext.matchStart);
			const after = textareaEl.value.slice(activeContext.matchEnd);
			const replacement = `[[${baseName}#`;
			const nextValue = `${before}${replacement}${after}`;
			const nextCursor = before.length + replacement.length;

			textareaEl.value = nextValue;
			onChange(nextValue);
			textareaEl.focus();
			textareaEl.setSelectionRange(nextCursor, nextCursor);
			textareaEl.dispatchEvent(new Event("input", { bubbles: true }));
		};

		const renderPanel = (): void => {
			panelEl.empty();
			if (!suggestions.length) {
				panelEl.setAttr("hidden", "hidden");
				panelEl.style.removeProperty("left");
				panelEl.style.removeProperty("top");
				return;
			}

			panelEl.removeAttribute("hidden");
			this.positionWikilinkSuggestPanel(textareaEl, panelEl);
			suggestions.forEach((item, index) => {
				const itemEl = panelEl.createEl("button", {
					cls: `memos-wikilink-suggest-item${index === selectedIndex ? " is-selected" : ""}`,
					attr: {
						type: "button",
						"aria-label": item.path,
					},
				});
				itemEl.addEventListener("mousedown", (event) => {
					event.preventDefault();
					void applySuggestion(item);
				});

				const typeEl = itemEl.createSpan({ cls: "memos-wikilink-suggest-type" });
				typeEl.setText(
					item.type === "file"
						? "File"
						: item.type === "heading"
							? "Heading"
							: item.type === "paragraph"
								? "Paragraph"
								: "Block",
				);

				const contentEl = itemEl.createSpan({ cls: "memos-wikilink-suggest-content" });
				contentEl.createSpan({
					cls: "memos-wikilink-suggest-title",
					text: item.displayText,
				});
				contentEl.createSpan({
					cls: "memos-wikilink-suggest-path",
					text: item.path,
				});
			});

			const selectedItemEl = panelEl.querySelector(".memos-wikilink-suggest-item.is-selected");
			if (selectedItemEl instanceof HTMLElement) {
				selectedItemEl.scrollIntoView({
					block: "nearest",
				});
			}
		};

		const syncPanel = async (): Promise<void> => {
			const requestId = ++syncRequestId;
			const cursor = textareaEl.selectionStart ?? textareaEl.value.length;
			const context = parseWikilinkContext(textareaEl.value, cursor);
			if (!context) {
				hidePanel();
				return;
			}

			if (!context.separator) {
				lockedAnchorTargetPath = null;
			} else if (lockedAnchorTargetPath) {
				const lockedTargetFile = this.app.vault.getAbstractFileByPath(lockedAnchorTargetPath);
				if (
					!(lockedTargetFile instanceof TFile) ||
					(context.filePart.trim() &&
						context.filePart.trim() !== lockedTargetFile.basename &&
						context.filePart.trim() !== lockedTargetFile.path)
				) {
					lockedAnchorTargetPath = null;
				}
			}

			const normalizedContext = expandEmptyAnchorToCurrentFile(this.app, context, sourcePath);
			const nextSuggestions = await getWikilinkSuggestions(
				this.app,
				normalizedContext,
				sourcePath,
				lockedAnchorTargetPath,
			);
			if (requestId !== syncRequestId) {
				return;
			}
			if (!nextSuggestions.length) {
				hidePanel();
				return;
			}

			activeContext = context;
			suggestions = nextSuggestions;
			selectedIndex = Math.min(selectedIndex, suggestions.length - 1);
			renderPanel();
		};

		textareaEl.addEventListener("compositionstart", () => {
			isComposing = true;
		});
		textareaEl.addEventListener("compositionend", () => {
			isComposing = false;
			this.normalizeTextareaWikilinkInput(textareaEl, onChange);
			void syncPanel();
		});
		textareaEl.addEventListener("input", () => {
			if (!isComposing) {
				this.normalizeTextareaWikilinkInput(textareaEl, onChange);
			}
			void syncPanel();
		});
		textareaEl.addEventListener("click", () => {
			void syncPanel();
		});
		textareaEl.addEventListener("keyup", (event) => {
			if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter" || event.key === "Tab") {
				return;
			}
			void syncPanel();
		});
		textareaEl.addEventListener("blur", () => {
			window.setTimeout(() => {
				if (document.activeElement === textareaEl) {
					return;
				}
				hidePanel();
			}, 80);
		});
		textareaEl.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				hidePanel();
				return;
			}

			if (!suggestions.length) {
				return;
			}

			if (event.key === "ArrowDown") {
				event.preventDefault();
				selectedIndex = (selectedIndex + 1) % suggestions.length;
				renderPanel();
				return;
			}

			if (event.key === "ArrowUp") {
				event.preventDefault();
				selectedIndex = (selectedIndex - 1 + suggestions.length) % suggestions.length;
				renderPanel();
				return;
			}

			if (this.isWikilinkAnchorShortcut(event) && activeContext?.separator === "") {
				event.preventDefault();
				applyAnchorTransition();
				return;
			}

			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				void applySuggestion(suggestions[selectedIndex]);
				return;
			}

		});
	}

	private async ensureParagraphBlockId(
		item: Extract<WikilinkSuggestion, { type: "paragraph" }>,
	): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(item.path);
		if (!(file instanceof TFile)) {
			new Notice("Source file no longer exists.");
			return null;
		}

		const rawContent = (await this.app.vault.cachedRead(file)).replace(/\r\n/g, "\n");
		if (item.appendOffset < 0 || item.appendOffset > rawContent.length) {
			new Notice("Could not locate the selected paragraph.");
			return null;
		}

		const existingIds = Object.keys(this.app.metadataCache.getFileCache(file)?.blocks ?? {});
		const blockId = createBlockId(existingIds);
		const nextContent = `${rawContent.slice(0, item.appendOffset)} ^${blockId}${rawContent.slice(item.appendOffset)}`;
		this.plugin.suppressVaultRefresh(file.path);
		await this.app.vault.modify(file, nextContent);
		return blockId;
	}

	private isWikilinkAnchorShortcut(event: KeyboardEvent): boolean {
		if (event.key === "#") {
			return true;
		}

		if (event.shiftKey && event.code === "Digit3") {
			return true;
		}

		return false;
	}

	private normalizeTextareaWikilinkInput(
		textareaEl: HTMLTextAreaElement,
		onChange: (value: string) => void,
	): boolean {
		const cursor = textareaEl.selectionStart ?? textareaEl.value.length;
		let value = textareaEl.value;
		let nextCursor = cursor;
		let changed = false;

		if (cursor >= 2 && value.slice(cursor - 2, cursor) === "【【") {
			value = `${value.slice(0, cursor - 2)}[[${value.slice(cursor)}`;
			changed = true;
		}

		if (cursor >= 3 && value.slice(cursor - 3, cursor) === "#……") {
			value = `${value.slice(0, cursor - 3)}#^${value.slice(cursor)}`;
			nextCursor -= 1;
			changed = true;
		}

		if (!changed) {
			return false;
		}

		textareaEl.value = value;
		onChange(value);
		textareaEl.setSelectionRange(nextCursor, nextCursor);
		return true;
	}

	private positionWikilinkSuggestPanel(
		textareaEl: HTMLTextAreaElement,
		panelEl: HTMLElement,
	): void {
		const caretOffset = this.measureTextareaCaretOffset(textareaEl);
		const horizontalPadding = 12;
		const verticalGap = 8;
		const maxPanelWidth = Math.min(420, Math.max(260, textareaEl.clientWidth - horizontalPadding * 2));
		const panelWidth = Math.min(maxPanelWidth, textareaEl.clientWidth);
		const maxLeft = Math.max(horizontalPadding, textareaEl.clientWidth - panelWidth);
		const nextLeft = Math.min(Math.max(caretOffset.left, horizontalPadding), maxLeft);
		const nextTop = Math.min(
			Math.max(caretOffset.top + caretOffset.lineHeight + verticalGap, verticalGap),
			Math.max(verticalGap, textareaEl.clientHeight - 16),
		);

		panelEl.style.width = `${panelWidth}px`;
		panelEl.style.left = `${nextLeft}px`;
		panelEl.style.top = `${nextTop}px`;
	}

	private measureTextareaCaretOffset(
		textareaEl: HTMLTextAreaElement,
	): { left: number; top: number; lineHeight: number } {
		const mirrorEl = document.createElement("div");
		const style = window.getComputedStyle(textareaEl);
		const textareaRect = textareaEl.getBoundingClientRect();
		const cursor = textareaEl.selectionStart ?? textareaEl.value.length;
		const contentBeforeCursor = textareaEl.value.slice(0, cursor);
		const contentAfterCursor = textareaEl.value.slice(cursor) || ".";

		mirrorEl.style.position = "absolute";
		mirrorEl.style.visibility = "hidden";
		mirrorEl.style.pointerEvents = "none";
		mirrorEl.style.whiteSpace = "pre-wrap";
		mirrorEl.style.wordBreak = "break-word";
		mirrorEl.style.overflowWrap = "anywhere";
		mirrorEl.style.boxSizing = "border-box";
		mirrorEl.style.left = "-9999px";
		mirrorEl.style.top = "0";
		mirrorEl.style.width = `${textareaRect.width}px`;
		mirrorEl.style.font = style.font;
		mirrorEl.style.fontFamily = style.fontFamily;
		mirrorEl.style.fontFeatureSettings = style.fontFeatureSettings;
		mirrorEl.style.fontKerning = style.fontKerning;
		mirrorEl.style.fontSize = style.fontSize;
		mirrorEl.style.fontStretch = style.fontStretch;
		mirrorEl.style.fontStyle = style.fontStyle;
		mirrorEl.style.fontVariant = style.fontVariant;
		mirrorEl.style.fontWeight = style.fontWeight;
		mirrorEl.style.letterSpacing = style.letterSpacing;
		mirrorEl.style.lineHeight = style.lineHeight;
		mirrorEl.style.padding = style.padding;
		mirrorEl.style.border = style.border;

		const beforeEl = document.createElement("span");
		beforeEl.textContent = contentBeforeCursor;
		mirrorEl.appendChild(beforeEl);

		const caretEl = document.createElement("span");
		caretEl.textContent = "\u200b";
		mirrorEl.appendChild(caretEl);

		const afterEl = document.createElement("span");
		afterEl.textContent = contentAfterCursor;
		mirrorEl.appendChild(afterEl);

		document.body.appendChild(mirrorEl);

		const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.6 || 22;
		const left = caretEl.offsetLeft - textareaEl.scrollLeft;
		const top = caretEl.offsetTop - textareaEl.scrollTop;

		mirrorEl.remove();

		return {
			left,
			top,
			lineHeight,
		};
	}

	private openMemoMenu(event: MouseEvent, memo: MemoEntry, anchorEl: HTMLElement): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Pin")
				.setIcon("pin")
				.onClick(() => {
					new Notice("Pin support is coming soon.");
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle("Edit")
				.setIcon("pencil")
				.onClick(() => {
					void this.beginInlineEditingMemo(memo);
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle(memo.archivedAt ? "Unarchive" : "Archive")
				.setIcon("archive")
				.onClick(() => {
					void this.toggleArchiveMemo(memo);
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle(memo.deletedAt ? "Restore" : "Delete")
				.setIcon(memo.deletedAt ? "rotate-ccw" : "trash")
				.onClick(() => {
					void this.deleteMemo(memo);
				}),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Share")
				.setIcon("share")
				.onClick(() => {
					void this.shareMemo(memo);
				}),
		);
		// menu.addSeparator();
		// menu.addItem((item) =>
		// 	item
		// 		.setTitle("Show history")
		// 		.setIcon("history")
		// 		.onClick(() => {
		// 			new Notice("Use Obsidian's file history in the source note to review older versions.");
		// 		}),
		// );
		menu.showAtMouseEvent(event);
	}

	private async shareMemo(memo: MemoEntry): Promise<void> {
		const shareText = `${memo.content}\n\n${memo.sourcePath}`;
		try {
			await navigator.clipboard.writeText(shareText);
			new Notice("Memo copied to clipboard.");
		} catch (error) {
			console.error("Failed to copy memo content", error);
			new Notice("Copy failed.");
		}
	}

	private async beginEditingMemo(memo: MemoEntry): Promise<void> {
		this.editingMemo = memo;
		this.composerValue = memo.content;
		this.isComposerExpanded = true;
		await this.render();

		const textarea = this.contentEl.find(".memos-composer-input");
		if (textarea instanceof HTMLTextAreaElement) {
			textarea.focus();
			textarea.setSelectionRange(textarea.value.length, textarea.value.length);
		}
	}

	private async beginInlineEditingMemo(memo: MemoEntry): Promise<void> {
		this.inlineEditingMemoId = memo.id;
		this.inlineEditorValue = memo.content;
		this.renderFilteredMemoStream();
	}

	private cancelInlineEditing(): void {
		this.inlineEditingMemoId = null;
		this.inlineEditorValue = "";
		this.renderFilteredMemoStream();
	}

	private async saveInlineEditedMemo(memo: MemoEntry): Promise<void> {
		if (!this.inlineEditorValue.trim()) {
			new Notice("Write something first.");
			return;
		}

		await this.plugin.updateMemoEntry(memo, this.inlineEditorValue);
		this.inlineEditingMemoId = null;
		this.inlineEditorValue = "";
		new Notice("Memo updated.");
		await this.render();
	}

	private renderStatusBadge(parentEl: HTMLElement, label: string, icon: string): void {
		const badgeEl = parentEl.createSpan({ cls: "memos-status-badge" });
		const iconEl = badgeEl.createSpan({ cls: "memos-status-badge-icon" });
		setIcon(iconEl, icon);
		badgeEl.createSpan({ text: label });
	}

	private async toggleArchiveMemo(memo: MemoEntry): Promise<void> {
		await this.plugin.archiveMemoEntry(memo);
		if (this.inlineEditingMemoId === memo.id) {
			this.inlineEditingMemoId = null;
			this.inlineEditorValue = "";
		}
		new Notice(memo.archivedAt ? "Memo moved back to active." : "Memo archived.");
		await this.render();
	}

	private async deleteMemo(memo: MemoEntry): Promise<void> {
		await this.plugin.deleteMemoEntry(memo);
		if (this.inlineEditingMemoId === memo.id) {
			this.inlineEditingMemoId = null;
			this.inlineEditorValue = "";
		}
		new Notice(memo.deletedAt ? "Memo restored." : "Memo marked as deleted.");
		await this.render();
	}
}

class MemosRandomWalkModal extends Modal {
	private readonly view: MemosView;
	private readonly memos: MemoEntry[];
	private currentMemo: MemoEntry | null = null;

	constructor(view: MemosView, memos: MemoEntry[]) {
		super(view.app);
		this.view = view;
		this.memos = memos;
	}

	onOpen(): void {
		this.modalEl.addClass("memos-random-walk-modal");
		this.contentEl.empty();
		void this.showRandomMemo();
	}

	onClose(): void {
		this.contentEl.empty();
		this.modalEl.removeClass("memos-random-walk-modal");
	}

	private async showRandomMemo(): Promise<void> {
		const nextMemo = this.pickRandomMemo();
		if (!nextMemo) {
			new Notice("No memos available for random walk in the current filter.");
			this.close();
			return;
		}

		this.currentMemo = nextMemo;
		await this.renderCurrentMemo();
	}

	private pickRandomMemo(): MemoEntry | null {
		if (!this.memos.length) {
			return null;
		}

		if (this.memos.length === 1) {
			return this.memos[0] ?? null;
		}

		let candidate = this.memos[Math.floor(Math.random() * this.memos.length)] ?? null;
		let attempts = 0;
		while (candidate && this.currentMemo && candidate.id === this.currentMemo.id && attempts < 6) {
			candidate = this.memos[Math.floor(Math.random() * this.memos.length)] ?? null;
			attempts += 1;
		}

		return candidate;
	}

	private async renderCurrentMemo(): Promise<void> {
		if (!this.currentMemo) {
			return;
		}

		const memo = this.currentMemo;
		this.contentEl.empty();

		const shellEl = this.contentEl.createDiv({ cls: "memos-random-walk-shell" });
		const orbitEl = shellEl.createDiv({ cls: "memos-random-walk-orbit" });
		orbitEl.createDiv({ cls: "memos-random-walk-orbit-dot is-one" });
		orbitEl.createDiv({ cls: "memos-random-walk-orbit-dot is-two" });
		orbitEl.createDiv({ cls: "memos-random-walk-orbit-dot is-three" });

		const cardEl = shellEl.createDiv({ cls: "memos-random-walk-card" });
		const headerEl = cardEl.createDiv({ cls: "memos-random-walk-header" });
		const eyebrowEl = headerEl.createDiv({ cls: "memos-random-walk-eyebrow" });
		eyebrowEl.createSpan({ text: "Random walk" });
		eyebrowEl.createSpan({ cls: "memos-random-walk-slash", text: "/" });
		eyebrowEl.createSpan({ text: memo.dayKey });

		const titleRowEl = headerEl.createDiv({ cls: "memos-random-walk-title-row" });
		titleRowEl.createEl("h2", { text: memo.sourceBasename });
		const shuffleButtonEl = titleRowEl.createEl("button", {
			cls: "memos-random-walk-next",
			attr: { type: "button", "aria-label": "Next random memo" },
		});
		setIcon(shuffleButtonEl, "shuffle");
		shuffleButtonEl.addEventListener("click", () => {
			void this.showRandomMemo();
		});

		const metaEl = cardEl.createDiv({ cls: "memos-random-walk-meta" });
		this.createMetaPill(metaEl, "clock-3", memo.createdLabel);
		if (memo.archivedAt) {
			this.createMetaPill(metaEl, "archive", "Archived");
		}
		if (memo.deletedAt) {
			this.createMetaPill(metaEl, "trash-2", "Deleted");
		}
		memo.tags.slice(0, 6).forEach((tag) => {
			this.createMetaPill(metaEl, "hash", tag.replace(/^#/, ""));
		});

		const bodyEl = cardEl.createDiv({ cls: "memos-random-walk-body markdown-rendered" });
		await MarkdownRenderer.render(this.app, memo.content, bodyEl, memo.sourcePath, this.view);

		const footerEl = cardEl.createDiv({ cls: "memos-random-walk-footer" });
		const sourceInfoEl = footerEl.createDiv({ cls: "memos-random-walk-source" });
		sourceInfoEl.createSpan({ text: memo.sourcePath });

		const actionsEl = footerEl.createDiv({ cls: "memos-random-walk-actions" });
		const openButtonEl = actionsEl.createEl("button", {
			cls: "memos-random-walk-action is-secondary",
			text: "Open source",
			attr: { type: "button" },
		});
		openButtonEl.addEventListener("click", () => {
			void this.openSourceAndClose(memo);
		});

		const nextButtonEl = actionsEl.createEl("button", {
			cls: "memos-random-walk-action is-primary",
			text: "Next wander",
			attr: { type: "button" },
		});
		nextButtonEl.addEventListener("click", () => {
			void this.showRandomMemo();
		});
	}

	private createMetaPill(parentEl: HTMLElement, icon: string, label: string): void {
		const pillEl = parentEl.createDiv({ cls: "memos-random-walk-pill" });
		const iconEl = pillEl.createSpan({ cls: "memos-random-walk-pill-icon" });
		setIcon(iconEl, icon);
		pillEl.createSpan({ text: label });
	}

	private async openSourceAndClose(memo: MemoEntry): Promise<void> {
		await this.view.openMemoSourceAtLine(memo);
		this.close();
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createLocalTimestampForFileName(date: Date): string {
	const year = String(date.getFullYear()).padStart(4, "0");
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");
	return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function getSortMenuItems(): Array<{ title: string; value: MemosSortOrder }> {
	return [
		{ title: "Created time, newest first", value: "created-desc" },
		{ title: "Created time, oldest first", value: "created-asc" },
		{ title: "Edited time, newest first", value: "updated-desc" },
		{ title: "Edited time, oldest first", value: "updated-asc" },
	];
}

function getSortLabel(sortOrder: MemosSortOrder): string {
	switch (sortOrder) {
		case "created-asc":
			return "created time, oldest first";
		case "updated-desc":
			return "edited time, newest first";
		case "updated-asc":
			return "edited time, oldest first";
		case "created-desc":
		default:
			return "created time, newest first";
	}
}

function buildTagTree(tagStats: Array<{ tag: string; count: number }>): TagTreeNode[] {
	const root = new Map<string, MutableTagTreeNode>();

	tagStats.forEach(({ tag, count }) => {
		const normalizedTag = tag.startsWith("#") ? tag.slice(1) : tag;
		const parts = normalizedTag.split("/").filter(Boolean);
		let currentLevel = root;
		let currentPath = "#";

		parts.forEach((part, index) => {
			currentPath = index === 0 ? `#${part}` : `${currentPath}/${part}`;
			let node = currentLevel.get(currentPath);
			if (!node) {
				node = {
					name: part,
					path: currentPath,
					count: 0,
					children: [],
					childMap: new Map<string, MutableTagTreeNode>(),
				};
				currentLevel.set(currentPath, node);
			}

			if (index === parts.length - 1) {
				node.count = count;
			}

			currentLevel = node.childMap;
		});
	});

	return mapToNodes(root);
}
function getAncestorTagPaths(tagPath: string): string[] {
	const normalizedTag = tagPath.startsWith("#") ? tagPath.slice(1) : tagPath;
	const parts = normalizedTag.split("/").filter(Boolean);
	const ancestors: string[] = [];

	for (let index = 0; index < parts.length - 1; index += 1) {
		ancestors.push(`#${parts.slice(0, index + 1).join("/")}`);
	}

	return ancestors;
}

function mapToNodes(nodes: Map<string, MutableTagTreeNode>): TagTreeNode[] {
	const result = [...nodes.values()].map((node) => {
		return {
			name: node.name,
			path: node.path,
			count: node.count,
			children: mapToNodes(node.childMap),
		};
	});

	return result.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
}
