import { Modal, TFile, setIcon, type App } from "obsidian";
import { t } from "../../../i18n";
import type { MemoEntry } from "../../../types";
import { collectAttachmentEmbedTargets } from "../../core/viewModel";

export interface DeletableAttachment {
	file: TFile;
	/** 是否仍被其他(未删除)备忘录引用 */
	referencedElsewhere: boolean;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "avif"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv", "avi", "m4v"]);

/** 解析附件嵌入目标对应的 vault 文件;找不到返回 null */
function resolveAttachmentFile(app: App, target: string, sourcePath: string): TFile | null {
	const cleanTarget = target.split("#")[0]?.trim();
	if (!cleanTarget) {
		return null;
	}
	const direct = app.vault.getAbstractFileByPath(cleanTarget);
	if (direct instanceof TFile) {
		return direct;
	}
	return app.metadataCache.getFirstLinkpathDest(cleanTarget, sourcePath);
}

/**
 * 收集待删除备忘录引用的附件,并标记每个附件是否仍被其他备忘录引用。
 */
export function collectDeletableAttachments(
	app: App,
	memos: MemoEntry[],
	remainingMemos: MemoEntry[],
): DeletableAttachment[] {
	const remainingPaths = new Set<string>();
	for (const memo of remainingMemos) {
		for (const target of collectAttachmentEmbedTargets(memo.content)) {
			const file = resolveAttachmentFile(app, target, memo.sourcePath);
			if (file) {
				remainingPaths.add(file.path);
			}
		}
	}

	const byPath = new Map<string, DeletableAttachment>();
	for (const memo of memos) {
		for (const target of collectAttachmentEmbedTargets(memo.content)) {
			const file = resolveAttachmentFile(app, target, memo.sourcePath);
			if (!file || byPath.has(file.path)) {
				continue;
			}
			byPath.set(file.path, { file, referencedElsewhere: remainingPaths.has(file.path) });
		}
	}
	return [...byPath.values()];
}

function getAttachmentIcon(file: TFile): string {
	const ext = file.extension.toLowerCase();
	if (IMAGE_EXTENSIONS.has(ext)) {
		return "image";
	}
	if (AUDIO_EXTENSIONS.has(ext)) {
		return "audio-file";
	}
	if (VIDEO_EXTENSIONS.has(ext)) {
		return "file-video";
	}
	return "file";
}

function formatFileSize(size: number): string {
	if (size < 1024) {
		return `${size} B`;
	}
	if (size < 1024 * 1024) {
		return `${(size / 1024).toFixed(1)} KB`;
	}
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 永久删除确认弹窗:列出待删备忘录引用的附件,让用户勾选需要一并清理的附件。
 */
export class PermanentDeleteModal extends Modal {
	private readonly memos: MemoEntry[];
	private readonly remainingMemos: MemoEntry[];
	private readonly onConfirm: (attachments: TFile[]) => void | Promise<void>;
	private options: DeletableAttachment[] = [];
	private selectedPaths = new Set<string>();
	private listEl: HTMLElement | null = null;
	private deleteButtonEl: HTMLButtonElement | null = null;

	constructor(
		app: App,
		memos: MemoEntry[],
		remainingMemos: MemoEntry[],
		onConfirm: (attachments: TFile[]) => void | Promise<void>,
	) {
		super(app);
		this.memos = memos;
		this.remainingMemos = remainingMemos;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		this.modalEl.addClass("memos-permanent-delete-modal");
		this.contentEl.empty();
		this.titleEl.setText(t("notices.permanentlyDelete"));

		this.options = collectDeletableAttachments(this.app, this.memos, this.remainingMemos);
		// 默认勾选无其他引用的附件;仍被其他备忘录引用的不勾选
		this.selectedPaths = new Set(
			this.options
				.filter((option) => !option.referencedElsewhere)
				.map((option) => option.file.path),
		);

		this.contentEl.createDiv({
			cls: "memos-permanent-delete-desc",
			text: t("notices.permanentlyDeleteMemoCount", this.memos.length),
		});

		const sectionEl = this.contentEl.createDiv({ cls: "memos-permanent-delete-section" });
		const headEl = sectionEl.createDiv({ cls: "memos-permanent-delete-section-head" });
		headEl.createDiv({ cls: "memos-permanent-delete-section-title", text: t("notices.attachmentCleanupTitle") });
		const actionsEl = headEl.createDiv({ cls: "memos-permanent-delete-actions" });
		const selectAllButtonEl = actionsEl.createEl("button", { text: t("notices.attachmentSelectAll"), type: "button" });
		selectAllButtonEl.addEventListener("click", () => {
			this.selectedPaths = new Set(this.options.map((option) => option.file.path));
			this.renderList();
		});
		const selectNoneButtonEl = actionsEl.createEl("button", { text: t("notices.attachmentSelectNone"), type: "button" });
		selectNoneButtonEl.addEventListener("click", () => {
			this.selectedPaths = new Set();
			this.renderList();
		});

		this.listEl = sectionEl.createDiv({ cls: "memos-permanent-delete-list" });
		this.renderList();

		this.contentEl.createDiv({
			cls: "memos-permanent-delete-hint",
			text: t("notices.attachmentCleanupHint"),
		});

		const buttonContainerEl = this.contentEl.createDiv({ cls: "modal-button-container" });
		const cancelButtonEl = buttonContainerEl.createEl("button", { text: t("view.cancel"), type: "button" });
		cancelButtonEl.addEventListener("click", () => this.close());
		this.deleteButtonEl = buttonContainerEl.createEl("button", {
			text: t("notices.permanentlyDelete"),
			cls: "mod-warning",
			type: "button",
		});
		this.deleteButtonEl.addEventListener("click", () => {
			void this.confirmDelete();
		});
		this.updateDeleteButton();
	}

	onClose(): void {
		this.contentEl.empty();
		this.modalEl.removeClass("memos-permanent-delete-modal");
	}

	private renderList(): void {
		if (!this.listEl) {
			return;
		}
		this.listEl.empty();

		if (!this.options.length) {
			this.listEl.createDiv({ cls: "memos-permanent-delete-empty", text: t("notices.attachmentCleanupEmpty") });
			this.updateDeleteButton();
			return;
		}

		for (const option of this.options) {
			const itemEl = this.listEl.createDiv({ cls: "memos-permanent-delete-item" });
			itemEl.addEventListener("click", () => {
				if (this.selectedPaths.has(option.file.path)) {
					this.selectedPaths.delete(option.file.path);
				} else {
					this.selectedPaths.add(option.file.path);
				}
				this.renderList();
			});

			const checkboxEl = itemEl.createEl("input", {
				type: "checkbox",
				cls: "memos-permanent-delete-checkbox",
			});
			checkboxEl.checked = this.selectedPaths.has(option.file.path);
			checkboxEl.addEventListener("click", (event) => {
				event.stopPropagation();
			});
			checkboxEl.addEventListener("change", () => {
				if (checkboxEl.checked) {
					this.selectedPaths.add(option.file.path);
				} else {
					this.selectedPaths.delete(option.file.path);
				}
				this.updateDeleteButton();
			});

			const iconEl = itemEl.createDiv({ cls: "memos-permanent-delete-icon" });
			setIcon(iconEl, getAttachmentIcon(option.file));

			const nameEl = itemEl.createDiv({ cls: "memos-permanent-delete-name", text: option.file.name });
			nameEl.title = option.file.path;

			const metaEl = itemEl.createDiv({ cls: "memos-permanent-delete-meta" });
			metaEl.createDiv({ text: formatFileSize(option.file.stat.size) });
			metaEl.createDiv({
				cls: `memos-permanent-delete-badge ${option.referencedElsewhere ? "is-referenced" : "is-orphan"}`,
				text: option.referencedElsewhere
					? t("notices.attachmentStillReferenced")
					: t("notices.attachmentNoReferences"),
			});
		}

		this.updateDeleteButton();
	}

	private updateDeleteButton(): void {
		if (!this.deleteButtonEl) {
			return;
		}
		const selectedCount = this.selectedPaths.size;
		this.deleteButtonEl.setText(
			selectedCount
				? `${t("notices.permanentlyDelete")} (${t("notices.attachmentSelectedCount", selectedCount)})`
				: t("notices.permanentlyDelete"),
		);
	}

	private async confirmDelete(): Promise<void> {
		const attachments = this.options
			.filter((option) => this.selectedPaths.has(option.file.path))
			.map((option) => option.file);
		this.close();
		await this.onConfirm(attachments);
	}
}
