export function portal(node: HTMLElement, target: HTMLElement | null | undefined) {
	const move = (to: HTMLElement | null | undefined) => {
		if (to && node.parentElement !== to) to.appendChild(node);
	};
	move(target);
	return {
		update: move,
		destroy() {
			node.remove();
		}
	};
}

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

export const SNIPPET_MARK_START = String.fromCharCode(1);
export const SNIPPET_MARK_END = String.fromCharCode(2);

export function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlightTitle(title: string, indices: number[]): string {
	if (indices.length === 0) return escapeHtml(title);
	const set = new Set(indices);
	return [...title]
		.map((ch, i) => (set.has(i) ? `<mark>${escapeHtml(ch)}</mark>` : escapeHtml(ch)))
		.join('');
}

export function highlightSnippet(raw: string): string {
	return escapeHtml(raw)
		.replaceAll(SNIPPET_MARK_START, '<mark>')
		.replaceAll(SNIPPET_MARK_END, '</mark>')
		.replace(/<\/mark>(\s+)<mark>/g, '$1');
}
