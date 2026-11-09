/**
 * 在 textarea 光标处插入文本(替换选区),并触发 input 事件。
 *
 * 使用 setRangeText 替代已废弃的 document.execCommand("insertText"),
 * 手动派发 input 事件以触发 Obsidian 内部状态同步。
 */
export function insertTextAtCaret(
	textareaEl: HTMLTextAreaElement,
	text: string,
): void {
	const start = textareaEl.selectionStart ?? textareaEl.value.length;
	const end = textareaEl.selectionEnd ?? start;
	textareaEl.setRangeText(text, start, end, "end");
	textareaEl.dispatchEvent(
		new Event("input", { bubbles: true, composed: true }),
	);
}
