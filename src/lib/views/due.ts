import { BUILTIN_UNITS, type MemberRow, type ViewField } from '$lib/models/View.svelte';
import { rawStatefulValue } from './fieldValue';

// How pressing a todo's due date is: due today asks for attention, before today is late. A
// todo that's done is neither, and only the built-in due date means "due"
export type DueState = 'today' | 'overdue' | null;

const TODO = 'tag:todo';
const DUE = `${TODO}/due`;
const DONE = `${TODO}/done`;

export function dueState(row: MemberRow, field: ViewField): DueState {
	if (field.id !== DUE) return null;
	const done = BUILTIN_UNITS[TODO]?.fields.find((f) => f.id === DONE);
	if (done && rawStatefulValue(row, done) === true) return null;
	const v = rawStatefulValue(row, field);
	const m = typeof v === 'string' ? v.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
	if (!m) return null;
	const due = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	return due < today ? 'overdue' : due === today ? 'today' : null;
}
