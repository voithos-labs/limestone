import {
	type MemberRow,
	type ViewField,
	type ViewFieldType,
	CREATABLE_FIELD_TYPES,
	fieldKey,
	isBuiltinField,
	isDerived,
	BUILTIN_UNITS,
	TODO_DONE,
	isStatusField,
	type StatusOption
} from '#lib/models/View.svelte.js';
import { sourceName as sourceFolderName, type Source } from '#lib/models/Source.js';
import { formatDateFriendly, formatDateISO, formatViewDate } from '#lib/views/dateFormat.js';

// reads a stateful field value (views.<unit key>.<field>) off a row's props
export function rawStatefulValue(row: MemberRow, field: ViewField): unknown {
	try {
		const props = JSON.parse(row.properties || '{}');
		return props?.views?.[fieldKey(field)]?.[field.name] ?? null;
	} catch {
		return null;
	}
}

export function statefulValue(row: MemberRow, field: ViewField): string {
	const v = rawStatefulValue(row, field);
	if (v === undefined || v === null) return '';
	if (Array.isArray(v)) return v.join(', ');
	if (typeof v === 'boolean') return v ? '✓' : '';
	return String(v);
}

export function rawArrayValue(row: MemberRow, field: ViewField): string[] {
	const v = rawStatefulValue(row, field);
	if (Array.isArray(v)) return [...new Set(v.map(String))];
	if (v === null || v === undefined || v === '') return [];
	return [String(v)];
}

// returns a new properties JSON with views.<unit key>.<field>
export function withStatefulValue(
	propertiesJson: string,
	field: ViewField,
	value: unknown
): string {
	let props: { views?: Record<string, Record<string, unknown>> };
	try {
		props = JSON.parse(propertiesJson || '{}');
	} catch {
		props = {};
	}
	const key = fieldKey(field);
	props.views ??= {};
	props.views[key] ??= {};
	const empty = value === null || value === '' || (Array.isArray(value) && value.length === 0);
	if (empty) delete props.views[key][field.name];
	else props.views[key][field.name] = value;
	return JSON.stringify(props);
}

// nests name-keyed seed values under each field's unit key
export function seedProperties(
	fields: ViewField[],
	values: Record<string, unknown>
): Record<string, unknown> {
	const views: Record<string, Record<string, unknown>> = {};
	for (const f of fields) {
		if (isDerived(f.type) || !(f.name in values)) continue;
		(views[fieldKey(f)] ??= {})[f.name] = values[f.name];
	}
	return Object.keys(views).length ? { views } : {};
}

// dir portion of a rel_path, normalized to forward slashes
export function folderDir(relPath: string): string {
	const p = relPath.replace(/\\/g, '/');
	const i = p.lastIndexOf('/');
	return i < 0 ? '' : p.slice(0, i);
}

// file (last segment) of a rel_path, normalized to forward slashes
export function fileName(relPath: string): string {
	const p = relPath.replace(/\\/g, '/');
	return p.slice(p.lastIndexOf('/') + 1);
}

export function sourceName(sources: Source[], id: string): string {
	const s = sources.find((s) => s.id === id);
	return s ? sourceFolderName(s) : 'Source root';
}

// css class for a select/multiselect/tag value: configured option colour, else a hash
export function tagClass(field: ViewField, value: string): string {
	const opts = (field.config?.options ?? []) as { value: string; color: number }[];
	const opt = opts.find((o) => o.value === value);
	if (opt) return `tag-c${opt.color}`;
	let h = 0;
	for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
	return `tag-c${h % 16}`;
}

// plain-text value for a field on a row (used for titles, search, sort previews)
export function valueFor(field: ViewField, row: MemberRow): string {
	switch (field.type) {
		case 'title':
			return row.title;
		case 'created_at':
			return formatDateFriendly(row.created_at);
		case 'updated_at':
			return formatDateFriendly(row.updated_at);
		case 'date': {
			const v = rawStatefulValue(row, field);
			return v == null ? '' : formatViewDate(v as string);
		}
		case 'folder':
			return folderDir(row.rel_path).split('/').filter(Boolean).join(' / ');
		case 'tags':
			return '—';
		default:
			return statefulValue(row, field);
	}
}

// hover/title-attr text; mostly valueFor, with full ISO for timestamps
export function titleFor(field: ViewField, row: MemberRow): string {
	switch (field.type) {
		case 'created_at':
			return formatDateISO(row.created_at);
		case 'updated_at':
			return formatDateISO(row.updated_at);
		default:
			return valueFor(field, row);
	}
}

const EDITABLE = new Set<string>([
	...CREATABLE_FIELD_TYPES,
	'created_at',
	'updated_at',
	'folder',
	'tags'
]);

export function isEditable(field: ViewField): boolean {
	return EDITABLE.has(field.type);
}

export function isMetaField(type: ViewFieldType): boolean {
	return type === 'created_at' || type === 'updated_at';
}

const PRETTY_FIELD: Record<string, string> = {
	title: 'Title',
	tags: 'Tags',
	folder: 'Location',
	created_at: 'Created',
	updated_at: 'Updated',
	metadata: 'Properties'
};

// built-ins show a pretty label until renamed then the user's name wins
export function fieldLabel(field: ViewField): string {
	if (field.name === field.type && PRETTY_FIELD[field.type]) return PRETTY_FIELD[field.type];
	// registry names are lowercase keys; they read like the derived fields do
	if (isBuiltinField(field)) return field.name.charAt(0).toUpperCase() + field.name.slice(1);
	return field.name;
}

// The list has two lanes after the title. Fields that say what a note is sit right after it as
// pills; fields that say when or how much pack to the right. A face can override the lane per
// field (config.right); this is the default when it hasn't.
const INLINE: ReadonlySet<string> = new Set(['tags', 'select', 'multiselect']);

export function listInlineByDefault(type: ViewFieldType): boolean {
	return INLINE.has(type);
}

// A value is prefixed (icon for derived, label for stateful) only where it would otherwise be
// ambiguous: pills carry their own look and "updated" is the date everyone expects.
const BARE: ReadonlySet<string> = new Set(['tags', 'select', 'multiselect', 'updated_at']);

export function listPrefixed(type: ViewFieldType): boolean {
	return !BARE.has(type);
}

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
