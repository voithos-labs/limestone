export type RowOpen = boolean | 'side';

export function openHow(e: MouseEvent): RowOpen {
	const mod = e.ctrlKey || e.metaKey;
	return mod && e.shiftKey ? 'side' : mod;
}
