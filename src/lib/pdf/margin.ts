/** Placing things beside their passages in a column: each level with its passage, none overlapping. */

/** Tops by id, in reading order: each item at its anchor, pushed down just enough to clear the one above. */
export function stackTops<T extends { id: string }>(
	items: readonly T[],
	anchor: (item: T) => number,
	height: (item: T) => number,
	gap: number
): Map<string, number> {
	const tops = new Map<string, number>();
	let floor = -Infinity;
	for (const item of [...items].sort((p, q) => anchor(p) - anchor(q))) {
		const top = Math.max(anchor(item), floor);
		tops.set(item.id, top);
		floor = top + height(item) + gap;
	}
	return tops;
}
