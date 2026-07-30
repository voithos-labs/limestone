import type { MemberRow, ViewField, ViewFieldType } from '$lib/models/View.svelte';
import { CREATABLE_FIELD_TYPES } from '$lib/models/View.svelte';
import { sourceName as sourceFolderName, type Source } from '$lib/models/Source';
import { formatDateFriendly, formatDateISO, formatViewDate } from './dateFormat';

// reads a per-view stateful field value (views.<slug>.<field>) off a row's props
export function rawStatefulValue(row: MemberRow, viewSlug: string, fieldName: string): unknown {
	try {
		const props = JSON.parse(row.properties || '{}');
		return props?.views?.[viewSlug]?.[fieldName] ?? null;
	} catch {
		return null;
	}
}

export function statefulValue(row: MemberRow, viewSlug: string, fieldName: string): string {
	const v = rawStatefulValue(row, viewSlug, fieldName);
	if (v === undefined || v === null) return '';
	if (Array.isArray(v)) return v.join(', ');
	if (typeof v === 'boolean') return v ? '✓' : '';
	return String(v);
}

export function rawArrayValue(row: MemberRow, viewSlug: string, fieldName: string): string[] {
	const v = rawStatefulValue(row, viewSlug, fieldName);
	if (Array.isArray(v)) return v.map(String);
	if (v === null || v === undefined || v === '') return [];
	return [String(v)];
}

// returns a new properties JSON with views.<slug>.<field>
export function withStatefulValue(
	propertiesJson: string,
	viewSlug: string,
	fieldName: string,
	value: unknown
): string {
	let props: { views?: Record<string, Record<string, unknown>> };
	try {
		props = JSON.parse(propertiesJson || '{}');
	} catch {
		props = {};
	}
	props.views ??= {};
	props.views[viewSlug] ??= {};
	const empty = value === null || value === '' || (Array.isArray(value) && value.length === 0);
	if (empty) delete props.views[viewSlug][fieldName];
	else props.views[viewSlug][fieldName] = value;
	return JSON.stringify(props);
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
export function valueFor(field: ViewField, row: MemberRow, viewSlug: string): string {
	switch (field.type) {
		case 'title':
			return row.title;
		case 'path':
			return row.rel_path;
		case 'id':
			return row.id;
		case 'created_at':
			return formatDateFriendly(row.created_at);
		case 'updated_at':
			return formatDateFriendly(row.updated_at);
		case 'date': {
			const v = rawStatefulValue(row, viewSlug, field.name);
			return v == null ? '' : formatViewDate(v as string);
		}
		case 'folder':
			return folderDir(row.rel_path).split('/').filter(Boolean).join(' / ');
		case 'tags':
			return '—';
		default:
			return statefulValue(row, viewSlug, field.name);
	}
}

// hover/title-attr text; mostly valueFor, with full ISO for timestamps
export function titleFor(field: ViewField, row: MemberRow, viewSlug: string): string {
	switch (field.type) {
		case 'created_at':
			return formatDateISO(row.created_at);
		case 'updated_at':
			return formatDateISO(row.updated_at);
		default:
			return valueFor(field, row, viewSlug);
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
	id: 'ID',
	tags: 'Tags',
	folder: 'Location',
	path: 'Path',
	created_at: 'Created',
	updated_at: 'Updated'
};

// built-ins show a pretty label until renamed then the user's name wins
export function fieldLabel(field: ViewField): string {
	if (field.name === field.type && PRETTY_FIELD[field.type]) return PRETTY_FIELD[field.type];
	return field.name;
}
