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
