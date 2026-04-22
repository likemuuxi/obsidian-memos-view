import { normalizePath } from "obsidian";
import { App, PluginSettingTab, Setting } from "obsidian";
import type MemosViewPlugin from "./main";
import type { MemosPluginSettings } from "./types";

export const DEFAULT_SETTINGS: MemosPluginSettings = {
	boundFilePath: "",
	displayName: "",
	timestampFormat: "HH:mm",
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
			.setName("Display name")
			.setDesc("Shown in the left memos header.")
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
			.setName("Timestamp format")
			.setDesc("Used when creating memo timestamps and parsing daily note entries, for example HH:mm or HH:mm:ss.")
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
			.setName("Bound file")
			.setDesc("When this file is opened, the current editor leaf is automatically switched to the memos view.")
			.addText((text) =>
				text
					.setPlaceholder("Notes/inbox.md")
					.setValue(this.plugin.settings.boundFilePath)
					.onChange(async (value) => {
						this.plugin.settings.boundFilePath = normalizeBoundPath(value);
						await this.plugin.saveSettings();
					}),
			);
	}
}

function normalizeBoundPath(path: string): string {
	const trimmed = path.trim();
	if (!trimmed) {
		return "";
	}

	return normalizePath(trimmed.replace(/\\/g, "/"));
}

function normalizeTimestampFormat(format: string): string {
	const trimmed = format.trim();
	return trimmed || "HH:mm";
}
