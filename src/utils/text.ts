/**
 * 在 textarea 光标处插入文本(替换选区),并触发 input 事件。
 *
 * 当前使用 document.execCommand("insertText"),因为它能触发 Obsidian 内部
 * 的 contenteditable/textarea 状态同步。虽然该 API 已被标记为废弃,
 * 但在 Obsidian 的 Electron 环境中仍是最可靠的方案。
 *
 * 未来若需替换,只需修改此函数内部实现,所有调用方无需改动。
 */
export function insertTextAtCaret(
	textareaEl: HTMLTextAreaElement,
	text: string,
): void {
	// eslint-disable-next-line @typescript-eslint/no-deprecated -- 保留理由见上方注释：触发 Obsidian 内部同步的最可靠方案
	document.execCommand("insertText", false, text);
}
