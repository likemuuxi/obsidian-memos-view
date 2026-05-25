interface TranslationStrings {
	commands: {
		openMemosView: string;
		refreshMemosView: string;
		randomWalkMemo: string;
	};
	view: {
		displayName: string;
		notes: string;
		tags: string;
		days: string;
		allTags: string;
		all: string;
		archived: string;
		deleted: string;
		toggleSidebar: string;
		randomWalk: string;
		searchPlaceholder: string;
		composerPlaceholder: string;
		saveMemo: string;
		noMatchingMemos: string;
		noMatchingMemosDesc: string;
		dayToday: string;
		dayYesterday: string;
		dayLabel: string;
		loadMore: string;
		backToTop: string;
		heatmapTooltip: string;
		sortCreatedDesc: string;
		sortCreatedAsc: string;
		sortUpdatedDesc: string;
		sortUpdatedAsc: string;
		sortOrderLabel: string;
		moreActions: string;
		quote: string;
		pin: string;
		unpin: string;
		edit: string;
		archive: string;
		unarchive: string;
		delete: string;
		restore: string;
		share: string;
		cancel: string;
		pinned: string;
		insertMention: string;
		insertTag: string;
		insertImage: string;
		boldSelection: string;
		italicSelection: string;
		strikeSelection: string;
		insertBulletList: string;
		insertNumberedList: string;
		insertTaskList: string;
		openSourceFile: string;
		nextRandomMemo: string;
		editing: string;
		today: string;
		wikilinkFile: string;
		wikilinkHeading: string;
		wikilinkParagraph: string;
		wikilinkBlock: string;
	};
	viewFilters: {
		views: string;
		today: string;
		week: string;
		todo: string;
		tagged: string;
		hasImage: string;
		hasLink: string;
	};
	notices: {
		writeSomethingFirst: string;
		memoUpdated: string;
		savedToToday: string;
		memoArchived: string;
		memoUnarchived: string;
		memoPinned: string;
		memoUnpinned: string;
		memoDeleted: string;
		memoRestored: string;
		noActiveMemosForRandomWalk: string;
		noMemosForRandomWalk: string;
		noDeletedMemos: string;
		permanentlyDeleted: string;
		deleteAll: string;
		sourceFileNoLongerExists: string;
		couldNotLocateBlock: string;
		couldNotParseBlock: string;
		couldNotLocateParagraph: string;
		noWorkspaceLeaf: string;
		couldNotOpenView: string;
		imageSaved: string;
		imageSaveFailed: string;
	};
	settings: {
		displayName: string;
		displayNameDesc: string;
		timestampFormat: string;
		timestampFormatDesc: string;
		boundFile: string;
		boundFileDesc: string;
		memoStoreMode: string;
		memoStoreModeDesc: string;
		memoStoreModeDaily: string;
		memoStoreModeDailyDesc: string;
		memoStoreModeYearly: string;
		memoStoreModeYearlyDesc: string;
	};
	share: {
		copyImage: string;
		saveImage: string;
		imageCopied: string;
		copyFailed: string;
		imageSaved: string;
		saveFailed: string;
	};
}

const en: TranslationStrings = {
	commands: {
		openMemosView: "Open memos view",
		refreshMemosView: "Refresh memos view",
		randomWalkMemo: "Random walk memo",
	},
	view: {
		displayName: "Memos",
		notes: "Notes",
		tags: "Tags",
		days: "Days",
		allTags: "All tags",
		all: "All",
		archived: "Archived",
		deleted: "Deleted",
		toggleSidebar: "Toggle sidebar",
		randomWalk: "Random walk",
		searchPlaceholder: "Search memos, files, tags",
		composerPlaceholder: "Type your thoughts here...",
		saveMemo: "Send",
		noMatchingMemos: "No matching memos",
		noMatchingMemosDesc: "Check your Daily notes setup, search keyword, or tag filter.",
		dayToday: "Today",
		dayYesterday: "Yesterday",
		dayLabel: "{} · {}",
		loadMore: "Load more ({} remaining)",
		backToTop: "Back to top",
		heatmapTooltip: "{} · {} memos",
		sortCreatedDesc: "Created time, newest first",
		sortCreatedAsc: "Created time, oldest first",
		sortUpdatedDesc: "Edited time, newest first",
		sortUpdatedAsc: "Edited time, oldest first",
		sortOrderLabel: "Sort order",
		moreActions: "More actions",
		quote: "Quote",
		pin: "Pin",
		unpin: "Unpin",
		edit: "Edit",
		archive: "Archive",
		unarchive: "Unarchive",
		delete: "Delete",
		restore: "Restore",
		share: "Share",
		cancel: "Cancel",
		pinned: "Pinned",
		insertMention: "Insert mention",
		insertTag: "Insert tag",
		insertImage: "Insert image",
		boldSelection: "Bold selection",
		italicSelection: "Italic selection",
		strikeSelection: "Strike selection",
		insertBulletList: "Insert bullet list",
		insertNumberedList: "Insert numbered list",
		insertTaskList: "Insert task list",
		openSourceFile: "Open source file",
		nextRandomMemo: "Next random memo",
		editing: "Editing: {}",
		today: "Today: {}",
		wikilinkFile: "File",
		wikilinkHeading: "Heading",
		wikilinkParagraph: "Paragraph",
		wikilinkBlock: "Block",
	},
	viewFilters: {
		views: "Views",
		today: "Today",
		week: "This week",
		todo: "To-do",
		tagged: "Has tags",
		hasImage: "Has image",
		hasLink: "Has link",
	},
	notices: {
		writeSomethingFirst: "Write something first.",
		memoUpdated: "Memo updated.",
		savedToToday: "Saved to today's daily note.",
		memoArchived: "Memo archived.",
		memoUnarchived: "Memo moved back to active.",
		memoPinned: "Memo pinned.",
		memoUnpinned: "Memo unpinned.",
		memoDeleted: "Memo marked as deleted.",
		memoRestored: "Memo restored.",
		noActiveMemosForRandomWalk: "No active memos available for random walk in the current filter.",
		noMemosForRandomWalk: "No memos available for random walk in the current filter.",
		noDeletedMemos: "No deleted memos to remove.",
		permanentlyDeleted: "Permanently deleted {} memos.",
		deleteAll: "Delete all",
		sourceFileNoLongerExists: "Source file no longer exists.",
		couldNotLocateBlock: "Could not locate the original memo block.",
		couldNotParseBlock: "Could not parse the original memo block.",
		couldNotLocateParagraph: "Could not locate the selected paragraph.",
		noWorkspaceLeaf: "No workspace leaf available.",
		couldNotOpenView: "Could not open memos view.",
		imageSaved: "Image saved and embedded.",
		imageSaveFailed: "Failed to save pasted image.",
	},
	settings: {
		displayName: "Display name",
		displayNameDesc: "Shown in the left memos header.",
		timestampFormat: "Timestamp format",
		timestampFormatDesc: "Used when creating memo timestamps and parsing daily note entries, for example HH:mm or HH:mm:ss.",
		boundFile: "Bound file",
		boundFileDesc: "When this file is opened, the current editor leaf is automatically switched to the memos view.",
		memoStoreMode: "Memo storage mode",
		memoStoreModeDesc: "Choose where to save memos: daily notes (one file per day) or yearly files (one file per year).",
		memoStoreModeDaily: "Daily notes",
		memoStoreModeDailyDesc: "Save each memo to its daily note file (YYYY-MM-DD.md).",
		memoStoreModeYearly: "Yearly file",
		memoStoreModeYearlyDesc: "Save memos to a yearly file (YYYY.md), organized by date headings.",
	},
	share: {
		copyImage: "Copy image",
		saveImage: "Save image",
		imageCopied: "Share image copied.",
		copyFailed: "Copy failed. Saving the image instead.",
		imageSaved: "Share image saved.",
		saveFailed: "Save failed.",
	},
};

const zhCN: TranslationStrings = {
	commands: {
		openMemosView: "打开 Memos 视图",
		refreshMemosView: "刷新 Memos 视图",
		randomWalkMemo: "随机漫步",
	},
	view: {
		displayName: "Memos",
		notes: "笔记",
		tags: "标签",
		days: "天数",
		allTags: "全部标签",
		all: "全部",
		archived: "归档",
		deleted: "回收站",
		toggleSidebar: "切换侧边栏",
		randomWalk: "随机漫步",
		searchPlaceholder: "搜索备忘录、文件、标签",
		composerPlaceholder: "在此记录你的想法...",
		saveMemo: "发送",
		noMatchingMemos: "没有匹配的备忘录",
		noMatchingMemosDesc: "请检查日记设置、搜索关键词或标签筛选。",
		dayToday: "今天",
		dayYesterday: "昨天",
		dayLabel: "{} · {}",
		loadMore: "加载更多（剩余 {} 条）",
		backToTop: "回到顶部",
		heatmapTooltip: "{} · {} 条备忘录",
		sortCreatedDesc: "创建时间，最新优先",
		sortCreatedAsc: "创建时间，最早优先",
		sortUpdatedDesc: "编辑时间，最新优先",
		sortUpdatedAsc: "编辑时间，最早优先",
		sortOrderLabel: "排序方式",
		moreActions: "更多操作",
		quote: "引用",
		pin: "置顶",
		unpin: "取消置顶",
		edit: "编辑",
		archive: "归档",
		unarchive: "取消归档",
		delete: "删除",
		restore: "恢复",
		share: "分享",
		cancel: "取消",
		pinned: "已置顶",
		insertMention: "插入提及",
		insertTag: "插入标签",
		insertImage: "插入图片",
		boldSelection: "加粗",
		italicSelection: "斜体",
		strikeSelection: "删除线",
		insertBulletList: "无序列表",
		insertNumberedList: "有序列表",
		insertTaskList: "任务列表",
		openSourceFile: "打开源文件",
		nextRandomMemo: "下一条随机备忘录",
		editing: "正在编辑：{}",
		today: "今日：{}",
		wikilinkFile: "文件",
		wikilinkHeading: "标题",
		wikilinkParagraph: "段落",
		wikilinkBlock: "块",
	},
	viewFilters: {
		views: "视图",
		today: "今天",
		week: "本周",
		todo: "待办",
		tagged: "有标签",
		hasImage: "有图片",
		hasLink: "有链接",
	},
	notices: {
		writeSomethingFirst: "请先输入内容。",
		memoUpdated: "备忘录已更新。",
		savedToToday: "已保存到今日日记。",
		memoArchived: "备忘录已归档。",
		memoUnarchived: "备忘录已恢复为活跃状态。",
		memoPinned: "备忘录已置顶。",
		memoUnpinned: "备忘录已取消置顶。",
		memoDeleted: "备忘录已标记为删除。",
		memoRestored: "备忘录已恢复。",
		noActiveMemosForRandomWalk: "当前筛选条件下没有可用于随机漫步的活跃备忘录。",
		noMemosForRandomWalk: "当前筛选条件下没有可用于随机漫步的备忘录。",
		noDeletedMemos: "没有已删除的备忘录。",
		permanentlyDeleted: "已永久删除 {} 条备忘录。",
		deleteAll: "全部删除",
		sourceFileNoLongerExists: "源文件已不存在。",
		couldNotLocateBlock: "无法定位原始备忘录块。",
		couldNotParseBlock: "无法解析原始备忘录块。",
		couldNotLocateParagraph: "无法定位所选段落。",
		noWorkspaceLeaf: "没有可用的工作区面板。",
		couldNotOpenView: "无法打开 Memos 视图。",
		imageSaved: "图片已保存并嵌入。",
		imageSaveFailed: "保存粘贴的图片失败。",
	},
	settings: {
		displayName: "显示名称",
		displayNameDesc: "显示在左侧 Memos 标题处。",
		timestampFormat: "时间戳格式",
		timestampFormatDesc: "用于创建备忘录时间戳和解析日记条目，例如 HH:mm 或 HH:mm:ss。",
		boundFile: "绑定文件",
		boundFileDesc: "打开此文件时，自动将当前编辑面板切换为 Memos 视图。",
		memoStoreMode: "备忘录存储模式",
		memoStoreModeDesc: "选择备忘录的保存方式：每日笔记（每天一个文件）或年度文件（每年一个文件）。",
		memoStoreModeDaily: "每日笔记",
		memoStoreModeDailyDesc: "将备忘录保存到对应的每日笔记文件（YYYY-MM-DD.md）。",
		memoStoreModeYearly: "年度文件",
		memoStoreModeYearlyDesc: "将备忘录保存到年度文件（YYYY.md），按日期标题组织。",
	},
	share: {
		copyImage: "复制图片",
		saveImage: "保存图片",
		imageCopied: "分享图片已复制。",
		copyFailed: "复制失败，正在改为保存图片。",
		imageSaved: "分享图片已保存。",
		saveFailed: "保存失败。",
	},
};

type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

const translations: Record<string, DeepPartial<TranslationStrings>> = {
	zh: zhCN,
	"zh-CN": zhCN,
	"zh-TW": zhCN,
	"zh-Hans": zhCN,
	"zh-Hant": zhCN,
};

function resolve(obj: Record<string, unknown>, path: string[]): string | undefined {
	let current: unknown = obj;
	for (const key of path) {
		if (current === null || current === undefined || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[key];
	}
	return typeof current === "string" ? current : undefined;
}

function getLocale(): string {
	if (typeof navigator !== "undefined" && navigator.language) {
		return navigator.language;
	}
	return "en";
}

let currentLocale = getLocale();

export function setLocale(locale: string): void {
	currentLocale = locale;
}

function getTranslations(): TranslationStrings {
	const localeVariants = [currentLocale];
	const base = currentLocale.split("-")[0];
	if (base && base !== currentLocale) {
		localeVariants.push(base);
	}

	for (const variant of localeVariants) {
		const override = translations[variant];
		if (override) {
			return merge(en, override);
		}
	}

	return en;
}

function merge(base: TranslationStrings, override: DeepPartial<TranslationStrings>): TranslationStrings {
	const result = { ...base };
	for (const key of Object.keys(override) as Array<keyof TranslationStrings>) {
		const overrideVal = override[key];
		if (overrideVal && typeof overrideVal === "object") {
			(result[key] as Record<string, string>) = {
				...(base[key] as Record<string, string>),
				...(overrideVal as Record<string, string>),
			};
		}
	}
	return result;
}

function t(path: string, ...args: (string | number)[]): string {
	const keys = path.split(".");
	const translations = getTranslations();
	let value = resolve(translations as unknown as Record<string, unknown>, keys);
	if (value === undefined) {
		value = resolve(en as unknown as Record<string, unknown>, keys) ?? path;
	}
	args.forEach((arg) => {
		value = value!.replace("{}", String(arg));
	});
	return value!;
}

export { t, type TranslationStrings };
