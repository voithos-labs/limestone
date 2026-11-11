/**
 * stacking things in the margin beside their passages.
 *
 * Each card or marker sits level with its passage, unless that would overlap the one above, in
 * which case it's pushed down just enough to clear it.
 */

/** Each item's top, in reading order: at its anchor, pushed down just enough to clear the one above. */
export function stackTops<T>(
	items: readonly T[],
	anchor: (item: T) => number,
	height: (item: T) => number,
	gap: number
): Map<T, number> {
	const tops = new Map<T, number>();
	let floor = -Infinity;
	for (const item of [...items].sort((p, q) => anchor(p) - anchor(q))) {
		const top = Math.max(anchor(item), floor);
		tops.set(item, top);
		floor = top + height(item) + gap;
	}
	return tops;
}
