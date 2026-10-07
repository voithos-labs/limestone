import type { MemberRow, ViewField } from '$lib/models/View.svelte';
import { TODO_DONE, isStatusField, type StatusOption } from '$lib/models/View.svelte';
import { rawStatefulValue } from '$lib/views/fieldValue';

// The todo tag's status is a select whose options each sit on one side of done. The checkbox
// stays canonical: a status is only written once it's been set, and until then it reads as
// the first option on the checkbox's side. Where the two disagree, the checkbox wins.

export type StatusKind = 'todo' | 'doing' | 'done';

const DONE_FIELD: ViewField = {
	id: TODO_DONE,
	name: 'done',
	type: 'boolean',
	config: {},
	unit: 'tag:todo'
};

export function statusOptions(field: ViewField): StatusOption[] {
	return ((field.config?.options ?? []) as StatusOption[]).map((o) => ({ ...o, done: !!o.done }));
}

export function statusIsDone(field: ViewField, value: string): boolean {
	return statusOptions(field).find((o) => o.value === value)?.done ?? false;
}

export function firstStatus(field: ViewField, done: boolean): string {
	return statusOptions(field).find((o) => o.done === done)?.value ?? (done ? 'done' : 'todo');
}

export function statusColor(field: ViewField, value: string): number {
	return statusOptions(field).find((o) => o.value === value)?.color ?? 0;
}

// the glyph: done is a filled check, the first open option an empty ring, anything else a half
export function statusKind(field: ViewField, value: string): StatusKind {
	if (statusIsDone(field, value)) return 'done';
	return value === firstStatus(field, false) ? 'todo' : 'doing';
}

export function statusOf(row: MemberRow, field: ViewField): string {
	const done = rawStatefulValue(row, DONE_FIELD) === true;
	const raw = rawStatefulValue(row, field);
	const v = typeof raw === 'string' ? raw : '';
	if (v && statusIsDone(field, v) === done) return v;
	return firstStatus(field, done);
}

// whether the leading slot's field reads as done, for a checkbox or a status
export function checkDone(row: MemberRow, field: ViewField): boolean {
	if (isStatusField(field)) return statusIsDone(field, statusOf(row, field));
	return rawStatefulValue(row, field) === true;
}
