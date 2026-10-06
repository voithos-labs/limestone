function offsetIn(el: HTMLElement, node: Node, offset: number): number {
	if (!el.contains(node)) {
		return el.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING ? Infinity : 0;
	}
	const pre = document.createRange();
	pre.selectNodeContents(el);
	pre.setEnd(node, offset);
	return pre.toString().length;
}

export function selectionIn(el: HTMLElement, text: string): [number, number] | null {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	const lead = Math.max(0, (el.textContent ?? '').indexOf(text));
	const clamp = (n: number) => Math.min(text.length, Math.max(0, n - lead));
	const r = sel.getRangeAt(0);
	return [
		clamp(offsetIn(el, r.startContainer, r.startOffset)),
		clamp(offsetIn(el, r.endContainer, r.endOffset))
	];
}

export function restoreSelection(node: HTMLInputElement, range: [number, number] | null) {
	const end = node.value.length;
	const [from, to] = range ?? [end, end];
	node.focus();
	node.setSelectionRange(from, to);
}
