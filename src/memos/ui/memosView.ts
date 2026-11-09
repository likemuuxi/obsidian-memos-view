import { ItemView, MarkdownRenderer, Menu, Notice, Platform, WorkspaceLeaf, setIcon, type ViewStateResult } from "obsidian";
import { Scope } from "obsidian";
import type MemosViewPlugin from "../../main";
import { TFile } from "obsidian";
import { VIEW_TYPE_MEMOS } from "../../types";
import type { MemosViewFilter, MemosSortOrder, MemosStatusFilter } from "../core/viewModel";
import { t, isZhLocale } from "../../i18n";
import type { MemoEntry, MemosViewState } from "../../types";
import { loadMemosFromDailyNotes } from "../core/memoStore";
import { buildViewModel } from "../core/viewModel";
import type { HeatmapWeek, HeatmapMonthLabel } from "../core/viewModel";
import {
	applyWikilinkSuggestion,
	createBlockId,
	expandEmptyAnchorToCurrentFile,
	getWikilinkSuggestions,
	parseWikilinkContext,
	type WikilinkContext,
	type WikilinkSuggestion,
} from "../wikilink";
import { openMemoShareModal } from "../share";
import { buildAttachmentEmbedLink } from "../../utils/embed";
import { WikilinkSuggestController } from "../../editor/wikilinkSuggest";
import { insertTextAtCaret } from "../../utils/text";
import { MemosRandomWalkModal } from "./modals/randomWalkModal";
import { AttachmentPickerModal } from "./modals/attachmentPickerModal";
import { PermanentDeleteModal, collectDeletableAttachments } from "./modals/permanentDeleteModal";
import { MemosFullscreenEditorModal } from "./modals/fullscreenEditorModal";
import { VoiceRecorder } from "./voiceRecorder";

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
	protected memoStreamContainerEl: HTMLElement | null = null;
	private stickyDayHeadEl: HTMLElement | null = null;
	private collapsedTagPaths = new Set<string>();
	private searchTerm = "";
	private isSearchComposing = false;
	private activeTag: string | null = null;
	private activeDayKey: string | null = null;
	/** 子类可覆盖默认排序(侧边栏视图使用时间升序:最新在最底部) */
	protected sortOrder: MemosSortOrder = "created-desc";
	private statusFilter: MemosStatusFilter = "all";
	private viewFilter: MemosViewFilter = "none";
	private visibleMemoCount = MEMOS_PAGE_SIZE;
	private composerValue = "";
	private isComposerExpanded = false;
	private isComposerPreview = false;
	private hasScrolledMemoStream = false;
	private editingMemo: MemoEntry | null = null;
	private inlineEditingMemoId: string | null = null;
	private inlineEditorValue = "";
	private isInlineEditorPreview = false;
	private sidebarEl: HTMLElement | null = null;
	private sidebarOverlayEl: HTMLElement | null = null;
	private isSidebarOpen = false;
	/** 子类可设为 true 强制使用紧凑布局(侧边栏视图) */
	protected forceCompactLayout = false;
	/** 异步渲染/滚动恢复的定时器与 rAF id,在 onClose 中统一清理 */
	private pendingFrameIds = new Set<number>();
	private isClosed = false;
	private wikilinkControllers: WikilinkSuggestController[] = [];
	private voiceRecorder = new VoiceRecorder();

	constructor(leaf: WorkspaceLeaf, plugin: MemosViewPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_MEMOS;
	}

	getDisplayText(): string {
		return t("view.displayName");
	}

	getIcon(): string {
		return "lightbulb";
	}

	async onOpen(): Promise<void> {
		this.containerEl.addClass("memos-view");
		this.scope = new Scope(this.app.scope);
		this.scope.register([], "Escape", () => {
			if (this.inlineEditingMemoId) {
				this.cancelInlineEditing();
			}
			return false;
		});
		this.registerDomEvent(window, "keydown", (event: KeyboardEvent) => {
			if (this.handleInlineEditorEscape(event)) {
				return;
			}

			if (!isSaveShortcut(event)) {
				return;
			}

			const target = event.target as HTMLElement | null;
			if (!target || !this.containerEl.contains(target)) {
				return;
			}

			const textareaEl = target.closest("textarea");
			if (!(textareaEl instanceof HTMLTextAreaElement)) {
				return;
			}

			if (!textareaEl.matches(".memos-composer-input, .memos-inline-editor-input")) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			void this.saveActiveTextareaMemo(textareaEl);
		}, { capture: true });
		this.registerDomEvent(this.containerEl, "keydown", (event: KeyboardEvent) => {
			if (!isEscapeKey(event)) {
				return;
			}

			const target = event.target as HTMLElement | null;
			if (!target || !this.containerEl.contains(target)) {
				return;
			}

			if (target.closest(".memos-inline-editor")) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				this.cancelInlineEditing();
				return;
			}

			event.preventDefault();
			event.stopPropagation();
		}, { capture: true });
		this.registerDomEvent(this.containerEl, "keyup", (event: KeyboardEvent) => {
			if (!isEscapeKey(event)) {
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
		this.isClosed = true;
		this.voiceRecorder.cancel();
		this.wikilinkControllers.forEach((c) => c.destroy());
		this.wikilinkControllers = [];
		this.pendingFrameIds.forEach((id) => {
			window.clearTimeout(id);
			window.cancelAnimationFrame(id);
		});
		this.pendingFrameIds.clear();
		this.contentEl.empty();
		document.body.querySelectorAll(".memos-heatmap-preview").forEach((el) => el.remove());
	}

	/** 注册一个延迟回调,视图关闭时自动清理 */
	protected scheduleTimeout(callback: () => void, delay: number): void {
		if (this.isClosed) {
			return;
		}
		const id = window.setTimeout(() => {
			this.pendingFrameIds.delete(id);
			if (!this.isClosed) {
				callback();
			}
		}, delay);
		this.pendingFrameIds.add(id);
	}

	/** 注册一个 rAF 回调,视图关闭时自动清理 */
	protected scheduleFrame(callback: () => void): void {
		if (this.isClosed) {
			return;
		}
		const id = window.requestAnimationFrame(() => {
			this.pendingFrameIds.delete(id);
			if (!this.isClosed) {
				callback();
			}
		});
		this.pendingFrameIds.add(id);
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

	protected async render(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();

		const shellEl = contentEl.createDiv({ cls: "memos-shell" });
		const isCompact = this.forceCompactLayout || this.isSidebarLeaf();
		shellEl.toggleClass("is-compact", isCompact);
		shellEl.addEventListener("click", (event) => {
			if (!this.inlineEditingMemoId) {
				return;
			}
			const target = event.target as HTMLElement | null;
			if (target?.closest(".memos-inline-editor") || target?.closest(".memos-card")) {
				return;
			}
			this.cancelInlineEditing();
		});

		this.sidebarOverlayEl = shellEl.createDiv({ cls: "memos-sidebar-overlay" });
		this.sidebarOverlayEl.addEventListener("click", () => {
			this.closeSidebar();
		});

		const layoutEl = shellEl.createDiv({ cls: "memos-layout" });
		const sidebarEl = layoutEl.createDiv({ cls: "memos-sidebar" });
		this.sidebarEl = sidebarEl;
		sidebarEl.createEl("div", {
			cls: "memos-brand",
			text: this.plugin.settings.displayName || "memos",
		});

		const mainEl = layoutEl.createDiv({ cls: "memos-main" });
		const mainHeaderEl = mainEl.createDiv({ cls: "memos-main-header" });
		this.renderTopbar(mainHeaderEl);
		const composerEl = this.renderComposer(mainHeaderEl);
		const bodyEl = mainEl.createDiv({ cls: "memos-main-body" });
		const stickyDayHeadEl = bodyEl.createDiv({ cls: "memos-sticky-day-head" });
		stickyDayHeadEl.createSpan({ cls: "memos-sticky-day-head-label" });
		stickyDayHeadEl.addEventListener("click", () => {
			const labelText = stickyDayHeadEl.querySelector(".memos-sticky-day-head-label")?.textContent ?? "";
			if (!labelText) {
				return;
			}
			const dayHeads = bodyEl.querySelectorAll<HTMLElement>(".memos-day-head");
			for (let i = 0; i < dayHeads.length; i++) {
				const head = dayHeads.item(i);
				if (head.querySelector(".memos-day-head-label")?.textContent === labelText) {
					head.scrollIntoView({ behavior: "smooth", block: "start" });
					break;
				}
			}
		});
		const backToTopButtonEl = this.createBackToTopButton(mainEl, bodyEl);
		this.memoStreamContainerEl = bodyEl;
		this.stickyDayHeadEl = stickyDayHeadEl;
		this.bindMainInteractions(shellEl, composerEl, bodyEl, backToTopButtonEl);

		// 检查日记插件路径是否已设置
		const dailyNotesFolder = this.plugin.getDailyNotesFolder();
		if (!dailyNotesFolder) {
			// 未设置日记目录:清空备忘录数据,跳过磁盘加载
			this.memos = [];
		} else {
			this.memos = await loadMemosFromDailyNotes(
				this.app,
				dailyNotesFolder,
				this.plugin.settings.timestampFormat,
				this.plugin.settings.memoReadMode,
				this.plugin.settings.memoReadHeading,
				this.plugin.settings.boundFilePath || undefined,
			);
		}

		const viewModel = buildViewModel(
			this.memos,
			this.searchTerm,
			this.activeTag,
			this.activeDayKey,
			this.sortOrder,
			this.statusFilter,
			this.viewFilter,
		);

		if (!isCompact) {
			this.populateSidebar(
				sidebarEl,
				viewModel.totalMemos,
				viewModel.totalTags,
				viewModel.totalDays,
				viewModel.heatmap,
				viewModel.heatmapMonths,
				viewModel.tagStats,
				this.getStatusCounts(),
			);
		}
		this.renderMemoStream(bodyEl, viewModel.filteredMemos);
		this.updateStickyDayHead();
		if (this.isSidebarOpen) {
			this.openSidebar();
		}
	}

	private openSidebar(): void {
		this.isSidebarOpen = true;
		this.sidebarEl?.addClass("is-open");
		this.sidebarOverlayEl?.addClass("is-visible");
	}

	private closeSidebar(): void {
		this.isSidebarOpen = false;
		this.sidebarEl?.removeClass("is-open");
		this.sidebarOverlayEl?.removeClass("is-visible");
	}

	/** 判断当前视图是否位于左右侧边栏,用于切换紧凑布局 */
	private isSidebarLeaf(): boolean {
		const root = this.leaf.getRoot();
		return root === this.app.workspace.leftSplit || root === this.app.workspace.rightSplit;
	}

	private populateSidebar(
		sidebarEl: HTMLElement,
		totalMemos: number,
		totalTags: number,
		totalDays: number,
		heatmap: Array<{
			key: string;
			cells: Array<{ dayKey: string; count: number; level: number; isToday: boolean; previews: Array<{ time: string; content: string }> }>;
		}>,
		heatmapMonths: Array<{ label: string; column: number }>,
		tagStats: Array<{ tag: string; count: number }>,
		statusCounts: Record<MemosStatusFilter, number>,
	): void {
		sidebarEl.empty();
		sidebarEl.style.setProperty("--memos-heatmap-columns", String(heatmap.length));
		sidebarEl.createEl("div", {
			cls: "memos-brand",
			text: this.plugin.settings.displayName || "memos",
		});

		const statsEl = sidebarEl.createDiv({ cls: "memos-stats" });
		this.renderStat(statsEl, String(totalMemos), t("view.notes"));
		this.renderStat(statsEl, String(totalTags), t("view.tags"));
		this.renderStat(statsEl, String(totalDays), t("view.days"));

		const heatmapSectionEl = sidebarEl.createDiv({ cls: "memos-heatmap-section" });
		this.populateHeatmapSection(heatmapSectionEl, heatmap, heatmapMonths);

		const filtersEl = sidebarEl.createDiv({ cls: "memos-filters" });
		this.renderStatusFilters(filtersEl, statusCounts);
		this.renderViewFilters(filtersEl);
		filtersEl.createEl("div", { cls: "memos-filters-heading", text: t("view.allTags") });
		const treeEl = filtersEl.createDiv({ cls: "memos-filter-tree" });
		this.renderTagTree(treeEl, buildTagTree(tagStats), 0);
	}

	private renderStatusFilters(
		parentEl: HTMLElement,
		statusCounts: Record<MemosStatusFilter, number>,
	): void {
		const wrapEl = parentEl.createDiv({ cls: "memos-status-filters" });
		this.createStatusFilterButton(wrapEl, "all", t("view.all"), "layers", statusCounts.all);
		this.createStatusFilterButton(wrapEl, "archived", t("view.archived"), "archive", statusCounts.archived);
		this.createStatusFilterButton(wrapEl, "deleted", t("view.deleted"), "trash-2", statusCounts.deleted);
	}

	private renderViewFilters(parentEl: HTMLElement): void {
		parentEl.createEl("div", { cls: "memos-filters-heading", text: t("viewFilters.views") });
		const wrapEl = parentEl.createDiv({ cls: "memos-view-filters" });
		const filters: Array<{ id: MemosViewFilter; label: string; icon: string }> = [
			{ id: "today", label: t("viewFilters.today"), icon: "sun" },
			{ id: "week", label: t("viewFilters.week"), icon: "calendar-range" },
			{ id: "todo", label: t("viewFilters.todo"), icon: "check-square" },
			{ id: "tagged", label: t("viewFilters.tagged"), icon: "tag" },
			{ id: "has-link", label: t("viewFilters.hasLink"), icon: "link" },
		];
		for (const { id, label, icon } of filters) {
			const buttonEl = wrapEl.createEl("button", {
				cls: `memos-view-filter-button${this.viewFilter === id ? " is-active" : ""}`,
				attr: {
					type: "button",
					"aria-pressed": String(this.viewFilter === id),
					"data-view-filter": id,
				},
			});
			const iconEl = buttonEl.createSpan({ cls: "memos-view-filter-icon" });
			setIcon(iconEl, icon);
			buttonEl.createSpan({ cls: "memos-view-filter-label", text: label });
			buttonEl.addEventListener("click", () => {
				this.viewFilter = this.viewFilter === id ? "none" : id;
				this.resetVisibleMemoCount();
				this.updateViewFilterButtonStates();
				this.closeSidebar();
				this.renderFilteredMemoStream();
			});
		}

		// 有附件:放在最后,点击弹出二级菜单选择附件类型(全部/图片/音频/视频/文件)
		const attachmentActive = this.isAttachmentFilterActive();
		const attachmentButtonEl = wrapEl.createEl("button", {
			cls: `memos-view-filter-button${attachmentActive ? " is-active" : ""}`,
			attr: {
				type: "button",
				"aria-pressed": String(attachmentActive),
				"aria-haspopup": "menu",
				"data-view-filter": "has-attachment",
			},
		});
		const attachmentIconEl = attachmentButtonEl.createSpan({ cls: "memos-view-filter-icon" });
		setIcon(attachmentIconEl, "paperclip");
		attachmentButtonEl.createSpan({ cls: "memos-view-filter-label", text: this.getAttachmentFilterLabel() });
		attachmentButtonEl.addEventListener("click", (event) => {
			this.openAttachmentFilterMenu(event);
		});
	}

	private updateViewFilterButtonStates(): void {
		this.sidebarEl?.querySelectorAll(".memos-view-filter-button").forEach((buttonEl) => {
			if (!(buttonEl instanceof HTMLElement)) {
				return;
			}
			const id = buttonEl.dataset.viewFilter as MemosViewFilter | undefined;
			const isActive = id === "has-attachment" ? this.isAttachmentFilterActive() : id === this.viewFilter;
			buttonEl.toggleClass("is-active", isActive);
			buttonEl.setAttribute("aria-pressed", String(isActive));
			if (id === "has-attachment") {
				const labelEl = buttonEl.querySelector(".memos-view-filter-label");
				if (labelEl) {
					labelEl.textContent = this.getAttachmentFilterLabel();
				}
			}
		});
	}

	/** 当前是否启用了任意附件类筛选(has-attachment 或任一子类型) */
	private isAttachmentFilterActive(): boolean {
		return (
			this.viewFilter === "has-attachment" ||
			this.viewFilter === "has-image" ||
			this.viewFilter === "has-audio" ||
			this.viewFilter === "has-video" ||
			this.viewFilter === "has-file"
		);
	}

	/** 附件筛选项当前应显示的标签(选中子类型时显示子类型名) */
	private getAttachmentFilterLabel(): string {
		switch (this.viewFilter) {
			case "has-image":
				return t("viewFilters.attachmentImage");
			case "has-audio":
				return t("viewFilters.attachmentAudio");
			case "has-video":
				return t("viewFilters.attachmentVideo");
			case "has-file":
				return t("viewFilters.attachmentFile");
			case "has-attachment":
			default:
				return t("viewFilters.hasAttachment");
		}
	}

	/** 附件筛选二级菜单:选择全部附件或指定类型,再次点击已选项则清除筛选 */
	private openAttachmentFilterMenu(event: MouseEvent): void {
		const menu = new Menu();
		const options: Array<{ id: MemosViewFilter; label: string; icon: string }> = [
			{ id: "has-attachment", label: t("viewFilters.hasAttachment"), icon: "paperclip" },
			{ id: "has-image", label: t("viewFilters.attachmentImage"), icon: "image" },
			{ id: "has-audio", label: t("viewFilters.attachmentAudio"), icon: "audio-file" },
			{ id: "has-video", label: t("viewFilters.attachmentVideo"), icon: "film" },
			{ id: "has-file", label: t("viewFilters.attachmentFile"), icon: "file-text" },
		];
		for (const { id, label, icon } of options) {
			menu.addItem((item) => {
				item.setTitle(label).setIcon(icon);
				if (this.viewFilter === id) {
					item.setChecked(true);
				}
				item.onClick(() => {
					this.viewFilter = this.viewFilter === id ? "none" : id;
					this.resetVisibleMemoCount();
					this.updateViewFilterButtonStates();
					this.closeSidebar();
					this.renderFilteredMemoStream();
				});
			});
		}
		menu.showAtMouseEvent(event);
	}

	private updateTagFilterButtonStates(): void {
		this.sidebarEl?.querySelectorAll(".memos-filter-item").forEach((buttonEl) => {
			if (!(buttonEl instanceof HTMLElement)) {
				return;
			}
			const tagPath = buttonEl.dataset.tagPath;
			const isActive = tagPath === this.activeTag;
			buttonEl.toggleClass("is-active", isActive);
		});
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
				"data-status-filter": filter,
			},
		});
		const labelEl = buttonEl.createSpan({ cls: "memos-status-filter-label" });
		const iconEl = labelEl.createSpan({ cls: "memos-status-filter-icon" });
		setIcon(iconEl, icon);
		labelEl.createSpan({ text: label });
		buttonEl.createSpan({ cls: "memos-status-filter-count", text: String(count) });
		buttonEl.addEventListener("click", () => {
			if (filter === "all") {
				this.statusFilter = "all";
			} else {
				this.statusFilter = this.statusFilter === filter ? "all" : filter;
			}
			this.viewFilter = "none";
			this.activeTag = null;
			this.resetVisibleMemoCount();
			this.updateStatusFilterButtonStates();
			this.updateViewFilterButtonStates();
			this.updateTagFilterButtonStates();
			this.refreshSidebarTagTree();
			this.closeSidebar();
			this.renderFilteredMemoStream();
		});
		if (filter === "deleted") {
			buttonEl.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				this.openDeletedFilterMenu(event);
			});
		}
	}

	private updateStatusFilterButtonStates(): void {
		this.contentEl.querySelectorAll<HTMLElement>(".memos-status-filter-button").forEach((buttonEl) => {
			const filter = buttonEl.dataset.statusFilter;
			const isActive = filter === this.statusFilter;
			buttonEl.toggleClass("is-active", isActive);
			buttonEl.setAttribute("aria-pressed", String(isActive));
		});
	}

	private updateHeatmapCellStates(): void {
		this.contentEl.querySelectorAll<HTMLElement>(".memos-heatmap-cell").forEach((cellEl) => {
			const isActive = cellEl.dataset.dayKey === this.activeDayKey;
			cellEl.toggleClass("is-active", isActive);
			cellEl.setAttribute("aria-pressed", String(isActive));
		});
	}

	private updateTitleDateState(): void {
		const titleEl = this.contentEl.querySelector<HTMLElement>(".memos-title");
		if (!titleEl) {
			return;
		}

		this.renderTitleDateState(titleEl);
	}

	private renderTopbar(parentEl: HTMLElement): HTMLInputElement {
		const topbarEl = parentEl.createDiv({ cls: "memos-topbar" });

		const sidebarToggleEl = topbarEl.createEl("button", {
			cls: "memos-sidebar-toggle",
			attr: {
				type: "button",
				"aria-label": t("view.toggleSidebar"),
			},
		});
		setIcon(sidebarToggleEl, "panel-left");
		sidebarToggleEl.addEventListener("click", () => {
			this.openSidebar();
		});

		const titleEl = topbarEl.createDiv({ cls: "memos-title" });
		this.renderTitleDateState(titleEl);

		const actionsEl = topbarEl.createDiv({ cls: "memos-topbar-actions" });
		const randomWalkButtonEl = actionsEl.createEl("button", {
			cls: "memos-topbar-icon-button",
			attr: {
				type: "button",
				"aria-label": t("view.randomWalk"),
			},
		});
		setIcon(randomWalkButtonEl, "shuffle");
		randomWalkButtonEl.addEventListener("click", () => {
			void this.startRandomWalk();
		});

		const searchEl = actionsEl.createEl("input", {
			type: "search",
			cls: "memos-search",
			placeholder: t("view.searchPlaceholder"),
		});
		searchEl.value = this.searchTerm;
		searchEl.addEventListener("compositionstart", () => {
			this.isSearchComposing = true;
		});
		searchEl.addEventListener("compositionend", () => {
			this.isSearchComposing = false;
			this.updateSearch(searchEl.value);
		});
		let searchDebounceTimer: number | null = null;
		searchEl.addEventListener("input", () => {
			if (this.isSearchComposing) {
				return;
			}

			if (searchDebounceTimer !== null) {
				window.clearTimeout(searchDebounceTimer);
			}
			searchDebounceTimer = window.setTimeout(() => {
				this.updateSearch(searchEl.value);
			}, 200);
		});
		return searchEl;
	}

	private renderTitleDateState(titleEl: HTMLElement): void {
		titleEl.empty();
		if (this.activeDayKey) {
			const homeButton = titleEl.createEl("button", {
				cls: "memos-title-home is-icon",
				attr: {
					type: "button",
					"aria-label": `Clear date filter ${this.activeDayKey}`,
				},
			});
			setIcon(homeButton, "home");
			homeButton.addEventListener("click", () => {
				this.activeDayKey = null;
				this.resetVisibleMemoCount();
				this.updateHeatmapCellStates();
				this.updateTitleDateState();
				this.renderFilteredMemoStream();
			});

			titleEl.createSpan({ cls: "memos-title-separator", text: "/" });
			titleEl.createSpan({ cls: "memos-title-date-label", text: this.activeDayKey });
		} else {
			const homeButton = titleEl.createEl("button", {
				cls: "memos-title-home is-icon",
				attr: {
					type: "button",
					"aria-label": t("view.displayName"),
				},
			});
			setIcon(homeButton, "home");
		}

		const sortButton = titleEl.createEl("button", {
			cls: "memos-title-menu-button",
			attr: {
				type: "button",
				"aria-label": `${t("view.sortOrderLabel")}, ${getSortLabel(this.sortOrder)}`,
			},
		});
		const chevronEl = sortButton.createSpan({ cls: "memos-title-date-chevron" });
		setIcon(chevronEl, "arrow-down-wide-narrow");
		sortButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.openSortMenu(event);
		});
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
		// 移动端:空闲(无草稿/非编辑)时显示收缩条,点击展开真实输入框
		const collapsedBarEl = composerEl.createDiv({ cls: "memos-composer-collapsed-bar" });
		const collapsedIconEl = collapsedBarEl.createSpan({ cls: "memos-composer-collapsed-icon" });
		setIcon(collapsedIconEl, "plus");
		collapsedBarEl.createSpan({ cls: "memos-composer-collapsed-text", text: t("view.composerPlaceholder") });
		const editorWrapEl = composerEl.createDiv({ cls: "memos-composer-editor" });
		const textareaEl = editorWrapEl.createEl("textarea", {
			cls: "memos-composer-input",
			placeholder: t("view.composerPlaceholder"),
		});
		const previewEl = editorWrapEl.createDiv({ cls: "memos-composer-preview markdown-rendered" });
		previewEl.addEventListener("dblclick", () => {
			if (!this.isComposerPreview) {
				return;
			}
			this.isComposerPreview = false;
			const previewBtn = composerEl.querySelector(".memos-preview-toggle");
			if (previewBtn instanceof HTMLElement) {
				setIcon(previewBtn, "eye");
				previewBtn.removeClass("is-active");
			}
			renderPreviewState();
			textareaEl.focus();
		});
		const wikilinkSuggestEl = editorWrapEl.createDiv({ cls: "memos-wikilink-suggest", attr: { hidden: "hidden" } });
		const tagSuggestEl = editorWrapEl.createDiv({ cls: "memos-wikilink-suggest memos-tag-suggest", attr: { hidden: "hidden" } });
		const selectionToolbar = editorWrapEl.createDiv({ cls: "memos-selection-toolbar" });
		this.createSelectionToolbar(selectionToolbar, textareaEl, (value) => {
			this.composerValue = value;
		});
		textareaEl.value = this.composerValue;
		this.autosizeTextarea(textareaEl);
		if (Platform.isPhone && !this.editingMemo && !this.composerValue) {
			composerEl.addClass("is-collapsed");
		}
		collapsedBarEl.addEventListener("click", () => {
			composerEl.removeClass("is-collapsed");
			this.scheduleTimeout(() => textareaEl.focus(), 0);
		});
		textareaEl.addEventListener("focus", () => {
			composerEl.removeClass("is-collapsed");
		});
		textareaEl.addEventListener("blur", () => {
			if (!Platform.isPhone) {
				return;
			}
			// 延迟检查:点击工具栏按钮会造成瞬时失焦,此时不应收缩
			this.scheduleTimeout(() => {
				if (this.editingMemo || this.composerValue.trim()) {
					return;
				}
				if (composerEl.contains(document.activeElement)) {
					return;
				}
				composerEl.addClass("is-collapsed");
			}, 150);
		});
		textareaEl.addEventListener("input", () => {
			this.composerValue = textareaEl.value;
			this.autosizeTextarea(textareaEl);
			if (this.isComposerPreview) {
				void this.renderComposerPreview(previewEl);
			}
		});
		textareaEl.addEventListener("paste", (event) => {
			void this.handleTextareaPaste(
				event,
				textareaEl,
				this.editingMemo?.sourcePath ?? this.plugin.getTodayDailyNotePath(),
				(value) => {
					this.composerValue = value;
					if (this.isComposerPreview) {
						void this.renderComposerPreview(previewEl);
					}
				},
			);
		});

		const renderPreviewState = async (): Promise<void> => {
			if (this.isComposerPreview) {
				textareaEl.addClass("is-hidden");
				selectionToolbar.addClass("is-hidden");
				previewEl.addClass("is-visible");
				await this.renderComposerPreview(previewEl);
			} else {
				textareaEl.removeClass("is-hidden");
				selectionToolbar.removeClass("is-hidden");
				previewEl.removeClass("is-visible");
				previewEl.empty();
			}
		};

		const footerEl = composerEl.createDiv({ cls: "memos-composer-footer" });
		const toolsEl = footerEl.createDiv({ cls: "memos-composer-tools" });
		this.createFormattingTools(toolsEl, textareaEl, (value) => {
			this.composerValue = value;
			if (this.isComposerPreview) {
				void this.renderComposerPreview(previewEl);
			}
		}, this.editingMemo?.sourcePath ?? this.plugin.getTodayDailyNotePath());
		this.createToolDivider(toolsEl);
		this.createToolButton(toolsEl, this.isComposerPreview ? "pencil" : "eye", t("view.togglePreview"), () => {
			this.isComposerPreview = !this.isComposerPreview;
			const previewBtn = toolsEl.querySelector(".memos-preview-toggle");
			if (previewBtn instanceof HTMLElement) {
				setIcon(previewBtn, this.isComposerPreview ? "pencil" : "eye");
				previewBtn.toggleClass("is-active", this.isComposerPreview);
			}
			renderPreviewState();
		});
		const previewToggle = toolsEl.querySelector(".memos-tool-button:last-child");
		if (previewToggle instanceof HTMLElement) {
			previewToggle.addClass("memos-preview-toggle");
			if (this.isComposerPreview) {
				previewToggle.addClass("is-active");
			}
		}
		// 移动端:全屏编辑,缓解小输入框编辑长文本的体验问题
		if (Platform.isPhone) {
			this.createToolDivider(toolsEl);
			this.createToolButton(toolsEl, "maximize", t("view.expandEditor"), () => {
				new MemosFullscreenEditorModal(
					this.app,
					this.composerValue,
					(value) => {
						this.composerValue = value;
						textareaEl.value = value;
						this.autosizeTextarea(textareaEl);
						composerEl.removeClass("is-collapsed");
						if (this.isComposerPreview) {
							void this.renderComposerPreview(previewEl);
						}
					},
				).open();
			});
		}
		this.bindTextareaWikilinkSuggest(
			textareaEl,
			wikilinkSuggestEl,
			this.editingMemo?.sourcePath ?? this.plugin.getTodayDailyNotePath(),
			(value) => {
				this.composerValue = value;
			},
		);
		this.bindTextareaTagSuggest(textareaEl, tagSuggestEl, (value) => {
			this.composerValue = value;
		});

		renderPreviewState();

		const submitButton = footerEl.createEl("button", {
			cls: "memos-submit",
			text: t("view.saveMemo"),
		});
		submitButton.setAttribute("aria-label", t("view.saveMemo"));
		submitButton.addEventListener("click", async () => {
			await this.saveComposerMemo();
		});

		return composerEl;
	}

	private async renderComposerPreview(previewEl: HTMLElement): Promise<void> {
		previewEl.empty();
		if (!this.composerValue.trim()) {
			previewEl.createDiv({ cls: "memos-composer-preview-empty", text: t("view.composerPlaceholder") });
			return;
		}
		await MarkdownRenderer.render(
			this.app,
			this.composerValue,
			previewEl,
			this.editingMemo?.sourcePath ?? this.plugin.getTodayDailyNotePath(),
			this,
		);
	}

	private renderMemoStream(parentEl: HTMLElement, memos: MemoEntry[]): void {
		// 先创建新容器再删除旧 DOM,避免高度坍缩导致的闪动
		const oldStreams = parentEl.querySelectorAll(".memos-stream");
		const listEl = parentEl.createDiv({ cls: "memos-stream" });
		// 新容器已插入 DOM,现在安全删除旧容器
		oldStreams.forEach((el) => el.remove());
		if (!memos.length) {
			const emptyEl = listEl.createDiv({ cls: "memos-empty" });
			emptyEl.createEl("h3", { text: t("view.noMatchingMemos") });
			emptyEl.createEl("p", {
				text: t("view.noMatchingMemosDesc"),
			});
			return;
		}

		const visibleMemos = memos.slice(0, this.visibleMemoCount);
		const batchSize = 10;
		let lastDayKey = "";
		let index = 0;

		const renderBatch = (): void => {
			const end = Math.min(index + batchSize, visibleMemos.length);
			for (; index < end; index++) {
				const memo = visibleMemos[index]!;
				if (memo.dayKey !== lastDayKey) {
					lastDayKey = memo.dayKey;
					const dayHeadEl = listEl.createDiv({ cls: "memos-day-head" });
					dayHeadEl.createSpan({ cls: "memos-day-head-label", text: formatReadableDay(memo.dayKey) });
				}
				void this.renderMemoCard(listEl, memo);
			}
			if (index < visibleMemos.length) {
				this.scheduleTimeout(renderBatch, 0);
			} else if (this.forceCompactLayout) {
				// 所有卡片渲染完成后,在列表底部添加虚线框占位符
				const hintEl = listEl.createDiv({ cls: "memos-new-memo-hint" });
				setIcon(hintEl, "plus");
				// 把回到底部按钮移到内容末尾(sticky bottom 需要正确的 DOM 顺序)
				const scrollBtn = parentEl.querySelector(":scope > .memos-scroll-to-bottom");
				if (scrollBtn) {
					parentEl.appendChild(scrollBtn);
				}
			}
		};

		renderBatch();

		if (visibleMemos.length < memos.length) {
			const loadMoreWrapEl = listEl.createDiv({ cls: "memos-load-more-wrap" });
			const remainingCount = memos.length - visibleMemos.length;
			const loadMoreButtonEl = loadMoreWrapEl.createEl("button", {
				cls: "memos-load-more-button",
				text: t("view.loadMore", remainingCount),
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

		// 保存滚动位置(重建 .memos-stream DOM 会丢失 scrollTop)
		const savedScrollTop = this.memoStreamContainerEl.scrollTop;

		const viewModel = buildViewModel(
			this.memos,
			this.searchTerm,
			this.activeTag,
			this.activeDayKey,
			this.sortOrder,
			this.statusFilter,
			this.viewFilter,
		);
		this.renderMemoStream(this.memoStreamContainerEl, viewModel.filteredMemos);
		this.updateStickyDayHead();

		// 同步恢复,但卡片是异步分批渲染(setTimeout),后续帧会撑高容器
		this.memoStreamContainerEl.scrollTop = savedScrollTop;
		// 用 rAF 在异步渲染期间持续恢复,直到渲染稳定
		const container = this.memoStreamContainerEl;
		let frames = 0;
		const restore = (): void => {
			if (frames >= 12) {
				return;
			}
			container.scrollTop = savedScrollTop;
			frames++;
			this.scheduleFrame(restore);
		};
		this.scheduleFrame(restore);
	}

	private async refreshMemoStream(): Promise<void> {
		if (!this.memoStreamContainerEl) {
			await this.render();
			return;
		}

		// 渲染前记录是否接近底部(用于紧凑视图决定滚动行为)
		const container = this.memoStreamContainerEl;
		const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;

		this.memos = await loadMemosFromDailyNotes(
			this.app,
			this.plugin.getDailyNotesFolder(),
			this.plugin.settings.timestampFormat,
			this.plugin.settings.memoReadMode,
			this.plugin.settings.memoReadHeading,
			this.plugin.settings.boundFilePath || undefined,
		);
		this.refreshSidebarStatusCounts();
		this.refreshSidebarTagTree();
		this.refreshSidebarHeatmap();
		this.renderFilteredMemoStream();
		this.scrollToNewMemo(wasNearBottom);
	}

	/** 保存 memo 后滚动到新内容;主视图无操作,紧凑视图重写为滚到底部 */
	protected scrollToNewMemo(wasNearBottom: boolean): void {
		// 主视图:保持当前滚动位置,不自动跳转
	}

	private refreshSidebarHeatmap(): void {
		const sectionEl = this.sidebarEl?.querySelector(".memos-heatmap-section");
		if (!(sectionEl instanceof HTMLElement)) {
			return;
		}
		const viewModel = buildViewModel(
			this.memos,
			this.searchTerm,
			this.activeTag,
			this.activeDayKey,
			this.sortOrder,
			this.statusFilter,
			this.viewFilter,
		);
		const previewEl = document.body.querySelector(".memos-heatmap-preview");
		if (previewEl instanceof HTMLElement) {
			previewEl.remove();
		}
		sectionEl.empty();
		this.populateHeatmapSection(sectionEl, viewModel.heatmap, viewModel.heatmapMonths);
	}

	private populateHeatmapSection(
		heatmapSectionEl: HTMLElement,
		heatmap: HeatmapWeek[],
		heatmapMonths: HeatmapMonthLabel[],
	): void {
		const heatmapPreviewEl = document.body.createDiv({ cls: "memos-heatmap-preview" });
		let heatmapPreviewTimer: ReturnType<typeof setTimeout> | null = null;

		const scheduleHideHeatmapPreview = (): void => {
			heatmapPreviewTimer = setTimeout(() => {
				heatmapPreviewEl.removeClass("is-visible");
			}, 150);
		};

		const cancelHideHeatmapPreview = (): void => {
			if (heatmapPreviewTimer !== null) {
				clearTimeout(heatmapPreviewTimer);
				heatmapPreviewTimer = null;
			}
		};

		heatmapPreviewEl.addEventListener("mouseenter", () => {
			cancelHideHeatmapPreview();
		});
		heatmapPreviewEl.addEventListener("mouseleave", () => {
			heatmapPreviewEl.removeClass("is-visible");
		});

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
						"data-day-key": cell.dayKey,
					},
				});
				cellEl.addEventListener("mouseenter", async () => {
					cancelHideHeatmapPreview();
					if (cell.count === 0) {
						return;
					}
					heatmapPreviewEl.empty();
					heatmapPreviewEl.createDiv({ cls: "memos-heatmap-preview-date", text: `${cell.dayKey} · ${cell.count}` });
					for (const preview of cell.previews) {
						const itemEl = heatmapPreviewEl.createDiv({ cls: "memos-heatmap-preview-item" });
						itemEl.createDiv({ cls: "memos-heatmap-preview-time", text: preview.time });
						const contentEl = itemEl.createDiv({ cls: "memos-heatmap-preview-content" });
						await MarkdownRenderer.render(this.app, preview.content, contentEl, "", this);
					}
					const cellRect = cellEl.getBoundingClientRect();
					const previewWidth = 280;
					let left = cellRect.right + 8;
					if (left + previewWidth > window.innerWidth) {
						left = cellRect.left - previewWidth - 8;
					}
					if (left < 0) {
						left = 4;
					}
					let top = cellRect.top;
					if (top + 300 > window.innerHeight) {
						top = window.innerHeight - 300;
					}
					heatmapPreviewEl.style.left = `${left}px`;
					heatmapPreviewEl.style.top = `${top}px`;
					heatmapPreviewEl.addClass("is-visible");
				});
				cellEl.addEventListener("mouseleave", () => {
					scheduleHideHeatmapPreview();
				});
				cellEl.addEventListener("click", () => {
					cancelHideHeatmapPreview();
					heatmapPreviewEl.removeClass("is-visible");
					this.activeDayKey = this.activeDayKey === cell.dayKey ? null : cell.dayKey;
					this.viewFilter = "none";
					this.activeTag = null;
					this.resetVisibleMemoCount();
					this.updateHeatmapCellStates();
					this.updateViewFilterButtonStates();
					this.updateTagFilterButtonStates();
					this.updateTitleDateState();
					this.closeSidebar();
					this.renderFilteredMemoStream();
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
	}

	private refreshSidebarStatusCounts(): void {
		const statusCounts = this.getStatusCounts();
		this.sidebarEl?.querySelectorAll(".memos-status-filter-button").forEach((buttonEl) => {
			if (!(buttonEl instanceof HTMLElement)) {
				return;
			}
			const filter = buttonEl.dataset.statusFilter as MemosStatusFilter | undefined;
			if (!filter) {
				return;
			}
			const count = statusCounts[filter] ?? 0;
			const countEl = buttonEl.querySelector(".memos-status-filter-count");
			if (countEl) {
				countEl.textContent = String(count);
			}
			const labelEl = buttonEl.querySelector(".memos-status-filter-label span:last-child");
			const labelText = labelEl?.textContent ?? "";
			buttonEl.setAttribute("aria-label", `${labelText} memos (${count})`);
		});

		const scopedMemos = this.memos.filter((memo) => !memo.archivedAt && !memo.deletedAt);
		const tagCounts = new Map<string, number>();
		const dayCounts = new Map<string, number>();
		for (const memo of scopedMemos) {
			dayCounts.set(memo.dayKey, (dayCounts.get(memo.dayKey) ?? 0) + 1);
			for (const tag of memo.tags) {
				tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
			}
		}

		const statsEl = this.sidebarEl?.querySelector(".memos-stats");
		if (statsEl) {
			const values = [String(scopedMemos.length), String(tagCounts.size), String(dayCounts.size)];
			statsEl.querySelectorAll(".memos-stat strong").forEach((el, index) => {
				if (values[index] !== undefined) {
					el.textContent = values[index];
				}
			});
		}
	}

	private refreshSidebarTagTree(): void {
		const treeEl = this.sidebarEl?.querySelector(".memos-filter-tree");
		if (!treeEl) {
			return;
		}
		const tagCounts = new Map<string, number>();
		for (const memo of this.getScopedMemos()) {
			for (const tag of memo.tags) {
				tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
			}
		}
		const tagStats = [...tagCounts.entries()]
			.map(([tag, count]) => ({ tag, count }))
			.sort((left, right) => left.tag.localeCompare(right.tag, undefined, { numeric: true }));
		treeEl.empty();
		this.renderTagTree(treeEl as HTMLElement, buildTagTree(tagStats), 0);
	}

	private getScopedMemos(): MemoEntry[] {
		switch (this.statusFilter) {
			case "archived":
				return this.memos.filter((memo) => Boolean(memo.archivedAt));
			case "deleted":
				return this.memos.filter((memo) => Boolean(memo.deletedAt));
			case "all":
			case "active":
			default:
				return this.memos.filter((memo) => !memo.archivedAt && !memo.deletedAt);
		}
	}

	private handleInlineEditorEscape(event: KeyboardEvent): boolean {
		if (!isEscapeKey(event) || !this.inlineEditingMemoId) {
			return false;
		}

		const activeElement = document.activeElement;
		const eventTarget = event.target instanceof Node ? event.target : null;
		const isInThisView =
			(activeElement instanceof Node && this.containerEl.contains(activeElement)) ||
			(eventTarget !== null && this.containerEl.contains(eventTarget));
		if (!isInThisView) {
			return false;
		}

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		this.cancelInlineEditing();
		return true;
	}

	protected createBackToTopButton(parentEl: HTMLElement, bodyEl: HTMLElement): HTMLButtonElement {
		const buttonEl = parentEl.createEl("button", {
			cls: "memos-back-to-top",
			attr: {
				type: "button",
				"aria-label": t("view.backToTop"),
			},
		});
		setIcon(buttonEl, "arrow-up");
		buttonEl.addEventListener("click", () => {
			bodyEl.scrollTo({ top: 0, behavior: "smooth" });
		});
		return buttonEl;
	}

	/** 判断滚动按钮是否可见;主视图:滚动超过 240px 时显示回到顶部 */
	protected isScrollButtonVisible(bodyEl: HTMLElement): boolean {
		return bodyEl.scrollTop > 240;
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

				menuItem.setIcon(this.sortOrder === item.value ? "check" : item.icon);
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
		textareaEl.setCssStyles({ height: "auto" });
		textareaEl.setCssStyles({ height: `${textareaEl.scrollHeight}px` });
	}

	private createSelectionToolbar(
		toolbarEl: HTMLElement,
		textareaEl: HTMLTextAreaElement,
		onChange: (value: string) => void,
	): void {
		const actions: Array<{ icon: string; label: string; prefix: string; suffix: string }> = [
			{ icon: "bold", label: t("view.boldSelection"), prefix: "**", suffix: "**" },
			{ icon: "italic", label: t("view.italicSelection"), prefix: "*", suffix: "*" },
			{ icon: "strikethrough", label: t("view.strikeSelection"), prefix: "~~", suffix: "~~" },
			{ icon: "highlighter", label: t("view.highlightSelection"), prefix: "==", suffix: "==" },
			{ icon: "code", label: t("view.codeSelection"), prefix: "`", suffix: "`" },
			{ icon: "sigma", label: t("view.mathSelection"), prefix: "$", suffix: "$" },
			{ icon: "percent", label: t("view.commentSelection"), prefix: "%%", suffix: "%%" },
		];
		for (const { icon, label, prefix, suffix } of actions) {
			const btn = toolbarEl.createEl("button", {
				cls: "memos-selection-toolbar-button",
				attr: { type: "button", "aria-label": label },
			});
			setIcon(btn, icon);
			btn.dataset.prefix = prefix;
			btn.dataset.suffix = suffix;
			btn.addEventListener("mousedown", (event) => {
				event.preventDefault();
				this.toggleWrapSelection(textareaEl, prefix, suffix, onChange);
				this.updateSelectionToolbar(toolbarEl, textareaEl);
			});
		}
		const divider = toolbarEl.createDiv({ cls: "memos-selection-toolbar-divider" });
		const clearBtn = toolbarEl.createEl("button", {
			cls: "memos-selection-toolbar-button memos-selection-toolbar-clear",
			attr: { type: "button", "aria-label": t("view.clearFormat") },
		});
		setIcon(clearBtn, "eraser");
		clearBtn.addEventListener("mousedown", (event) => {
			event.preventDefault();
			this.clearFormatting(textareaEl, onChange);
			this.updateSelectionToolbar(toolbarEl, textareaEl);
		});
		const onSelectionChange = (): void => {
			this.updateSelectionToolbar(toolbarEl, textareaEl);
		};
		textareaEl.addEventListener("select", onSelectionChange);
		textareaEl.addEventListener("click", onSelectionChange);
		textareaEl.addEventListener("keyup", onSelectionChange);
		textareaEl.addEventListener("blur", () => {
			toolbarEl.removeClass("is-visible");
		});
	}

	private updateSelectionToolbar(toolbarEl: HTMLElement, textareaEl: HTMLTextAreaElement): void {
		const start = textareaEl.selectionStart;
		const end = textareaEl.selectionEnd;
		if (start === end || document.activeElement !== textareaEl) {
			toolbarEl.removeClass("is-visible");
			return;
		}
		const caretOffset = this.measureTextareaCaretOffset(textareaEl);
		const toolbarHeight = 36;
		const gap = 6;
		const top = caretOffset.top - toolbarHeight - gap;
		const maxLeft = Math.max(0, textareaEl.clientWidth - toolbarEl.offsetWidth || textareaEl.clientWidth - 280);
		const left = Math.min(Math.max(0, caretOffset.left), maxLeft);
		toolbarEl.style.top = `${top}px`;
		toolbarEl.style.left = `${left}px`;
		toolbarEl.addClass("is-visible");

		const value = textareaEl.value;
		const beforeSel = value.slice(0, start);
		const afterSel = value.slice(end);
		const selectedText = value.slice(start, end);
		const buttons = toolbarEl.querySelectorAll<HTMLButtonElement>(".memos-selection-toolbar-button:not(.memos-selection-toolbar-clear)");
		for (let i = 0; i < buttons.length; i++) {
			const btn = buttons.item(i);
			if (!btn) continue;
			const prefix = btn.dataset.prefix ?? "";
			const suffix = btn.dataset.suffix ?? "";
			let wrappedBefore = beforeSel.endsWith(prefix);
			let wrappedAfter = afterSel.startsWith(suffix);
			// 选区内部已包含包裹符号(如选中 **文本** 整体)
			let wrappedInside = selectedText.length >= prefix.length + suffix.length
				&& selectedText.startsWith(prefix)
				&& selectedText.endsWith(suffix);
			// 排除 ** 误匹配 * (加粗不应同时标记为斜体)
			if (prefix === "*") {
				if (wrappedBefore) {
					const extra = beforeSel.slice(0, -prefix.length);
					if (extra.endsWith("*")) wrappedBefore = false;
				}
				if (wrappedInside && selectedText.slice(prefix.length).startsWith("*")) {
					wrappedInside = false;
				}
			}
			// 排除 $$ 误匹配 $
			if (prefix === "$") {
				if (wrappedBefore) {
					const extra = beforeSel.slice(0, -prefix.length);
					if (extra.endsWith("$")) wrappedBefore = false;
				}
				if (wrappedInside && selectedText.slice(prefix.length).startsWith("$")) {
					wrappedInside = false;
				}
			}
			if (suffix === "*" && wrappedAfter) {
				if (afterSel.length > suffix.length && afterSel.charAt(suffix.length) === "*") wrappedAfter = false;
			}
			if (suffix === "$" && wrappedAfter) {
				if (afterSel.length > suffix.length && afterSel.charAt(suffix.length) === "$") wrappedAfter = false;
			}
			if ((wrappedBefore && wrappedAfter) || wrappedInside) {
				btn.addClass("is-active");
			} else {
				btn.removeClass("is-active");
			}
		}
	}

	private createFormattingTools(
		parentEl: HTMLElement,
		textareaEl: HTMLTextAreaElement,
		onChange: (value: string) => void,
		sourcePath?: string,
	): void {
		this.createToolButton(parentEl, "square-check", t("view.insertTaskList"), () => {
			this.toggleLinePrefix(textareaEl, "- [ ] ", onChange);
		});
		this.createToolButton(parentEl, "list", t("view.insertBulletList"), () => {
			this.toggleLinePrefix(textareaEl, "- ", onChange);
		});
		this.createToolButton(parentEl, "list-ordered", t("view.insertNumberedList"), () => {
			this.toggleOrderedList(textareaEl, onChange);
		});
		this.createToolDivider(parentEl);
		this.createToolButton(parentEl, "image", t("view.insertImage"), () => {
			const resolvedSourcePath = sourcePath ?? this.plugin.getTodayDailyNotePath();
			new AttachmentPickerModal(this.app, resolvedSourcePath, this.plugin.settings.imageEmbedStyle, (markdownLink) => {
				this.insertIntoTextarea(textareaEl, markdownLink, onChange);
			}).open();
		});
		this.createVoiceToolButton(parentEl, textareaEl, onChange, sourcePath);
	}

	private createVoiceToolButton(
		parentEl: HTMLElement,
		textareaEl: HTMLTextAreaElement,
		onChange: (value: string) => void,
		sourcePath?: string,
	): void {
		const buttonEl = parentEl.createEl("button", {
			cls: "memos-tool-button",
			attr: { "aria-label": t("view.recordVoice"), type: "button" },
		});
		setIcon(buttonEl, "mic");
		let busy = false;

		const resetButton = (): void => {
			setIcon(buttonEl, "mic");
			buttonEl.removeClass("is-recording");
			buttonEl.setAttribute("aria-label", t("view.recordVoice"));
		};

		const tick = (): void => {
			if (!this.voiceRecorder.isRecording) {
				return;
			}
			const seconds = Math.floor(this.voiceRecorder.elapsedMs / 1000);
			buttonEl.setAttribute(
				"aria-label",
				`${t("view.stopRecording")} ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
			);
			this.scheduleTimeout(tick, 500);
		};

		buttonEl.addEventListener("click", async () => {
			if (busy) {
				return;
			}
			busy = true;
			try {
				if (this.voiceRecorder.isRecording) {
					await this.saveVoiceRecording(textareaEl, onChange, sourcePath);
					resetButton();
				} else {
					await this.voiceRecorder.start();
					setIcon(buttonEl, "square");
					buttonEl.addClass("is-recording");
					buttonEl.setAttribute("aria-label", t("view.stopRecording"));
					tick();
				}
			} catch (error) {
				if (error instanceof DOMException && error.name === "NotAllowedError") {
					new Notice(t("notices.voiceMicDenied"));
				} else {
					new Notice(t("notices.voiceUnsupported"));
				}
				resetButton();
			} finally {
				busy = false;
			}
		});
	}

	private async saveVoiceRecording(
		textareaEl: HTMLTextAreaElement,
		onChange: (value: string) => void,
		sourcePath?: string,
	): Promise<void> {
		const recording = await this.voiceRecorder.stop();
		if (!recording) {
			return;
		}
		try {
			const filename = `Voice recording ${createLocalTimestampForFileName(new Date())}.${recording.ext}`;
			const resolvedSourcePath = sourcePath ?? this.plugin.getTodayDailyNotePath();
			const attachmentPath = await this.app.fileManager.getAvailablePathForAttachment(filename, resolvedSourcePath);
			const file = await this.app.vault.createBinary(attachmentPath, recording.buffer);
			const markdownLink = this.createAttachmentEmbedMarkdown(file, resolvedSourcePath);
			this.insertIntoTextarea(textareaEl, markdownLink, onChange);
			new Notice(t("notices.voiceSaved"));
		} catch (error) {
			console.error("Failed to save voice recording", error);
			new Notice(t("notices.voiceSaveFailed"));
		}
	}

	private insertIntoTextarea(
		textareaEl: HTMLTextAreaElement,
		text: string,
		onChange?: (value: string) => void,
	): void {
		textareaEl.focus();
		textareaEl.setSelectionRange(
			textareaEl.selectionStart ?? textareaEl.value.length,
			textareaEl.selectionEnd ?? textareaEl.value.length,
		);
		insertTextAtCaret(textareaEl, text);
		if (onChange) {
			onChange(textareaEl.value);
		} else {
			this.composerValue = textareaEl.value;
		}
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
			new Notice(t("notices.imageSaved"));
		} catch (error) {
			console.error("Failed to save pasted image", error);
			new Notice(t("notices.imageSaveFailed"));
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
		return buildAttachmentEmbedLink(file, sourcePath, this.plugin.settings.imageEmbedStyle);
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
		let replacement = "";
		let nextSelectionStart = start;
		let nextSelectionEnd = end;
		let insertStart = start;
		let insertEnd = end;

		if (selectedText && before === prefix && after === suffix) {
			insertStart = start - prefix.length;
			insertEnd = end + suffix.length;
			replacement = selectedText;
			nextSelectionStart = start - prefix.length;
			nextSelectionEnd = nextSelectionStart + selectedText.length;
		} else if (selectedText.startsWith(prefix) && selectedText.endsWith(suffix)) {
			const unwrapped = selectedText.slice(prefix.length, selectedText.length - suffix.length);
			replacement = unwrapped;
			nextSelectionStart = start;
			nextSelectionEnd = start + unwrapped.length;
		} else {
			const targetText = selectedText || "text";
			replacement = `${prefix}${targetText}${suffix}`;
			nextSelectionStart = start + prefix.length;
			nextSelectionEnd = nextSelectionStart + targetText.length;
		}

		textareaEl.focus();
		textareaEl.setSelectionRange(insertStart, insertEnd);
		insertTextAtCaret(textareaEl, replacement);

		if (onChange) {
			onChange(textareaEl.value);
		}

		textareaEl.setSelectionRange(nextSelectionStart, nextSelectionEnd);
	}

	private clearFormatting(
		textareaEl: HTMLTextAreaElement,
		onChange?: (value: string) => void,
	): void {
		const start = textareaEl.selectionStart ?? 0;
		const end = textareaEl.selectionEnd ?? 0;
		if (start === end) return;
		const selectedText = textareaEl.value.slice(start, end);
		const markers: Array<string> = ["**", "*", "~~", "==", "`", "$$", "$", "%%"];
		let cleaned = selectedText;
		for (const mark of markers) {
			const escaped = mark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			cleaned = cleaned.replace(new RegExp(`^${escaped}([\\s\\S]*?)${escaped}$`), "$1");
		}
		if (cleaned === selectedText) return;

		textareaEl.focus();
		textareaEl.setSelectionRange(start, end);
		insertTextAtCaret(textareaEl, cleaned);

		onChange?.(textareaEl.value);
		textareaEl.setSelectionRange(start, start + cleaned.length);
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

		textareaEl.focus();
		textareaEl.setSelectionRange(lineStart, lineEnd);
		insertTextAtCaret(textareaEl, formattedBlock);

		onChange?.(textareaEl.value);
		textareaEl.setSelectionRange(lineStart, lineStart + formattedBlock.length);
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

		textareaEl.focus();
		textareaEl.setSelectionRange(lineStart, lineEnd);
		insertTextAtCaret(textareaEl, formattedBlock);

		onChange?.(textareaEl.value);
		textareaEl.setSelectionRange(lineStart, lineStart + formattedBlock.length);
	}

	private bindMainInteractions(
		shellEl: HTMLElement,
		composerEl: HTMLElement,
		bodyEl: HTMLElement,
		backToTopButtonEl: HTMLElement,
	): void {
		this.updateBackToTopButtonState(backToTopButtonEl, this.isScrollButtonVisible(bodyEl));

		bodyEl.addEventListener("scroll", () => {
			this.hasScrolledMemoStream = true;
			this.updateBackToTopButtonState(backToTopButtonEl, this.isScrollButtonVisible(bodyEl));
			this.updateStickyDayHead();
		});
	}

	private updateBackToTopButtonState(buttonEl: HTMLElement, visible: boolean): void {
		buttonEl.toggleClass("is-visible", visible);
	}

	private updateStickyDayHead(): void {
		if (!this.stickyDayHeadEl || !this.memoStreamContainerEl) {
			return;
		}
		const containerTop = this.memoStreamContainerEl.getBoundingClientRect().top;
		const dayHeads = this.memoStreamContainerEl.querySelectorAll<HTMLElement>(".memos-day-head");
		let currentLabel = "";
		for (let i = 0; i < dayHeads.length; i++) {
			const head = dayHeads.item(i);
			if (!head) {
				continue;
			}
			const rect = head.getBoundingClientRect();
			if (rect.top <= containerTop + 4) {
				const labelEl = head.querySelector(".memos-day-head-label");
				if (labelEl) {
					currentLabel = labelEl.textContent ?? "";
				}
			} else {
				break;
			}
		}
		const labelEl = this.stickyDayHeadEl.querySelector(".memos-sticky-day-head-label");
		if (labelEl && labelEl.textContent !== currentLabel) {
			labelEl.textContent = currentLabel;
		}
		this.stickyDayHeadEl.toggleClass("is-visible", Boolean(currentLabel) && this.memoStreamContainerEl.scrollTop > 4);
	}

	private renderTagTree(parentEl: HTMLElement, nodes: TagTreeNode[], depth: number): void {
		nodes.forEach((node) => {
			const hasChildren = node.children.length > 0;
			const isCollapsed = this.collapsedTagPaths.has(node.path);

			const button = parentEl.createEl("button", {
				cls: `memos-filter-item${this.activeTag === node.path ? " is-active" : ""}${node.count === 0 ? " is-branch" : ""}`,
				attr: {
					"data-tag-path": node.path,
				},
			});
			button.style.setProperty("--memos-tag-depth", String(depth));

			const labelEl = button.createSpan({ cls: "memos-filter-label" });
			const iconEl = labelEl.createSpan({ cls: "memos-filter-icon" });
			if (hasChildren) {
				iconEl.addClass("has-toggle", isCollapsed ? "is-collapsed" : "is-expanded");
				iconEl.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					this.toggleTagTreeNode(node.path);
				});
			} else {
				setIcon(iconEl, "tag");
			}
			labelEl.createSpan({ text: node.name });
			button.createSpan({ cls: "memos-filter-count", text: String(node.count) });
			button.addEventListener("click", () => {
				if (node.count === 0) {
					return;
				}

				this.activeTag = this.activeTag === node.path ? null : node.path;
				this.expandTagAncestors(node.path);
				this.resetVisibleMemoCount();
				this.updateTagFilterButtonStates();
				this.updateTitleDateState();
				this.closeSidebar();
				this.renderFilteredMemoStream();
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

		this.refreshSidebarTagTree();
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
			this.viewFilter,
		).filteredMemos;
	}

	async startRandomWalk(): Promise<void> {
		const randomWalkMemos = this.getFilteredMemos().filter((memo) => !memo.archivedAt && !memo.deletedAt);
		if (!randomWalkMemos.length) {
			new Notice(t("notices.noActiveMemosForRandomWalk"));
			return;
		}

		new MemosRandomWalkModal(this, randomWalkMemos).open();
	}

	async openMemoSourceAtLine(memo: MemoEntry): Promise<void> {
		await this.plugin.openSourceFileAtLine(memo.sourcePath, memo.sourceLine);
	}

	private getStatusCounts(): Record<MemosStatusFilter, number> {
		let active = 0;
		let archived = 0;
		let deleted = 0;
		for (const memo of this.memos) {
			const isArchived = Boolean(memo.archivedAt);
			const isDeleted = Boolean(memo.deletedAt);
			if (!isArchived && !isDeleted) {
				active++;
			}
			if (isArchived) {
				archived++;
			}
			if (isDeleted) {
				deleted++;
			}
		}
		return { all: active, active, archived, deleted };
	}

	private async purgeDeletedMemos(): Promise<void> {
		const deletedMemos = this.memos.filter((memo) => Boolean(memo.deletedAt));
		if (!deletedMemos.length) {
			new Notice(t("notices.noDeletedMemos"));
			return;
		}

		const remainingMemos = this.memos.filter((memo) => !memo.deletedAt);
		const attachments = collectDeletableAttachments(this.app, deletedMemos, remainingMemos);
		if (attachments.length) {
			new PermanentDeleteModal(this.app, deletedMemos, remainingMemos, (selectedAttachments) =>
				this.plugin
					.permanentlyDeleteMarkedMemos(deletedMemos, selectedAttachments)
					.then(() => this.finalizePermanentDeletion(deletedMemos.length, false)),
			).open();
			return;
		}

		const confirmed = window.confirm(t("notices.permanentlyDeleteAllConfirm", deletedMemos.length));
		if (!confirmed) {
			return;
		}

		await this.plugin.permanentlyDeleteMarkedMemos(deletedMemos);
		await this.finalizePermanentDeletion(deletedMemos.length, false);
	}

	private async permanentlyDeleteMemo(memo: MemoEntry): Promise<void> {
		if (!memo.deletedAt) {
			return;
		}

		const remainingMemos = this.memos.filter((item) => item.id !== memo.id);
		const attachments = collectDeletableAttachments(this.app, [memo], remainingMemos);
		if (attachments.length) {
			new PermanentDeleteModal(this.app, [memo], remainingMemos, (selectedAttachments) =>
				this.plugin
					.permanentlyDeleteMarkedMemos([memo], selectedAttachments)
					.then(() => this.finalizePermanentDeletion(1, true)),
			).open();
			return;
		}

		const confirmed = window.confirm(t("notices.permanentlyDeleteConfirm"));
		if (!confirmed) {
			return;
		}

		await this.plugin.permanentlyDeleteMarkedMemos([memo]);
		await this.finalizePermanentDeletion(1, true);
	}

	private async finalizePermanentDeletion(count: number, single: boolean): Promise<void> {
		this.inlineEditingMemoId = null;
		this.inlineEditorValue = "";
		if (!single && this.statusFilter === "deleted") {
			this.statusFilter = "all";
		}
		new Notice(single ? t("notices.memoPermanentlyDeleted") : t("notices.permanentlyDeleted", count));
		await this.render();
	}

	private openDeletedFilterMenu(event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t("notices.deleteAll"))
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

			void this.beginInlineEditingMemo(memo);
		});

		const metaEl = cardEl.createDiv({ cls: "memos-card-meta" });
		const metaInfoEl = metaEl.createDiv({ cls: "memos-card-meta-info" });
		const timestampButton = metaInfoEl.createEl("button", {
			cls: "memos-timestamp-button",
			text: memo.createdLabel,
		});
		timestampButton.addEventListener("click", () => {
			void this.plugin.openSourceFileAtLine(memo.sourcePath, memo.sourceLine);
		});
		if (memo.archivedAt) {
			this.renderStatusBadge(metaInfoEl, t("view.archived"), "archive");
		}
		if (memo.deletedAt) {
			this.renderStatusBadge(metaInfoEl, t("view.deleted"), "trash-2");
		}
		if (memo.pinnedAt) {
			this.renderStatusBadge(metaInfoEl, t("view.pinned"), "pin");
			cardEl.addClass("is-pinned");
		}

		const metaActionsEl = metaEl.createDiv({ cls: "memos-card-actions" });

		const quoteButton = metaActionsEl.createEl("button", {
			cls: "memos-menu-button",
			attr: { "aria-label": t("view.quote"), type: "button" },
		});
		setIcon(quoteButton, "quote");
		quoteButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.quoteMemo(memo);
		});

		const menuButton = metaActionsEl.createEl("button", {
			cls: "memos-menu-button",
			attr: { "aria-label": t("view.moreActions"), type: "button" },
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
		this.bindRenderedInternalLinks(contentEl, memo.sourcePath);
		this.bindCardTagClick(contentEl);
		this.highlightSearchMatches(contentEl);
	}

	private bindCardTagClick(contentEl: HTMLElement): void {
		contentEl.addEventListener("click", (event) => {
			const target = event.target as HTMLElement | null;
			const tagEl = target?.closest("a.tag");
			if (!(tagEl instanceof HTMLAnchorElement) || !contentEl.contains(tagEl)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const tagHref = tagEl.getAttribute("href") ?? tagEl.textContent ?? "";
			const tag = tagHref.startsWith("#") ? tagHref : `#${tagHref}`;
			if (!tag) {
				return;
			}
			this.activeTag = tag;
			this.expandTagAncestors(tag);
			this.resetVisibleMemoCount();
			this.updateTagFilterButtonStates();
			this.updateTitleDateState();
			this.closeSidebar();
			this.renderFilteredMemoStream();
		});
	}

	bindRenderedInternalLinks(contentEl: HTMLElement, sourcePath: string): void {
		contentEl.addEventListener("mouseover", (event) => {
			const target = event.target as HTMLElement | null;
			const linkEl = target?.closest("a.internal-link");
			if (!(linkEl instanceof HTMLAnchorElement) || !contentEl.contains(linkEl)) {
				return;
			}

			const relatedTarget = event.relatedTarget as Node | null;
			if (relatedTarget && linkEl.contains(relatedTarget)) {
				return;
			}

			const linktext = linkEl.getAttribute("data-href") ?? linkEl.getAttribute("href") ?? "";
			if (!linktext) {
				return;
			}

			this.app.workspace.trigger("hover-link", {
				event,
				source: VIEW_TYPE_MEMOS,
				hoverParent: this.leaf,
				targetEl: linkEl,
				linktext,
				sourcePath,
			});
		});
		contentEl.addEventListener("click", (event) => {
			const target = event.target as HTMLElement | null;
			const linkEl = target?.closest("a.internal-link");
			if (!(linkEl instanceof HTMLAnchorElement) || !contentEl.contains(linkEl)) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			void this.app.workspace.openLinkText(
				linkEl.getAttribute("data-href") ?? linkEl.getAttribute("href") ?? "",
				sourcePath,
				false,
			);
		});
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
			placeholder: t("view.composerPlaceholder"),
		});
		const previewEl = editorWrapEl.createDiv({ cls: "memos-inline-editor-preview markdown-rendered" });
		const wikilinkSuggestEl = editorWrapEl.createDiv({ cls: "memos-wikilink-suggest", attr: { hidden: "hidden" } });
		const tagSuggestEl = editorWrapEl.createDiv({ cls: "memos-wikilink-suggest memos-tag-suggest", attr: { hidden: "hidden" } });
		const selectionToolbar = editorWrapEl.createDiv({ cls: "memos-selection-toolbar" });
		this.createSelectionToolbar(selectionToolbar, textareaEl, (value) => {
			this.inlineEditorValue = value;
		});
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

		const renderPreviewState = async (): Promise<void> => {
			if (this.isInlineEditorPreview) {
				textareaEl.addClass("is-hidden");
				selectionToolbar.addClass("is-hidden");
				previewEl.addClass("is-visible");
				await this.renderInlineEditorPreview(previewEl, memo);
			} else {
				textareaEl.removeClass("is-hidden");
				selectionToolbar.removeClass("is-hidden");
				previewEl.removeClass("is-visible");
				previewEl.empty();
			}
		};

		previewEl.addEventListener("dblclick", () => {
			if (!this.isInlineEditorPreview) {
				return;
			}
			this.isInlineEditorPreview = false;
			const previewBtn = editorEl.querySelector(".memos-inline-preview-toggle");
			if (previewBtn instanceof HTMLElement) {
				setIcon(previewBtn, "eye");
				previewBtn.removeClass("is-active");
			}
			renderPreviewState();
			textareaEl.focus();
		});

		const footerEl = editorEl.createDiv({ cls: "memos-inline-editor-footer" });
		const toolsEl = footerEl.createDiv({ cls: "memos-inline-editor-tools" });
		this.createFormattingTools(toolsEl, textareaEl, (value) => {
			this.inlineEditorValue = value;
		}, memo.sourcePath);
		this.createToolDivider(toolsEl);
		this.createToolButton(toolsEl, "eye", t("view.togglePreview"), () => {
			this.isInlineEditorPreview = !this.isInlineEditorPreview;
			const previewBtn = editorEl.querySelector(".memos-inline-preview-toggle");
			if (previewBtn instanceof HTMLElement) {
				setIcon(previewBtn, this.isInlineEditorPreview ? "pencil" : "eye");
				previewBtn.toggleClass("is-active", this.isInlineEditorPreview);
			}
			renderPreviewState();
		});
		const inlinePreviewToggle = toolsEl.querySelector(".memos-tool-button:last-child");
		if (inlinePreviewToggle instanceof HTMLElement) {
			inlinePreviewToggle.addClass("memos-inline-preview-toggle");
		}
		// 移动端:全屏编辑,与 composer 的展开按钮行为一致
		if (Platform.isPhone) {
			this.createToolDivider(toolsEl);
			this.createToolButton(toolsEl, "maximize", t("view.expandEditor"), () => {
				new MemosFullscreenEditorModal(
					this.app,
					this.inlineEditorValue,
					(value) => {
						this.inlineEditorValue = value;
						textareaEl.value = value;
						this.autosizeTextarea(textareaEl);
						counterEl.setText(String(value.length));
						if (this.isInlineEditorPreview) {
							void this.renderInlineEditorPreview(previewEl, memo);
						}
					},
				).open();
			});
		}
		this.bindTextareaWikilinkSuggest(textareaEl, wikilinkSuggestEl, memo.sourcePath, (value) => {
			this.inlineEditorValue = value;
		});
		this.bindTextareaTagSuggest(textareaEl, tagSuggestEl, (value) => {
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
			text: t("view.cancel"),
			attr: { type: "button" },
		});
		cancelButton.addEventListener("click", () => {
			this.cancelInlineEditing();
		});

		const submitButton = actionsEl.createEl("button", {
			cls: "memos-inline-editor-submit",
			text: t("view.saveMemo"),
			attr: { "aria-label": t("view.saveMemo"), type: "button" },
		});
		submitButton.addEventListener("click", async () => {
			await this.saveInlineEditedMemo(memo);
		});

		window.setTimeout(() => {
			textareaEl.focus();
			textareaEl.setSelectionRange(textareaEl.value.length, textareaEl.value.length);
		}, 0);
	}

	private async renderInlineEditorPreview(previewEl: HTMLElement, memo: MemoEntry): Promise<void> {
		previewEl.empty();
		if (!this.inlineEditorValue.trim()) {
			previewEl.createDiv({ cls: "memos-composer-preview-empty", text: t("view.composerPlaceholder") });
			return;
		}
		await MarkdownRenderer.render(
			this.app,
			this.inlineEditorValue,
			previewEl,
			memo.sourcePath,
			this,
		);
	}

	private bindTextareaWikilinkSuggest(
		textareaEl: HTMLTextAreaElement,
		panelEl: HTMLElement,
		sourcePath: string,
		onChange: (value: string) => void,
	): void {
		const controller = new WikilinkSuggestController(
			this.app,
			textareaEl,
			panelEl,
			sourcePath,
			onChange,
			{ ensureParagraphBlockId: (item) => this.ensureParagraphBlockId(item) },
		);
		this.registerWikilinkController(controller);
	}

	private registerWikilinkController(controller: WikilinkSuggestController): void {
		this.wikilinkControllers.push(controller);
	}

	private async ensureParagraphBlockId(
		item: Extract<WikilinkSuggestion, { type: "paragraph" }>,
	): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(item.path);
		if (!(file instanceof TFile)) {
			new Notice(t("notices.sourceFileNoLongerExists"));
			return null;
		}

		const rawContent = (await this.app.vault.cachedRead(file)).replace(/\r\n/g, "\n");
		if (item.appendOffset < 0 || item.appendOffset > rawContent.length) {
			new Notice(t("notices.couldNotLocateParagraph"));
			return null;
		}

		const existingIds = Object.keys(this.app.metadataCache.getFileCache(file)?.blocks ?? {});
		const blockId = createBlockId(existingIds);
		const nextContent = `${rawContent.slice(0, item.appendOffset)} ^${blockId}${rawContent.slice(item.appendOffset)}`;
		this.plugin.suppressVaultRefresh(file.path);
		await this.app.vault.modify(file, nextContent);
		return blockId;
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

		mirrorEl.setCssStyles({
			position: "absolute",
			visibility: "hidden",
			pointerEvents: "none",
			whiteSpace: "pre-wrap",
			wordBreak: "break-word",
			overflowWrap: "anywhere",
			boxSizing: "border-box",
			left: "-9999px",
			top: "0",
		});
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

	private bindTextareaTagSuggest(
		textareaEl: HTMLTextAreaElement,
		panelEl: HTMLElement,
		onChange: (value: string) => void,
	): void {
		let selectedIndex = 0;
		let matchingTags: string[] = [];
		let tagStart = -1;
		let isComposing = false;

		const getTags = (): string[] => [...new Set(this.memos.flatMap((m) => m.tags))].sort();

		const hidePanel = (): void => {
			matchingTags = [];
			selectedIndex = 0;
			tagStart = -1;
			panelEl.empty();
			panelEl.setAttr("hidden", "hidden");
		};

		const positionPanel = (): void => {
			const caretOffset = this.measureTextareaCaretOffset(textareaEl);
			const verticalGap = 8;
			const maxPanelWidth = Math.min(260, textareaEl.clientWidth);
			const maxLeft = Math.max(0, textareaEl.clientWidth - maxPanelWidth);
			const nextLeft = Math.min(Math.max(caretOffset.left, 0), maxLeft);
			const nextTop = Math.min(
				Math.max(caretOffset.top + caretOffset.lineHeight + verticalGap, verticalGap),
				Math.max(verticalGap, textareaEl.clientHeight - 16),
			);
			panelEl.style.width = `${maxPanelWidth}px`;
			panelEl.style.left = `${nextLeft}px`;
			panelEl.style.top = `${nextTop}px`;
		};

		const updatePanel = (): void => {
			panelEl.empty();
			if (!matchingTags.length) {
				panelEl.removeAttribute("hidden");
				positionPanel();
				const emptyEl = panelEl.createDiv({ cls: "memos-tag-suggest-empty" });
				emptyEl.setText(t("view.noTags"));
				return;
			}
			panelEl.removeAttribute("hidden");
			positionPanel();
			matchingTags.forEach((tag, index) => {
				const itemEl = panelEl.createEl("button", {
					cls: `memos-tag-suggest-item${index === selectedIndex ? " is-selected" : ""}`,
					attr: { type: "button" },
				});
				itemEl.createSpan({ cls: "memos-tag-suggest-hash", text: "#" });
				itemEl.createSpan({ cls: "memos-tag-suggest-name", text: tag.slice(1) });
				itemEl.addEventListener("mousedown", (event) => {
					event.preventDefault();
					applyTag(tag);
				});
			});
		};

		const applyTag = (tag: string): void => {
			if (tagStart < 0) {
				return;
			}
			const before = textareaEl.value.slice(0, tagStart);
			const after = textareaEl.value.slice(textareaEl.selectionStart ?? tagStart);
			const replacement = `${tag} `;
			textareaEl.focus();
			textareaEl.setSelectionRange(tagStart, textareaEl.selectionStart ?? tagStart);
			insertTextAtCaret(textareaEl, replacement);
			onChange(textareaEl.value);
			hidePanel();
		};

		const handleInput = (): void => {
			if (isComposing) {
				return;
			}
			const cursor = textareaEl.selectionStart ?? 0;
			const textBefore = textareaEl.value.slice(0, cursor);
			const hashMatch = textBefore.match(/(^|\s)#([\p{L}\p{N}_/-]*)$/u);
			if (!hashMatch) {
				hidePanel();
				return;
			}
			const query = hashMatch[2] ?? "";
			tagStart = cursor - query.length - 1;
			const allTags = getTags();
			matchingTags = query
				? allTags.filter((tag) => tag.toLowerCase().includes(query)).slice(0, 8)
				: allTags.slice(0, 8);
			selectedIndex = 0;
			updatePanel();
		};

		textareaEl.addEventListener("input", handleInput);
		textareaEl.addEventListener("compositionstart", () => {
			isComposing = true;
		});
		textareaEl.addEventListener("compositionend", () => {
			isComposing = false;
			handleInput();
		});
		textareaEl.addEventListener("keydown", (event) => {
			if (panelEl.hasAttribute("hidden") || !matchingTags.length) {
				return;
			}
			if (event.key === "ArrowDown") {
				event.preventDefault();
				selectedIndex = (selectedIndex + 1) % matchingTags.length;
				updatePanel();
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				selectedIndex = (selectedIndex - 1 + matchingTags.length) % matchingTags.length;
				updatePanel();
			} else if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				if (matchingTags[selectedIndex]) {
					applyTag(matchingTags[selectedIndex]!);
				}
			} else if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				hidePanel();
			}
		});
		textareaEl.addEventListener("blur", () => {
			hidePanel();
		});
	}

	private openMemoMenu(event: MouseEvent, memo: MemoEntry, anchorEl: HTMLElement): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(memo.pinnedAt ? t("view.unpin") : t("view.pin"))
				.setIcon("pin")
				.onClick(() => {
					void this.togglePinMemo(memo);
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle(t("view.edit"))
				.setIcon("pencil")
				.onClick(() => {
					void this.beginInlineEditingMemo(memo);
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle(memo.archivedAt ? t("view.unarchive") : t("view.archive"))
				.setIcon("archive")
				.onClick(() => {
					void this.toggleArchiveMemo(memo);
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle(memo.deletedAt ? t("view.restore") : t("view.delete"))
				.setIcon(memo.deletedAt ? "rotate-ccw" : "trash")
				.setWarning(!memo.deletedAt)
				.onClick(() => {
					void this.deleteMemo(memo);
				}),
		);
		if (memo.deletedAt) {
			menu.addItem((item) =>
				item
					.setTitle(t("notices.permanentlyDelete"))
					.setIcon("trash")
					.setWarning(true)
					.onClick(() => {
						void this.permanentlyDeleteMemo(memo);
					}),
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t("view.share"))
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

	private shareMemo(memo: MemoEntry): void {
		openMemoShareModal(this.app, memo, this.plugin.settings.shareTitle);
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

	private async saveActiveTextareaMemo(textareaEl: HTMLTextAreaElement): Promise<void> {
		if (textareaEl.matches(".memos-composer-input")) {
			await this.saveComposerMemo();
			return;
		}

		if (!textareaEl.matches(".memos-inline-editor-input")) {
			return;
		}

		const memo = this.memos.find((item) => item.id === this.inlineEditingMemoId);
		if (!memo) {
			return;
		}

		await this.saveInlineEditedMemo(memo);
	}

	private async saveComposerMemo(): Promise<void> {
		if (!this.composerValue.trim()) {
			new Notice(t("notices.writeSomethingFirst"));
			return;
		}

		const memoBeingEdited = this.editingMemo;
		const content = this.composerValue;
		this.composerValue = "";
		this.editingMemo = null;
		this.isComposerExpanded = false;

		this.clearComposerInput();
		if (Platform.isPhone) {
			this.setComposerCollapsed(true);
		}

		if (memoBeingEdited) {
			await this.plugin.updateMemoEntry(memoBeingEdited, content, { refresh: false });
			new Notice(t("notices.memoUpdated"));
		} else {
			await this.plugin.appendMemoToToday(content, { refresh: false });
			new Notice(t("notices.savedToToday"));
		}

		await this.refreshMemoStream();
	}

	private setComposerCollapsed(collapsed: boolean): void {
		const composerEl = this.contentEl.find(".memos-composer");
		if (composerEl) {
			composerEl.toggleClass("is-collapsed", collapsed);
		}
	}

	private clearComposerInput(): void {
		const textareaEl = this.contentEl.find(".memos-composer-input");
		if (textareaEl instanceof HTMLTextAreaElement) {
			textareaEl.value = "";
			this.autosizeTextarea(textareaEl);
		}
	}

	private async saveInlineEditedMemo(memo: MemoEntry): Promise<void> {
		if (!this.inlineEditorValue.trim()) {
			new Notice(t("notices.writeSomethingFirst"));
			return;
		}

		const content = this.inlineEditorValue;
		this.inlineEditingMemoId = null;
		this.inlineEditorValue = "";
		await this.plugin.updateMemoEntry(memo, content, { refresh: false });
		new Notice(t("notices.memoUpdated"));
		await this.refreshMemoStream();
	}

	private cancelInlineEditing(): void {
		if (!this.inlineEditingMemoId) {
			return;
		}
		this.inlineEditingMemoId = null;
		this.inlineEditorValue = "";
		this.isInlineEditorPreview = false;
		this.renderFilteredMemoStream();
	}

	private renderStatusBadge(parentEl: HTMLElement, label: string, icon: string): void {
		const badgeEl = parentEl.createSpan({ cls: "memos-status-badge" });
		const iconEl = badgeEl.createSpan({ cls: "memos-status-badge-icon" });
		setIcon(iconEl, icon);
		badgeEl.createSpan({ text: label });
	}

	private async toggleArchiveMemo(memo: MemoEntry): Promise<void> {
		await this.plugin.archiveMemoEntry(memo, { refresh: false });
		if (this.inlineEditingMemoId === memo.id) {
			this.inlineEditingMemoId = null;
			this.inlineEditorValue = "";
		}
		new Notice(memo.archivedAt ? t("notices.memoUnarchived") : t("notices.memoArchived"));
		await this.refreshMemoStream();
	}

	private async togglePinMemo(memo: MemoEntry): Promise<void> {
		await this.plugin.pinMemoEntry(memo, { refresh: false });
		new Notice(memo.pinnedAt ? t("notices.memoUnpinned") : t("notices.memoPinned"));
		await this.refreshMemoStream();
	}

	private quoteMemo(memo: MemoEntry): void {
		const lines = memo.content.trim().split("\n");
		const quoted = lines.map((line) => `> ${line}`).join("\n");
		const block = `> [!quote] ${memo.dayKey} ${memo.createdLabel}\n> \n${quoted}`;
		this.composerValue = this.composerValue ? `${this.composerValue}\n\n${block}\n` : `${block}\n`;
		const textareaEl = this.contentEl.querySelector(".memos-composer-input") as HTMLTextAreaElement | null;
		if (textareaEl) {
			textareaEl.value = this.composerValue;
			this.autosizeTextarea(textareaEl);
			textareaEl.focus();
			textareaEl.setSelectionRange(this.composerValue.length, this.composerValue.length);
		}
	}

	private async deleteMemo(memo: MemoEntry): Promise<void> {
		await this.plugin.deleteMemoEntry(memo, { refresh: false });
		if (this.inlineEditingMemoId === memo.id) {
			this.inlineEditingMemoId = null;
			this.inlineEditorValue = "";
		}
		new Notice(memo.deletedAt ? t("notices.memoRestored") : t("notices.memoDeleted"));
		await this.refreshMemoStream();
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

const WEEKDAY_NAMES_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_NAMES_ZH = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const WEEKDAY_SHORT_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function formatYearlyDayHeading(dayKey: string): string {
	const date = new Date(`${dayKey}T00:00:00`);
	const weekday = WEEKDAY_SHORT_ZH[date.getDay()] ?? "";
	return `${dayKey} ${weekday}`;
}

function formatReadableDay(dayKey: string): string {
	const today = new Date();
	const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);
	const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

	if (dayKey === todayKey) {
		return t("view.dayToday");
	}
	if (dayKey === yesterdayKey) {
		return t("view.dayYesterday");
	}

	const date = new Date(`${dayKey}T00:00:00`);
	const weekdays = isZhLocale() ? WEEKDAY_NAMES_ZH : WEEKDAY_NAMES_EN;
	const weekday = weekdays[date.getDay()] ?? "";
	return t("view.dayLabel", dayKey, weekday);
}

function getSortMenuItems(): Array<{ title: string; value: MemosSortOrder; icon: string }> {
	return [
		{ title: t("view.sortCreatedDesc"), value: "created-desc", icon: "arrow-down-wide-narrow" },
		{ title: t("view.sortCreatedAsc"), value: "created-asc", icon: "arrow-up-narrow-wide" },
		{ title: t("view.sortUpdatedDesc"), value: "updated-desc", icon: "arrow-down-wide-narrow" },
		{ title: t("view.sortUpdatedAsc"), value: "updated-asc", icon: "arrow-up-narrow-wide" },
	];
}

function getSortLabel(sortOrder: MemosSortOrder): string {
	switch (sortOrder) {
		case "created-asc":
			return t("view.sortCreatedAsc");
		case "updated-desc":
			return t("view.sortUpdatedDesc");
		case "updated-asc":
			return t("view.sortUpdatedAsc");
		case "created-desc":
		default:
			return t("view.sortCreatedDesc");
	}
}

function isSaveShortcut(event: KeyboardEvent): boolean {
	return event.key === "Enter" && (event.ctrlKey || event.metaKey);
}

function isEscapeKey(event: KeyboardEvent): boolean {
	return event.key === "Escape" || event.key === "Esc";
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
