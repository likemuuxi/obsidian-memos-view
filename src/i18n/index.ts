interface TranslationStrings {
	commands: {
		openMemosView: string;
		openMemosSidebar: string;
		refreshMemosView: string;
		wechatStart: string;
		wechatStop: string;
		wechatLogin: string;
	};
	view: {
		displayName: string;
		sidebarDisplayName: string;
		notes: string;
		tags: string;
		days: string;
		allTags: string;
		noTags: string;
		all: string;
		archived: string;
		deleted: string;
		toggleSidebar: string;
		randomWalk: string;
		searchPlaceholder: string;
		composerPlaceholder: string;
		togglePreview: string;
		saveMemo: string;
		noMatchingMemos: string;
		noMatchingMemosDesc: string;
		newMemoHint: string;
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
		recordVoice: string;
		stopRecording: string;
		attachmentPickerSearch: string;
		attachmentPickerEmpty: string;
		boldSelection: string;
		italicSelection: string;
		strikeSelection: string;
		highlightSelection: string;
		codeSelection: string;
		mathSelection: string;
		commentSelection: string;
		clearFormat: string;
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
		expandEditor: string;
		done: string;
	};
	viewFilters: {
		views: string;
		today: string;
		week: string;
		todo: string;
		tagged: string;
		hasAttachment: string;
		hasLink: string;
		attachmentImage: string;
		attachmentAudio: string;
		attachmentVideo: string;
		attachmentFile: string;
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
		permanentlyDelete: string;
		permanentlyDeleteConfirm: string;
		permanentlyDeleteAllConfirm: string;
		permanentlyDeleteMemoCount: string;
		memoPermanentlyDeleted: string;
		deleteAll: string;
		attachmentCleanupTitle: string;
		attachmentCleanupHint: string;
		attachmentCleanupEmpty: string;
		attachmentNoReferences: string;
		attachmentStillReferenced: string;
		attachmentSelectedCount: string;
		attachmentSelectAll: string;
		attachmentSelectNone: string;
		sourceFileNoLongerExists: string;
		couldNotLocateBlock: string;
		couldNotParseBlock: string;
		couldNotLocateParagraph: string;
		noWorkspaceLeaf: string;
		imageSaved: string;
		imageSaveFailed: string;
		voiceSaved: string;
		voiceSaveFailed: string;
		voiceUnsupported: string;
		voiceMicDenied: string;
		memoUpdateFailed: string;
		wechatDesktopOnly: string;
		wechatStarted: string;
		wechatStopped: string;
		wechatLoginSuccess: string;
		wechatTokenStale: string;
		wechatLoggedOut: string;
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
		memoReadMode: string;
		memoReadModeDesc: string;
		memoReadModeAll: string;
		memoReadModeDaily: string;
		memoReadModeYearly: string;
		memoStoreHeading: string;
		memoStoreHeadingDesc: string;
		memoReadHeading: string;
		memoReadHeadingDesc: string;
		shareTitle: string;
		shareTitleDesc: string;
		shareTitlePlaceholder: string;
		imageEmbedStyle: string;
		imageEmbedStyleDesc: string;
		imageEmbedStyleWikilink: string;
		imageEmbedStyleMarkdown: string;
		dailyNotesPath: string;
		dailyNotesPathValue: string;
		dailyNotesPathEmpty: string;
		wechat: {
			heading: string;
			status: string;
			loggedIn: string;
			notLoggedIn: string;
			loginButton: string;
			reloginButton: string;
			logoutButton: string;
			attachmentFolder: string;
			attachmentFolderDesc: string;
			articleFolder: string;
			articleFolderDesc: string;
			clipConfirmKeyword: string;
			clipConfirmKeywordDesc: string;
			autoClipPureLink: string;
			autoClipPureLinkDesc: string;
			localiseArticleImages: string;
			localiseArticleImagesDesc: string;
			saveVoiceAudio: string;
			saveVoiceAudioDesc: string;
			useMessageTime: string;
			useMessageTimeDesc: string;
		};
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
		openMemosSidebar: "Open memos sidebar",
		refreshMemosView: "Refresh memos view",
		wechatStart: "Start receiving WeChat messages",
		wechatStop: "Stop receiving WeChat messages",
		wechatLogin: "WeChat: scan QR code to log in",
	},
	view: {
		displayName: "Memos",
		sidebarDisplayName: "Memos",
		notes: "Notes",
		tags: "Tags",
		days: "Days",
		allTags: "All tags",
		noTags: "No tags found",
		all: "All",
		archived: "Archived",
		deleted: "Deleted",
		toggleSidebar: "Toggle sidebar",
		randomWalk: "Random walk",
		searchPlaceholder: "Search memos, files, tags",
		composerPlaceholder: "Type your thoughts here...",
		togglePreview: "Toggle preview",
		saveMemo: "Send",
		noMatchingMemos: "No matching memos",
		noMatchingMemosDesc: "Check your Daily notes setup, search keyword, or tag filter.",
		newMemoHint: "New memo will appear here",
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
		recordVoice: "Record voice",
		stopRecording: "Stop recording",
		attachmentPickerSearch: "Search attachments...",
		attachmentPickerEmpty: "No matching attachments found.",
		boldSelection: "Bold selection",
		italicSelection: "Italic selection",
		strikeSelection: "Strike selection",
		highlightSelection: "Highlight selection",
		codeSelection: "Code selection",
		mathSelection: "Math selection",
		commentSelection: "Comment selection",
		clearFormat: "Clear formatting",
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
		expandEditor: "Edit in full screen",
		done: "Done",
	},
	viewFilters: {
		views: "Views",
		today: "Today",
		week: "This week",
		todo: "To-do",
		tagged: "Has tags",
		hasAttachment: "Has attachment",
		hasLink: "Has link",
		attachmentImage: "Image",
		attachmentAudio: "Audio",
		attachmentVideo: "Video",
		attachmentFile: "File",
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
		permanentlyDelete: "Permanently delete",
		permanentlyDeleteConfirm: "Permanently delete this memo? This cannot be undone.",
		permanentlyDeleteAllConfirm: "Permanently delete {} deleted memos? This cannot be undone.",
		permanentlyDeleteMemoCount: "About to permanently delete {} memo(s). This cannot be undone.",
		memoPermanentlyDeleted: "Memo permanently deleted.",
		deleteAll: "Delete all",
		attachmentCleanupTitle: "Attachments referenced by these memos",
		attachmentCleanupHint: "Selected attachments will be moved to the trash together with the memos.",
		attachmentCleanupEmpty: "No attachments found in these memos.",
		attachmentNoReferences: "No other references",
		attachmentStillReferenced: "Referenced by other memos",
		attachmentSelectedCount: "{} selected",
		attachmentSelectAll: "Select all",
		attachmentSelectNone: "Select none",
		sourceFileNoLongerExists: "Source file no longer exists.",
		couldNotLocateBlock: "Could not locate the original memo block.",
		couldNotParseBlock: "Could not parse the original memo block.",
		couldNotLocateParagraph: "Could not locate the selected paragraph.",
		noWorkspaceLeaf: "No workspace leaf available.",
		imageSaved: "Image saved and embedded.",
		imageSaveFailed: "Failed to save pasted image.",
		voiceSaved: "Voice recording saved and embedded.",
		voiceSaveFailed: "Failed to save voice recording.",
		voiceUnsupported: "Voice recording is not supported in this environment.",
		voiceMicDenied: "Microphone access was denied.",
		memoUpdateFailed: "Failed to update the memo file.",
		wechatDesktopOnly: "WeChat integration is only available on desktop.",
		wechatStarted: "WeChat receiver started.",
		wechatStopped: "WeChat receiver stopped.",
		wechatLoginSuccess: "WeChat login successful.",
		wechatTokenStale: "WeChat session expired on the server. Pausing for 1 hour; scan to log in again if needed.",
		wechatLoggedOut: "WeChat account logged out.",
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
		memoReadMode: "Memo read mode",
		memoReadModeDesc: "Choose which files to read memos from: all supported files, only daily notes (YYYY-MM-DD), or only yearly files (YYYY).",
		memoReadModeAll: "All files",
		memoReadModeDaily: "Daily notes only",
		memoReadModeYearly: "Yearly files only",
		memoStoreHeading: "Store heading",
		memoStoreHeadingDesc: "When using daily notes, memos will be written under this heading. Leave empty to write at the top of the file.",
		memoReadHeading: "Read heading",
		memoReadHeadingDesc: "Only read memos under this heading from daily notes. Leave empty to read from the entire file.",
		shareTitle: "Share card title",
		shareTitleDesc: "Customize the title displayed at the top of the share card. Use {date} to show the memo date, or enter any text. Leave empty to show \"memos\".",
		shareTitlePlaceholder: "e.g. {date} or My Notes",
		imageEmbedStyle: "Image embed format",
		imageEmbedStyleDesc: "Choose the format used when inserting images: Wikilink (![[image.png]]) or Markdown (![alt](image.png)).",
		imageEmbedStyleWikilink: "Wikilink  ![[...]]",
		imageEmbedStyleMarkdown: "Markdown  ![...](...)",
		dailyNotesPath: "Daily notes path",
		dailyNotesPathValue: "Memos are read from and written to: {}\nTo change it, configure the core \"Daily notes\" plugin in Settings → Daily notes.",
		dailyNotesPathEmpty: "Not configured. Enable and set the \"New file location\" in Settings → Daily notes (core plugin).",
		wechat: {
			heading: "WeChat integration",
			status: "Login status",
			loggedIn: "Logged in",
			notLoggedIn: "Not logged in",
			loginButton: "Scan QR code to log in",
			reloginButton: "Re-login (scan QR code)",
			logoutButton: "Log out",
			attachmentFolder: "Attachment folder",
			attachmentFolderDesc: "Folder for images, voice and files received from WeChat. Empty = vault default attachment location.",
			articleFolder: "Article clip folder",
			articleFolderDesc: "Clipped articles (pure link or \"clip word + link\") are saved here.",
			clipConfirmKeyword: "Clip trigger word",
			clipConfirmKeywordDesc: "A message containing both this word and a web link clips the article, e.g. \"clip https://…\".",
			autoClipPureLink: "Auto-clip pure links",
			autoClipPureLinkDesc: "When on (default), sending just a web link clips the article directly. When off, only the trigger word plus a link clips, and plain links are saved as normal memos.",
			localiseArticleImages: "Download article images",
			localiseArticleImagesDesc: "Download article images to the vault when clipping, instead of keeping remote links.",
			saveVoiceAudio: "Save voice audio",
			saveVoiceAudioDesc: "When on (default), voice messages are saved as audio attachments along with the transcription. When off, only the transcription is kept; the audio is still saved if no transcription is available.",
			useMessageTime: "Use message time",
			useMessageTimeDesc: "Write memos with the time the message was sent (more accurate for offline catch-up).",
		},
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
		openMemosSidebar: "打开 Memos 侧边栏",
		refreshMemosView: "刷新 Memos 视图",
		wechatStart: "开始接收微信消息",
		wechatStop: "停止接收微信消息",
		wechatLogin: "微信：扫码登录",
	},
	view: {
		displayName: "Memos",
		sidebarDisplayName: "Memos",
		notes: "笔记",
		tags: "标签",
		days: "天数",
		allTags: "全部标签",
		noTags: "没有标签",
		all: "全部",
		archived: "归档",
		deleted: "回收站",
		toggleSidebar: "切换侧边栏",
		randomWalk: "随机漫步",
		searchPlaceholder: "搜索...",
		composerPlaceholder: "在此记录你的想法...",
		togglePreview: "切换预览",
		saveMemo: "发送",
		noMatchingMemos: "没有匹配的备忘录",
		noMatchingMemosDesc: "请检查日记设置、搜索关键词或标签筛选。",
		newMemoHint: "新条目会出现在这里",
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
		recordVoice: "录音",
		stopRecording: "停止录音",
		attachmentPickerSearch: "搜索附件...",
		attachmentPickerEmpty: "没有找到匹配的附件。",
		boldSelection: "加粗",
		italicSelection: "斜体",
		strikeSelection: "删除线",
		highlightSelection: "高亮",
		codeSelection: "代码",
		mathSelection: "数学",
		commentSelection: "注释",
		clearFormat: "清除格式",
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
		expandEditor: "全屏编辑",
		done: "完成",
	},
	viewFilters: {
		views: "视图",
		today: "今天",
		week: "本周",
		todo: "待办",
		tagged: "有标签",
		hasAttachment: "有附件",
		hasLink: "有链接",
		attachmentImage: "图片",
		attachmentAudio: "音频",
		attachmentVideo: "视频",
		attachmentFile: "文件",
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
		permanentlyDelete: "永久删除",
		permanentlyDeleteConfirm: "永久删除此备忘录？此操作不可撤销。",
		permanentlyDeleteAllConfirm: "永久删除 {} 条备忘录？此操作不可撤销。",
		permanentlyDeleteMemoCount: "将永久删除 {} 条备忘录，此操作不可撤销。",
		memoPermanentlyDeleted: "备忘录已永久删除。",
		deleteAll: "全部删除",
		attachmentCleanupTitle: "备忘录引用的附件",
		attachmentCleanupHint: "选中的附件将随备忘录一并移入回收站。",
		attachmentCleanupEmpty: "这些备忘录没有引用附件。",
		attachmentNoReferences: "无其他引用",
		attachmentStillReferenced: "仍被其他备忘录引用",
		attachmentSelectedCount: "已选 {} 个",
		attachmentSelectAll: "全选",
		attachmentSelectNone: "全不选",
		sourceFileNoLongerExists: "源文件已不存在。",
		couldNotLocateBlock: "无法定位原始备忘录块。",
		couldNotParseBlock: "无法解析原始备忘录块。",
		couldNotLocateParagraph: "无法定位所选段落。",
		noWorkspaceLeaf: "没有可用的工作区面板。",
		imageSaved: "图片已保存并嵌入。",
		imageSaveFailed: "保存粘贴的图片失败。",
		voiceSaved: "语音已保存并嵌入。",
		voiceSaveFailed: "保存语音录音失败。",
		voiceUnsupported: "当前环境不支持录音。",
		voiceMicDenied: "麦克风访问被拒绝。",
		memoUpdateFailed: "更新备忘录文件失败。",
		wechatDesktopOnly: "微信功能仅支持桌面端。",
		wechatStarted: "已开始接收微信消息。",
		wechatStopped: "已停止接收微信消息。",
		wechatLoginSuccess: "微信登录成功。",
		wechatTokenStale: "微信会话已在服务端过期，暂停接收 1 小时；如需立即恢复请重新扫码登录。",
		wechatLoggedOut: "已退出微信登录。",
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
		memoReadMode: "备忘录读取模式",
		memoReadModeDesc: "选择从哪些文件中读取备忘录：所有支持的文件、仅每日笔记（YYYY-MM-DD）或仅年度文件（YYYY）。",
		memoReadModeAll: "全部文件",
		memoReadModeDaily: "仅每日笔记",
		memoReadModeYearly: "仅年度文件",
		memoStoreHeading: "写入标题",
		memoStoreHeadingDesc: "使用每日笔记时，备忘录将写入到该标题下方。留空则写入文件顶部。",
		memoReadHeading: "读取标题",
		memoReadHeadingDesc: "仅读取每日笔记中该标题下的备忘录。留空则读取整个文件。",
		shareTitle: "分享卡片标题",
		shareTitleDesc: "自定义分享卡片顶部显示的标题。使用 {date} 显示备忘录日期，或输入任意文本。留空则显示 \"memos\"。",
		shareTitlePlaceholder: "例如 {date} 或 我的笔记",
		imageEmbedStyle: "图片插入格式",
		imageEmbedStyleDesc: "选择插入图片时使用的格式：Wikilink（![[image.png]]）或 Markdown（![alt](image.png)）。",
		imageEmbedStyleWikilink: "Wikilink  ![[...]]",
		imageEmbedStyleMarkdown: "Markdown  ![...](...)",
		dailyNotesPath: "日记读写路径",
		dailyNotesPathValue: "备忘录读取与写入位置：{}\n如需修改，请在「设置 → 每日笔记」核心插件中配置。",
		dailyNotesPathEmpty: "未配置。请启用并在「设置 → 每日笔记」核心插件中设置「新建文件位置」。",
		wechat: {
			heading: "微信集成",
			status: "登录状态",
			loggedIn: "已登录",
			notLoggedIn: "未登录",
			loginButton: "扫码登录",
			reloginButton: "重新扫码登录",
			logoutButton: "退出登录",
			attachmentFolder: "附件保存目录",
			attachmentFolderDesc: "微信收到的图片、语音和文件保存到此目录。留空使用库默认附件位置。",
			articleFolder: "文章剪藏目录",
			articleFolderDesc: "剪藏的文章（纯链接或「剪藏词 + 链接」触发）保存到此目录。",
			clipConfirmKeyword: "剪藏触发词",
			clipConfirmKeywordDesc: "消息中同时包含该词和网页链接时剪藏全文，例如「剪藏 https://…」。",
			autoClipPureLink: "纯链接自动剪藏",
			autoClipPureLinkDesc: "开启（默认）后，只发送一条网页链接也直接剪藏全文；关闭则仅「剪藏词 + 链接」触发剪藏，纯链接记为普通 memo。",
			localiseArticleImages: "下载文章图片",
			localiseArticleImagesDesc: "剪藏文章时把图片下载到本地，而不是保留远程链接。",
			saveVoiceAudio: "保存语音原声",
			saveVoiceAudioDesc: "开启（默认）后，语音在转写成文字的同时把原声存为附件；关闭则仅保留转写文字（无转写时仍会保存原声）。",
			useMessageTime: "使用消息时间",
			useMessageTimeDesc: "按消息发送时间写入备忘录（补收离线消息时更准确）。",
		},
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

function detectLocale(): string {
	if (typeof navigator !== "undefined" && navigator.language) {
		return navigator.language;
	}
	return "en";
}

let currentLocale = detectLocale();

/** 获取当前 locale（如 "zh-CN"、"en"） */
export function getLocale(): string {
	return currentLocale;
}

/** 当前 locale 是否为中文 */
export function isZhLocale(): boolean {
	return currentLocale.toLowerCase().startsWith("zh");
}

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
	return value;
}

export { t, type TranslationStrings };
