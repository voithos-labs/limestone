/**
 * undo and redo for the marks on a pdf.
 *
 * Every gesture (a pen stroke, an erase, a delete, a recolor, etc.) is kept as a plain record of
 * what it changed: the loose ink strokes it added and removed, and each annotation note's fields
 * before and after. Basically kept as delta. So you can use `applyChange` to play a record forward
 * to redo it, or backward to undo it
 */

import type { Step } from '#lib/models/StepHistory.svelte.js';
import type { AnnotationFields } from './annotation.js';
import type { LooseStroke } from './ink.js';

/* -------------------------- What a change holds --------------------------- */

export interface MarkChange {
	added?: LooseStroke[];
	removed?: LooseStroke[];
	notes?: NoteChange[];
}

export interface NoteChange {
	id: string;
	before: NoteFields | null;
	after: NoteFields | null;
}

export type NoteFields = Partial<Omit<AnnotationFields, 'pdf'>>;

/* --------------------------- Applying a change ---------------------------- */

/** The stores a change is applied to. */
export interface Marks {
	looseInk: {
		add(...strokes: LooseStroke[]): void;
		take(drop: (s: LooseStroke) => boolean): LooseStroke[];
	};
	annotations: {
		remove(id: string): Promise<void>;
		/** Brings back what `remove` deleted. */
		restore(id: string): Promise<void>;
		setFields(id: string, fields: NoteFields): Promise<void>;
	};
}

/** Makes `change` forward, as it was made, or backward, taking it back. */
export async function applyChange(
	change: MarkChange,
	marks: Marks,
	forward: boolean
): Promise<void> {
	// notes first: a write to one can fail, which should leave the ink as it was
	for (const { id, before, after } of change.notes ?? []) {
		const [from, to] = forward ? [before, after] : [after, before];
		if (!to) await marks.annotations.remove(id);
		else if (!from) await marks.annotations.restore(id);
		else await marks.annotations.setFields(id, to);
	}
	const out = (forward ? change.removed : change.added) ?? [];
	const back = (forward ? change.added : change.removed) ?? [];
	marks.looseInk.take((s) => out.includes(s));
	marks.looseInk.add(...back);
}

/** The undo step for a change that has been made. */
export function changeStep(change: MarkChange, marks: Marks): Step {
	return {
		undo: () => applyChange(change, marks, false),
		redo: () => applyChange(change, marks, true)
	};
}
