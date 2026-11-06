import type { Step } from '#lib/models/StepHistory.svelte.js';
import type { AnnotationFields } from './annotation.js';
import type { LooseStroke } from './ink.js';

/**
 * What one gesture changed on a PDF's marks, kept as data that undo applies backward and redo
 * forward: the loose strokes it added and removed, and each annotation's fields before and after
 * (null where the annotation didn't exist).
 */

// ── Public API ──────────────────────────────────────────────────────────────

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
