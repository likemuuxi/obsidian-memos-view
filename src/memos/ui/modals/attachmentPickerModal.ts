import { Modal, TFile, type App } from "obsidian";
import { t } from "../../../i18n";
import { buildAttachmentEmbedLink } from "../../../utils/embed";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"]);

export class AttachmentPickerModal extends Modal {
	private readonly onSelect: (markdownLink: string) => void;
	private readonly sourcePath: string;
	private readonly embedStyle: "wikilink" | "markdown";
	private searchInput: HTMLInputElement | null = null;
	private gridEl: HTMLElement | null = null;
	private allFiles: TFile[] = [];
	private filteredFiles: TFile[] = [];

	constructor(app: App, sourcePath: string, embedStyle: "wikilink" | "markdown", onSelect: (markdownLink: string) => void) {
		super(app);
		this.sourcePath = sourcePath;
		this.embedStyle = embedStyle;
		this.onSelect = onSelect;
	}

	onOpen(): void {
		this.modalEl.addClass("memos-attachment-picker-modal");
		this.contentEl.empty();
		this.allFiles = this.collectAttachmentFiles();
		this.filteredFiles = this.allFiles;

		const headerEl = this.contentEl.createDiv({ cls: "memos-attachment-picker-header" });
		this.searchInput = headerEl.createEl("input", {
			type: "search",
			cls: "memos-attachment-picker-search",
			placeholder: t("view.attachmentPickerSearch"),
			attr: { autocomplete: "off" },
		});
		let attachmentSearchTimer: number | null = null;
		this.searchInput.addEventListener("input", () => {
			if (attachmentSearchTimer !== null) {
				window.clearTimeout(attachmentSearchTimer);
			}
			attachmentSearchTimer = window.setTimeout(() => {
				this.filterFiles(this.searchInput?.value ?? "");
			}, 200);
		});
		this.searchInput.addEventListener("compositionend", () => {
			this.filterFiles(this.searchInput?.value ?? "");
		});

		this.gridEl = this.contentEl.createDiv({ cls: "memos-attachment-picker-grid" });
		this.renderGrid();

		window.setTimeout(() => {
			this.searchInput?.focus();
		}, 0);
	}

	onClose(): void {
		this.contentEl.empty();
		this.modalEl.removeClass("memos-attachment-picker-modal");
	}

	private collectAttachmentFiles(): TFile[] {
		const files = this.app.vault.getFiles();
		return files
			.filter((file) => {
				const ext = file.extension.toLowerCase();
				return IMAGE_EXTENSIONS.has(ext);
			})
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	private filterFiles(query: string): void {
		const q = query.trim().toLowerCase();
		if (!q) {
			this.filteredFiles = this.allFiles;
		} else {
			this.filteredFiles = this.allFiles.filter((file) => {
				return file.path.toLowerCase().includes(q) || file.name.toLowerCase().includes(q);
			});
		}
		this.renderGrid();
	}

	private renderGrid(): void {
		if (!this.gridEl) return;
		this.gridEl.empty();

		if (!this.filteredFiles.length) {
			this.gridEl.createDiv({ cls: "memos-attachment-picker-empty", text: t("view.attachmentPickerEmpty") });
			return;
		}

		for (const file of this.filteredFiles) {
			const itemEl = this.gridEl.createDiv({ cls: "memos-attachment-picker-item" });
			itemEl.addEventListener("click", () => {
				this.selectFile(file);
			});

			const thumbEl = itemEl.createDiv({ cls: "memos-attachment-picker-thumb" });
			this.renderThumbnail(thumbEl, file);

			itemEl.createDiv({ cls: "memos-attachment-picker-name", text: file.name });
			itemEl.title = file.path;
		}
	}

	private renderThumbnail(containerEl: HTMLElement, file: TFile): void {
		const maxWidth = 120;
		const maxHeight = 90;
		const imgEl = containerEl.createEl("img", {
			attr: {
				src: this.app.vault.getResourcePath(file),
				alt: file.name,
				loading: "lazy",
			},
		});
		imgEl.addEventListener("load", () => {
			const ratio = Math.min(maxWidth / imgEl.naturalWidth, maxHeight / imgEl.naturalHeight, 1);
			imgEl.style.width = `${Math.round(imgEl.naturalWidth * ratio)}px`;
			imgEl.style.height = `${Math.round(imgEl.naturalHeight * ratio)}px`;
		});
	}

	private selectFile(file: TFile): void {
		const markdownLink = buildAttachmentEmbedLink(file, this.sourcePath, this.embedStyle);
		this.onSelect(markdownLink);
		this.close();
	}
}
