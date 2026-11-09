import { App, PluginSettingTab, Setting } from "obsidian";
import type MemosViewPlugin from "../main";
import type { MemosPluginSettings } from "../types";
import { t } from "../i18n";
import { normalizeBoundPath } from "../utils/path";
import { DEFAULT_WECHAT_SETTINGS } from "../wechat/types";
import { isNodeTransportAvailable } from "../wechat/http";

export const DEFAULT_SETTINGS: MemosPluginSettings = {
	boundFilePath: "",
	displayName: "",
	timestampFormat: "HH:mm",
	memoStoreMode: "daily",
	memoStoreHeading: "",
	memoReadMode: "all",
	memoReadHeading: "",
	shareTitle: "",
	imageEmbedStyle: "wikilink",
	wechat: { ...DEFAULT_WECHAT_SETTINGS },
};

export class MemosSettingTab extends PluginSettingTab {
	plugin: MemosViewPlugin;

	constructor(app: App, plugin: MemosViewPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(t("settings.dailyNotesPath"))
			.setDesc(this.buildDailyNotesPathDesc());

		new Setting(containerEl)
			.setName(t("settings.displayName"))
			.setDesc(t("settings.displayNameDesc"))
			.addText((text) =>
				text
					.setPlaceholder("Your name")
					.setValue(this.plugin.settings.displayName)
					.onChange(async (value) => {
						this.plugin.settings.displayName = value.trim();
						await this.plugin.saveSettings();
						await this.plugin.refreshAllMemosViews();
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.shareTitle"))
			.setDesc(t("settings.shareTitleDesc"))
			.addText((text) =>
				text
					.setPlaceholder(t("settings.shareTitlePlaceholder"))
					.setValue(this.plugin.settings.shareTitle)
					.onChange(async (value) => {
						this.plugin.settings.shareTitle = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.imageEmbedStyle"))
			.setDesc(t("settings.imageEmbedStyleDesc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("wikilink", t("settings.imageEmbedStyleWikilink"))
					.addOption("markdown", t("settings.imageEmbedStyleMarkdown"))
					.setValue(this.plugin.settings.imageEmbedStyle)
					.onChange(async (value) => {
						this.plugin.settings.imageEmbedStyle = value as "wikilink" | "markdown";
						await this.plugin.saveSettings();
					}),
			);
			
		new Setting(containerEl)
			.setName(t("settings.timestampFormat"))
			.setDesc(t("settings.timestampFormatDesc"))
			.addText((text) =>
				text
					.setPlaceholder("HH:mm")
					.setValue(this.plugin.settings.timestampFormat)
					.onChange(async (value) => {
						this.plugin.settings.timestampFormat = normalizeTimestampFormat(value);
						await this.plugin.saveSettings();
						await this.plugin.refreshAllMemosViews();
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.boundFile"))
			.setDesc(t("settings.boundFileDesc"))
			.addText((text) =>
				text
					.setPlaceholder("Notes/inbox.md")
					.setValue(this.plugin.settings.boundFilePath)
					.onChange(async (value) => {
						this.plugin.settings.boundFilePath = normalizeBoundPath(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.memoStoreMode"))
			.setDesc(t("settings.memoStoreModeDesc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("daily", t("settings.memoStoreModeDaily"))
					.addOption("yearly", t("settings.memoStoreModeYearly"))
					.setValue(this.plugin.settings.memoStoreMode)
					.onChange(async (value) => {
						this.plugin.settings.memoStoreMode = value as "daily" | "yearly";
						await this.plugin.saveSettings();
						this.display();
						await this.plugin.refreshAllMemosViews();
					}),
			);

		if (this.plugin.settings.memoStoreMode === "daily") {
			new Setting(containerEl)
				.setName(t("settings.memoStoreHeading"))
				.setDesc(t("settings.memoStoreHeadingDesc"))
				.addText((text) =>
					text
						.setPlaceholder("## Memos")
						.setValue(this.plugin.settings.memoStoreHeading)
						.onChange(async (value) => {
							this.plugin.settings.memoStoreHeading = value.trim();
							await this.plugin.saveSettings();
							await this.plugin.refreshAllMemosViews();
						}),
				);
		}

		new Setting(containerEl)
			.setName(t("settings.memoReadMode"))
			.setDesc(t("settings.memoReadModeDesc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("all", t("settings.memoReadModeAll"))
					.addOption("daily", t("settings.memoReadModeDaily"))
					.addOption("yearly", t("settings.memoReadModeYearly"))
					.setValue(this.plugin.settings.memoReadMode)
					.onChange(async (value) => {
						this.plugin.settings.memoReadMode = value as "all" | "daily" | "yearly";
						await this.plugin.saveSettings();
						this.display();
						await this.plugin.refreshAllMemosViews();
					}),
			);

		if (this.plugin.settings.memoReadMode === "all" || this.plugin.settings.memoReadMode === "daily") {
			new Setting(containerEl)
				.setName(t("settings.memoReadHeading"))
				.setDesc(t("settings.memoReadHeadingDesc"))
				.addText((text) =>
					text
						.setPlaceholder("## Memos")
						.setValue(this.plugin.settings.memoReadHeading)
						.onChange(async (value) => {
							this.plugin.settings.memoReadHeading = value.trim();
							await this.plugin.saveSettings();
							await this.plugin.refreshAllMemosViews();
						}),
				);
		}

		this.displayWechatSettings(containerEl);
	}

	private displayWechatSettings(containerEl: HTMLElement): void {
		// 微信收信依赖 Node 传输，移动端隐藏整块设置
		if (!isNodeTransportAvailable()) {
			return;
		}
		const wechat = this.plugin.settings.wechat;

		new Setting(containerEl).setName(t("settings.wechat.heading")).setHeading();

		const loggedIn = wechat.botToken.trim().length > 0;
		const statusSetting = new Setting(containerEl)
			.setName(t("settings.wechat.status"))
			.setDesc(loggedIn ? t("settings.wechat.loggedIn") : t("settings.wechat.notLoggedIn"));

		if (loggedIn) {
			statusSetting
				.addButton((btn) =>
					btn
						.setButtonText(t("settings.wechat.reloginButton"))
						.onClick(() => {
							this.plugin.wechat.openLogin();
						}),
				)
				.addButton((btn) =>
					btn
						.setButtonText(t("settings.wechat.logoutButton"))
						.setCta()
						.onClick(async () => {
							await this.plugin.wechat.logout();
						}),
				);
		} else {
			statusSetting.addButton((btn) =>
				btn
					.setButtonText(t("settings.wechat.loginButton"))
					.setCta()
					.onClick(() => {
						this.plugin.wechat.openLogin();
					}),
			);
		}

		new Setting(containerEl)
			.setName(t("settings.wechat.attachmentFolder"))
			.setDesc(t("settings.wechat.attachmentFolderDesc"))
			.addText((text) =>
				text
					.setPlaceholder("attachments/wechat")
					.setValue(wechat.attachmentFolder)
					.onChange(async (value) => {
						wechat.attachmentFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.wechat.articleFolder"))
			.setDesc(t("settings.wechat.articleFolderDesc"))
			.addText((text) =>
				text
					.setPlaceholder("WeChat Articles")
					.setValue(wechat.articleFolder)
					.onChange(async (value) => {
						wechat.articleFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.wechat.clipConfirmKeyword"))
			.setDesc(t("settings.wechat.clipConfirmKeywordDesc"))
			.addText((text) =>
				text
					.setPlaceholder("剪藏")
					.setValue(wechat.clipConfirmKeyword)
					.onChange(async (value) => {
						wechat.clipConfirmKeyword = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.wechat.autoClipPureLink"))
			.setDesc(t("settings.wechat.autoClipPureLinkDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(wechat.autoClipPureLink)
					.onChange(async (value) => {
						wechat.autoClipPureLink = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.wechat.localiseArticleImages"))
			.setDesc(t("settings.wechat.localiseArticleImagesDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(wechat.localiseArticleImages)
					.onChange(async (value) => {
						wechat.localiseArticleImages = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.wechat.saveVoiceAudio"))
			.setDesc(t("settings.wechat.saveVoiceAudioDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(wechat.saveVoiceAudio)
					.onChange(async (value) => {
						wechat.saveVoiceAudio = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.wechat.useMessageTime"))
			.setDesc(t("settings.wechat.useMessageTimeDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(wechat.useMessageTime)
					.onChange(async (value) => {
						wechat.useMessageTime = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	private buildDailyNotesPathDesc(): DocumentFragment {
		const folder = this.plugin.getDailyNotesFolder();
		const text = folder
			? t("settings.dailyNotesPathValue", folder)
			: t("settings.dailyNotesPathEmpty");
		const frag = document.createDocumentFragment();
		text.split("\n").forEach((line, i) => {
			if (i > 0) frag.createEl("br");
			frag.appendText(line);
		});
		return frag;
	}
}

function normalizeTimestampFormat(format: string): string {
	const trimmed = format.trim();
	return trimmed || "HH:mm";
}
