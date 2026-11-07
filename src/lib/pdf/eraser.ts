/**
 * the eraser.
 *
 * A drag collects every mark it touches (ink stroke by stroke, highlights and regions whole), and
 * those stay dimmed until the drag ends. Then `erasure` turns the lot into one change, so one undo
 * brings the whole drag back.
 */

import { rectsOn, type Annotation, type InkStroke, type PageRect } from './annotation.js';
import type { MarkChange, NoteChange } from './changes.js';
import { nearStroke, strokesBox, type LooseStroke } from './ink.js';

/* -------------------------- What a drag touches --------------------------- */

export interface Erasing {
	loose: LooseStroke[];
	/** Each touched annotation: an ink annotation's touched strokes by index, null for a whole mark. */
	notes: Map<string, number[] | null>;
}

/** Where the eraser is: a point on a page, its reach a fraction of the page's width. */
export interface EraserAt {
	page: number;
	x: number;
	y: number;
	radius: number;
	/** The page's height over its width. */
	aspect: number;
}

export function nothingErased(): Erasing {
	return { loose: [], notes: new Map() };
}

/** What `e` holds and what the eraser touches besides; `e` itself when it touches nothing new. */
export function touch(
	e: Erasing,
	at: EraserAt,
	on: { loose: LooseStroke[]; annotations: Annotation[] }
): Erasing {
	const near = (s: InkStroke) => nearStroke(s, at.x, at.y, at.radius, at.aspect);
	const loose = on.loose.filter((s) => !e.loose.includes(s) && near(s));
	const notes = new Map(e.notes);
	for (const a of on.annotations) {
		const had = notes.get(a.id);
		if (had === null) continue;
		if (a.kind === 'ink') {
			const more = (a.strokes ?? []).flatMap((s, i) => (had?.includes(i) || !near(s) ? [] : [i]));
			if (more.length) notes.set(a.id, [...(had ?? []), ...more]);
		} else if (rectsOn(a, at.page).some((r) => over(r, at))) {
			notes.set(a.id, null);
		}
	}
	const touched = loose.length > 0 || [...notes].some(([id, n]) => e.notes.get(id) !== n);
	return touched ? { loose: [...e.loose, ...loose], notes } : e;
}

/** Whether a drag touched anything. */
export function erasedAny(e: Erasing): boolean {
	return e.loose.length > 0 || e.notes.size > 0;
}

// a box is already a target, and the eraser's reach would take the lines either side of a highlight
function over([x, y, w, h]: PageRect, at: EraserAt): boolean {
	return at.x >= x && at.x <= x + w && at.y >= y && at.y <= y + h;
}

/* ------------------------ Deleting what it touched ------------------------ */

/**
 * The change that deletes what a drag touched. An ink annotation keeps its untouched strokes,
 * boxed afresh, and goes only when none are left.
 */
export function erasure(e: Erasing, annotations: Annotation[]): MarkChange {
	const notes: NoteChange[] = [];
	for (const [id, touched] of e.notes) {
		const a = annotations.find((x) => x.id === id);
		if (!a) continue;
		const strokes = touched && (a.strokes ?? []).filter((_, i) => !touched.includes(i));
		notes.push(
			strokes?.length
				? {
						id,
						before: { strokes: a.strokes, rects: a.rects },
						after: { strokes, rects: [strokesBox(strokes)] }
					}
				: { id, before: a, after: null }
		);
	}
	return { removed: e.loose, notes };
}
