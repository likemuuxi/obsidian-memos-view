import { Modal, type App } from "obsidian";
import { t } from "../../../i18n";

/** 简单确认弹窗，替代 window.confirm（Obsidian 插件规范不推荐原生弹窗）。 */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly text: string,
		private readonly onConfirm: () => void | Promise<void>,
		private readonly confirmText: string = t("notices.permanentlyDelete"),
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.confirmText);
		this.contentEl.createDiv({ cls: "memos-confirm-text", text: this.text });

		const buttonContainerEl = this.contentEl.createDiv({ cls: "modal-button-container" });
		const cancelButtonEl = buttonContainerEl.createEl("button", { text: t("view.cancel"), type: "button" });
		cancelButtonEl.addEventListener("click", () => this.close());
		const confirmButtonEl = buttonContainerEl.createEl("button", {
			text: this.confirmText,
			cls: "mod-warning",
			type: "button",
		});
		confirmButtonEl.addEventListener("click", () => {
			this.close();
			void this.onConfirm();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
