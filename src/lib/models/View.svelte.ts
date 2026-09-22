/**
 * So what is a view? Hmm good question
 *
 * A view is a way to display a group of documents, with specialized views for representing certain
 * kinds of documents in certain ways
 *
 * I think notion does view UI well so I will take some insporation from them there.
 *
 * Okay but what does a group of documents really mean? Well okay: at least one group, with filters.
 *
 * There are a few ways to do this but the simplest and cleanest is probably using the properties
 * object all documents hold
 *
 * Alternatives that came to mind were using nested/global groups (e.g. 'done') which would allow a
 * view, my-view, to be stateful via a members intersection with the group done -- if in group done,
 * mark as done. Marking something done => add to done group.
 *
 * Edge case city baby
 *
 * How do you store a prop like due-date? Pain in the ass, hybrid is overengineered for nothing
 * => use views.<view-slug>.<prop> as flat frontmatter keys, into props object at runtime
 *
 * Orphaned data you say when you move a doc out of a group or delete a view etc.? Yep, harmless
 * (it's scoped!) orphaned data that we can safely clean (easy to check view membership)
 *
 * In DocHandle, it's clear where this lives
 * In an actual .md document file it lives in the frontmatter -- this does mean you can't use
 * certain view features without yaml frontmatter enabled though )-(
 *
 * okay so I'm thinking this is just fine, almost all docs can have frontmatter even in git repos
 * except maybe readme.md and other key files, for which maybe we can set up a pattern or whatever
 * .gitignore style or something -- we already have something similar for indexing ignores
 *
 * okay this works but got to think about view action => document consequence dataflow
 *
 * ---
 *
 * things have been thought about, I've decided to make views match 1:1 with projects, and less
 * complex structures below this, like to do lists. So up to
 *
 * ---
 *
 * for now I'm just going to store the views in a global json, at the install route.
 */

import { v4 as uuidv4 } from 'uuid';
import { invoke } from '@tauri-apps/api/core';
import type DocHandle from '$lib/models/DocHandle';
import type Tag from '$lib/models/Tag';
import Folder, { folderId, folderIdPath, isSourceRoot } from '$lib/models/Folder';
import { listSources, sourceName, type Source } from '$lib/models/Source';
import { select } from '$lib/services/db';
import { load, type Store } from '@tauri-apps/plugin-store';
import { toasts } from '$lib/toasts.svelte';
import { resolveRelativeDate, wallClockToMs } from '$lib/views/dateFormat';

export type ViewFaceType =
	'table' | 'list' | 'grid' | 'doc' | 'kanban' | 'calendar' | 'pinned' | 'journal';

interface ViewFaceJSON {
	id: string;
	type: ViewFaceType;
	name?: string;
	display_field_ids: string[];
	additive_filter: FilterCompound;
	sort: SortKey[];
	config: Record<string, any>;
	body?: ViewFaceJSON | null;
}

const FACE_TYPE_LABEL: Record<ViewFaceType, string> = {
	table: 'Table',
	list: 'List',
	grid: 'Grid',
	doc: 'Document',
	kanban: 'Board',
	calendar: 'Calendar',
	pinned: 'Pinned',
	journal: 'Journal'
};

export class ViewFace {
	id: string; // uuid
	type: ViewFaceType;
	name: string = $state('');
	display_field_ids: string[] = $state([]); // ORDERED LIST OF FIELD IDS
	additive_filter: FilterCompound = $state({ op: 'and', children: [] }); // View filters AND this node
	sort: SortKey[] = $state([]);
	config: Record<string, any> = $state({});
	// A compound face (journal) renders another face as its body; the parent owns
	// the body's additive_filter to scope it (e.g. to the selected day). A journal
	// always has one: a face saved before the doc face existed (body: null) meant
	// "show the day's document", which is now a doc body.
	body: ViewFace | null = $state(null);

	constructor(json: ViewFaceJSON) {
		this.id = json.id;
		this.type = json.type;
		this.name = json.name ?? '';
		this.display_field_ids = json.display_field_ids;
		this.additive_filter = json.additive_filter;
		this.sort = json.sort;
		this.config = json.config;
		this.body = json.body
			? new ViewFace({ ...json.body, additive_filter: { op: 'and', children: [] } })
			: json.type === 'journal'
				? ViewFace.create('doc')
				: null;
	}

	get label(): string {
		return this.name || FACE_TYPE_LABEL[this.type];
	}

	static create(
		type: ViewFaceType,
		display_field_ids: string[] = [],
		additive_filter: FilterCompound = { op: 'and', children: [] },
		sort: SortKey[] = [],
		config: Record<string, any> = {}
	): ViewFace {
		return new ViewFace({
			id: uuidv4(),
			type,
			display_field_ids,
			additive_filter,
			sort,
			config
		});
	}

	addBasicFilter(filter: FilterLeaf) {
		this.additive_filter.children.push(filter);
	}

	removeFilter(filter: FilterLeaf) {
		const i = this.additive_filter.children.indexOf(filter);
		if (i >= 0) this.additive_filter.children.splice(i, 1);
	}

	toJSON(): ViewFaceJSON {
		return {
			id: this.id,
			type: this.type,
			name: this.name,
			display_field_ids: this.display_field_ids,
			additive_filter: this.additive_filter,
			sort: this.sort,
			config: this.config,
			body: this.body ? this.body.toJSON() : null
		};
	}
}

// ── Fields ────────────────────────────────────────────────────────────

/**
 * Okay so hmm so
 *
 * Views have really two kinds of fields, and many types of fields
 * The kinds are mapped fields (to an existing attribute of the document), and per doc stateful
 * fields that add a property to every document
 *
 * Mapped: tags, file path, created at, any derivatives of these through a formula / calculation
 * Per doc stateful: due date, done status, priority, etc.
 *
 * Making this work between faces is going to be annoying as balls but whatever
 *
 * Have to think about sorting I suppose too
 *
 */

// built-ins: derived (mapped) from existing document attributes

const BUILTIN_FIELD_TYPES = [
	'title',
	'id',
	'tags',
	'folder',
	'created_at',
	'updated_at'
] as const;

// idk probably some more this seems fine for now
export type ViewFieldType =
	| 'date'
	| 'text'
	| 'number'
	| 'boolean'
	| 'select'
	| 'multiselect' // might prune
	| (typeof BUILTIN_FIELD_TYPES)[number];

// user-creatable stateful field types (e.g. due-date, etc.)
export const CREATABLE_FIELD_TYPES = [
	'text',
	'number',
	'date',
	'boolean',
	'select',
	'multiselect'
] as const;

// does this add a prop to documents? If not it is derived (mapped)
export function isDerived(type: ViewFieldType): boolean {
	return (BUILTIN_FIELD_TYPES as readonly string[]).includes(type);
}

// ── Built-in units ───────────────────────────────────────────────────────────────────

/**
 * Units whose definition comes from code. Their fields are overlaid onto every view at load
 * and never persisted, so changing the registry changes every view at once
 */

export interface BuiltinUnit {
	unit: string;
	emoji: string;
	fields: ViewField[];
	display: string[];
}

function builtinField(unit: string, name: string, type: ViewFieldType): ViewField {
	return { id: `${unit}/${name}`, name, type, config: {}, unit };
}

const TODO = 'tag:todo';

export const BUILTIN_UNITS: Record<string, BuiltinUnit> = {
	[TODO]: {
		unit: TODO,
		emoji: '✓',
		fields: [
			builtinField(TODO, 'done', 'boolean'),
			builtinField(TODO, 'due', 'date'),
			builtinField(TODO, 'scheduled', 'date')
		],
		display: [`${TODO}/done`, `${TODO}/due`, `${TODO}/scheduled`]
	}
};

const BUILTIN_FIELD_IDS = new Set(
	Object.values(BUILTIN_UNITS).flatMap((u) => u.fields.map((f) => f.id))
);

// fresh copies: views hold their fields in $state and write config in place
function builtinFields(): ViewField[] {
	return Object.values(BUILTIN_UNITS).flatMap((u) =>
		u.fields.map((f) => ({ ...f, config: { ...f.config } }))
	);
}

export function isBuiltinUnit(unitId: string): boolean {
	return unitId in BUILTIN_UNITS;
}

export function isBuiltinField(field: Pick<ViewField, 'id'>): boolean {
	return BUILTIN_FIELD_IDS.has(field.id);
}

// derived and registry fields can't be renamed, retyped or removed
export function isLockedField(field: ViewField): boolean {
	return isDerived(field.type) || isBuiltinField(field);
}

export interface ViewField {
	id: string; // uuid
	name: string; // all lowercase, alphanumeric, '-' and '_'
	type: ViewFieldType;
	config: Record<string, any>; // field specific config, e.g. mappings & formulas
	unit?: string; // owning unit; its values live under views.<unitPropKey(unit)>.<name>
	// todo: think about adding 'locked' bool for UX
}

function createViewField(
	name: string,
	type: ViewFieldType,
	config: Record<string, any> = {},
	unit?: string
): ViewField {
	return {
		id: uuidv4(),
		name,
		type,
		config,
		...(unit ? { unit } : {})
	};
}

export function fieldKey(field: ViewField): string {
	if (!field.unit) throw new Error(`Stateful field '${field.name}' has no owning unit`);
	return unitPropKey(field.unit);
}

// ── Filters ──────────────────────────────────────────────────────────────────────────

/**
 * so, filters, scope some may say
 *
 * how does one define what a view contains? It's a subset of the global environment, of course
 * so all views can be defined as a filtered set of such
 *
 * uh
 * thinking a simple filters attribute, with is an array of maybe a Filter interface? Needs to
 * serialize nicely.
 *
 * like
 * [
 * { "filter": "group_membership", "op": "in", "value": ["<group-uuid>"] },
 * { "filter": "group_membership", "op": "not_in", "value": ["group-uuid>"] },
 * ]
 *
 * this is kind of verbose though
 *1
 * probably select some groups and such, then some filters like 'done' 'neq' to 'true'
 * so hmm huhg hmm mm, okay will need some ops and types, kind of seems like it intersects with
 * fields
 *
 * view-field <=> view-filter
 *
 * hmm need and or chaining
 *
 * so do I just do a full predicate tree or something like a match 2-layer tree
 *
 * {
 * 	"match": any,
 * 	clauses: [
 *    { "field": "status", "op": "neq", "value": "done" },
 *    { "field": "due", "op": "before", "value": "today" }
 *    { "group_membership" ... }
 * 	]
 * }
 *
 * something like this for 2-layer if I don't want predicate tree, though I'm starting to lean that
 * way -- this does cover 95%+ use cases but why not just make something that covers everything?
 *
 * so something like
 *
 * {
 *   "and": [
 *     { "field": "groups", "op": "in", "value": [<group-uuid>] },
 *     { "field": "done", "op": "eq", "value": false }
 *     {
 *         "or": [
 *           { "field": "priority", "op": "eq", "value": "high" },
 *           { "field": "due", "op": "before", "value": "today" }
 *         ]
 *       }
 *   ]
 * }
 *
 * I can reasonably parse this to sql, thinking if I want an intermediate form though. I think I do
 * for displaying in the UI, and it also makes updating the SQL parser simpler.
 *
 * So what does that intermediate form look like? Uh
 *
 * so first, { "field": new Field(...)} or { "field": <field-uuid> } ; ui will show the field name
 * ;;;;;;;;; this does not really need an intermediate layer, it can just be interpreted directly
 * by the component as it maps pretty well to the UI
 *
 * ;;;;;;;;;;;;;;; but ;;;;;;;;;;;;;;;;
 * there is a more subtle issue here, what if I want a column in a table to display the tags on each
 * document? It renders similarly to multiselect, but has a definite datasource and removing a tag
 * has a different consequence than a simple view-local multiselect (which I might not really need,
 * considering)
 *
 * so where do these intrinsic fields live? Where are they defined? How do they relate to filters?
 * Well, they don't relate to filters because they're just a display artifact -- the thing they are
 * displaying can of course be used in filters though, the doc metadata
 *
 * probably just going to stuff them all in ViewFieldType & VIEW_FIELD_OPS
 */

export const VIEW_FIELD_OPS: Record<ViewFieldType, string[]> = {
	text: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'is_empty', 'is_not_empty'],
	number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
	date: ['eq', 'neq', 'before', 'on_or_before', 'after', 'on_or_after', 'is_empty', 'is_not_empty'],
	boolean: ['eq'],
	select: ['eq', 'neq', 'any_of', 'is_empty', 'is_not_empty'],
	multiselect: ['contains', 'not_contains', 'has_all', 'is_empty', 'is_not_empty'], // might prune multiselect
	// BUILT-INS
	title: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'is_empty', 'is_not_empty'],
	id: ['eq', 'neq'],
	tags: ['has_any', 'has_all', 'has_none'],
	folder: ['in', 'not_in', 'contains', 'not_contains', 'starts_with'],
	created_at: ['before', 'on_or_before', 'after', 'on_or_after'],
	updated_at: ['before', 'on_or_before', 'after', 'on_or_after']
};

export type FilterNode = FilterCompound | FilterLeaf;

export interface FilterCompound {
	op: 'and' | 'or';
	children: FilterNode[];
}

export interface FilterLeaf {
	field_id: string;
	op: string;
	value: unknown;
}

// ── Sort ─────────────────────────────────────────────────────────────────────────────

export const VIEW_FIELD_SORTABLE: ReadonlySet<ViewFieldType> = new Set([
	'date',
	'text',
	'number',
	'boolean',
	'select',
	'title',
	'id',
	'folder',
	'created_at',
	'updated_at'
]);

export interface SortKey {
	field_id: string;
	direction: 'asc' | 'desc';
	nulls?: 'first' | 'last';
}

// ── SQL Compilation ──────────────────────────────────────────────────────────────────

interface CompiledFilter {
	sql: string;
	params: unknown[];
}

const UNSAFE_IDENT = /["'\\]|\p{Cc}/u;

function isValidName(s: string): boolean {
	return s !== '' && !UNSAFE_IDENT.test(s);
}

function pathSeg(s: string, kind: string): string {
	if (!isValidName(s)) throw new Error(`Unsafe ${kind}: ${s}`);
	return s;
}

export function sanitizeName(raw: string): string {
	return raw
		.replace(/["'\\]/g, '')
		.replace(/\p{Cc}/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function resolveColumn(field: ViewField): string {
	switch (field.type) {
		case 'id':
			return 'd.id';
		case 'title':
			return 'd.title';
		case 'folder':
			return 'd.rel_path';
		case 'created_at':
			return 'd.created_at';
		case 'updated_at':
			return 'd.updated_at';
		case 'tags':
			throw new Error(`tags field has no scalar column; handle separately`);
		default:
			return `json_extract(d.properties, '$.views."${pathSeg(fieldKey(field), 'unit key')}"."${pathSeg(field.name, 'field name')}"')`;
	}
}

/**
 * A unit view is 1:1 with an organization unit; a source is its root folder. The unit id both
 * scopes the view and names the frontmatter namespace its stateful props live under: tags key on
 * their bare slug, folders on their source-relative path wrapped in slashes (root is "/"). A tag
 * never ends with a slash and is never only slashes, so the two can't collide
 */
export function unitPropKey(unitId: string): string {
	if (unitId.startsWith('tag:')) return unitId.slice('tag:'.length);
	return folderPropKey(folderIdPath(unitId));
}

export function folderPropKey(path: string): string {
	return path ? `/${path}/` : '/';
}

function compileUnit(unitId: string): CompiledFilter {
	return unitId.startsWith('tag:')
		? compileTagsLeaf('has_any', [unitId])
		: compileFolderLeaf('in', unitId);
}

function compileFolderLeaf(op: string, value: unknown): CompiledFilter {
	// text ops match the location as written; membership ops take a folder id
	switch (op) {
		case 'contains':
			return { sql: `d.rel_path LIKE '%' || ? || '%'`, params: [value] };
		case 'not_contains':
			return { sql: `d.rel_path NOT LIKE '%' || ? || '%'`, params: [value] };
		case 'starts_with':
			return { sql: `d.rel_path LIKE ? || '%'`, params: [value] };
	}
	// a folder id carries its path, so a subtree is an id range. A child extends its parent
	// with '/' (0x2F), whose successor is '0' (0x30); the source root has no separator before
	// its children, so its bound comes from the successor of its trailing ':' (0x3A)
	const id = String(value);
	const upper = isSourceRoot(id) ? `${id.slice(0, -1)};` : `${id}0`;
	const inFolder = {
		sql: `(d.folder_id IS NOT NULL AND d.folder_id >= ? AND d.folder_id < ?)`,
		params: [id, upper]
	};
	switch (op) {
		case 'in':
			return inFolder;
		case 'not_in':
			return { sql: `NOT ${inFolder.sql}`, params: inFolder.params };
		default:
			throw new Error(`Unsupported op '${op}' for folder`);
	}
}

function compileTagsLeaf(op: string, value: unknown): CompiledFilter {
	const ids = Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
	if (ids.length === 0) {
		if (op === 'has_any') return { sql: '0', params: [] };
		return { sql: '1', params: [] };
	}
	const placeholders = ids.map(() => '?').join(', ');
	const anyExists = `EXISTS (SELECT 1 FROM document_tags dt WHERE dt.document_id = d.id AND dt.tag_id IN (${placeholders}))`;
	switch (op) {
		case 'has_any':
			return { sql: anyExists, params: [...ids] };
		case 'has_none':
			return { sql: `NOT ${anyExists}`, params: [...ids] };
		case 'has_all':
			return {
				sql: `(SELECT COUNT(DISTINCT dt.tag_id) FROM document_tags dt WHERE dt.document_id = d.id AND dt.tag_id IN (${placeholders})) = ?`,
				params: [...ids, ids.length]
			};
		default:
			throw new Error(`Unsupported op '${op}' for tags`);
	}
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function nextDay(dateOnly: string): string {
	const m = dateOnly.match(DATE_ONLY_RE);
	if (!m) return dateOnly;
	const dt = new Date(+m[1], +m[2] - 1, +m[3]);
	dt.setDate(dt.getDate() + 1);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// A bare YYYY-MM-DD bound spans the whole day, [start, nextDay)
function compileDateOnlyLeaf(
	field: ViewField,
	op: string,
	dateOnly: string,
	expr: string
): CompiledFilter | null {
	const numeric = field.type === 'created_at' || field.type === 'updated_at';
	const lo = numeric ? wallClockToMs(dateOnly) : dateOnly;
	const hi = numeric ? wallClockToMs(nextDay(dateOnly)) : nextDay(dateOnly);
	if (lo === null || hi === null) return null;
	switch (op) {
		case 'before':
			return { sql: `${expr} < ?`, params: [lo] };
		case 'on_or_before':
			return { sql: `${expr} < ?`, params: [hi] };
		case 'after':
			return { sql: `${expr} >= ?`, params: [hi] };
		case 'on_or_after':
			return { sql: `${expr} >= ?`, params: [lo] };
		case 'eq':
			return { sql: `(${expr} >= ? AND ${expr} < ?)`, params: [lo, hi] };
		case 'neq':
			return { sql: `(${expr} < ? OR ${expr} >= ?)`, params: [lo, hi] };
		default:
			return null;
	}
}

function compileLeafSql(field: ViewField, op: string, value: unknown): CompiledFilter {
	if (field.type === 'folder') return compileFolderLeaf(op, value);
	if (field.type === 'tags') return compileTagsLeaf(op, value);

	const expr = resolveColumn(field);

	const dateLike =
		field.type === 'date' || field.type === 'created_at' || field.type === 'updated_at';
	if (dateLike) value = resolveRelativeDate(value) ?? value;
	if (dateLike && typeof value === 'string' && DATE_ONLY_RE.test(value)) {
		const compiled = compileDateOnlyLeaf(field, op, value, expr);
		if (compiled) return compiled;
	}

	if (field.type === 'created_at' || field.type === 'updated_at') {
		value = wallClockToMs(value) ?? value;
	}

	// Booleans: an unset prop (NULL) reads as false
	if (field.type === 'boolean' && op === 'eq') {
		const truthy = value === true || value === 'true';
		return truthy
			? { sql: `${expr} = 1`, params: [] }
			: { sql: `(${expr} IS NULL OR ${expr} = 0)`, params: [] };
	}

	// any of list
	if (op === 'any_of') {
		const vals = (Array.isArray(value) ? value : []).filter((v) => typeof v === 'string');
		if (vals.length === 0) return { sql: '1', params: [] };
		const ph = vals.map(() => '?').join(', ');
		return { sql: `${expr} IN (${ph})`, params: vals };
	}

	// all of list
	if (op === 'has_all') {
		const vals = (Array.isArray(value) ? value : []).filter((v) => typeof v === 'string');
		if (vals.length === 0) return { sql: '1', params: [] };
		const ph = vals.map(() => '?').join(', ');
		return {
			sql: `(SELECT COUNT(DISTINCT value) FROM json_each(${expr}) WHERE value IN (${ph})) = ?`,
			params: [...vals, vals.length]
		};
	}

	// good lord
	switch (op) {
		case 'eq':
			return { sql: `${expr} = ?`, params: [value] };
		case 'neq':
			return { sql: `${expr} <> ?`, params: [value] };
		case 'gt':
			return { sql: `${expr} > ?`, params: [value] };
		case 'gte':
			return { sql: `${expr} >= ?`, params: [value] };
		case 'lt':
			return { sql: `${expr} < ?`, params: [value] };
		case 'lte':
			return { sql: `${expr} <= ?`, params: [value] };
		case 'before':
			return { sql: `${expr} < ?`, params: [value] };
		case 'on_or_before':
			return { sql: `${expr} <= ?`, params: [value] };
		case 'after':
			return { sql: `${expr} > ?`, params: [value] };
		case 'on_or_after':
			return { sql: `${expr} >= ?`, params: [value] };
		case 'starts_with':
			return { sql: `${expr} LIKE ? || '%'`, params: [value] };
		case 'contains':
			if (field.type === 'multiselect') {
				return {
					sql: `EXISTS (SELECT 1 FROM json_each(${expr}) WHERE value = ?)`,
					params: [value]
				};
			}
			return { sql: `${expr} LIKE '%' || ? || '%'`, params: [value] };
		case 'not_contains':
			if (field.type === 'multiselect') {
				return {
					sql: `NOT EXISTS (SELECT 1 FROM json_each(${expr}) WHERE value = ?)`,
					params: [value]
				};
			}
			return { sql: `${expr} NOT LIKE '%' || ? || '%'`, params: [value] };
		case 'is_empty':
			if (field.type === 'text' || field.type === 'title') {
				return { sql: `(${expr} IS NULL OR ${expr} = '')`, params: [] };
			}
			if (field.type === 'multiselect') {
				return { sql: `(${expr} IS NULL OR json_array_length(${expr}) = 0)`, params: [] };
			}
			return { sql: `${expr} IS NULL`, params: [] };
		case 'is_not_empty':
			if (field.type === 'text' || field.type === 'title') {
				return { sql: `(${expr} IS NOT NULL AND ${expr} <> '')`, params: [] };
			}
			if (field.type === 'multiselect') {
				return { sql: `(${expr} IS NOT NULL AND json_array_length(${expr}) > 0)`, params: [] };
			}
			return { sql: `${expr} IS NOT NULL`, params: [] };
		default:
			throw new Error(`Unsupported op '${op}' for type '${field.type}'`);
	}
}

// a pred leaf only constrains results once it has not null val
export function isLeafActive(op: string, value: unknown): boolean {
	if (op === 'is_empty' || op === 'is_not_empty') return true;
	if (value === null || value === undefined) return false;
	if (typeof value === 'string') return value !== '';
	if (Array.isArray(value)) return value.length > 0;
	return true;
}

function compileNode(node: FilterNode, fieldsById: Map<string, ViewField>): CompiledFilter {
	if ('children' in node) {
		const compiled = node.children
			.map((c) => compileNode(c, fieldsById))
			.filter((c) => c.sql !== '');
		if (compiled.length === 0) return { sql: '', params: [] };
		const joiner = node.op === 'and' ? ' AND ' : ' OR ';
		return {
			sql: '(' + compiled.map((c) => c.sql).join(joiner) + ')',
			params: compiled.flatMap((c) => c.params)
		};
	}
	if (!isLeafActive(node.op, node.value)) return { sql: '', params: [] };
	const field = fieldsById.get(node.field_id);
	if (!field) throw new Error(`Unknown field_id: ${node.field_id}`);
	return compileLeafSql(field, node.op, node.value);
}

function pruneFieldFromFilter(node: FilterCompound, fieldId: string): void {
	node.children = node.children.filter((c) => 'children' in c || c.field_id !== fieldId);
	for (const child of node.children) {
		if ('children' in child) pruneFieldFromFilter(child, fieldId);
	}
}

function compileFilter(filter: FilterNode | null, fields: ViewField[]): CompiledFilter {
	if (!filter) return { sql: '', params: [] };
	const fieldsById = new Map(fields.map((f) => [f.id, f]));
	return compileNode(filter, fieldsById);
}

function compileSort(sort: SortKey[], fields: ViewField[]): string {
	const fieldsById = new Map(fields.map((f) => [f.id, f]));
	const terms: string[] = [];
	for (const key of sort) {
		const field = fieldsById.get(key.field_id);
		if (!field || !VIEW_FIELD_SORTABLE.has(field.type)) continue;
		const expr = resolveColumn(field);
		const dir = key.direction === 'desc' ? 'DESC' : 'ASC';
		const nulls = key.nulls === 'first' ? 'NULLS FIRST' : 'NULLS LAST';
		terms.push(`${expr} ${dir} ${nulls}`);
	}
	return terms.join(', ');
}

// ── View Model ───────────────────────────────────────────────────────────────────────

function memberFilter(
	base: FilterCompound,
	face?: ViewFace,
	scope?: FilterNode | null
): FilterNode {
	const children: FilterNode[] = [base];
	if (face) children.push(face.additive_filter);
	if (scope) children.push(scope);
	return children.length === 1 ? base : { op: 'and', children };
}

export interface MemberRow {
	id: string;
	title: string;
	rel_path: string;
	created_at: number;
	updated_at: number;
	properties: string;
	source_id: string;
}

interface ViewJSON {
	id: string;
	slug: string;
	unit?: string | null;
	created_at: Date;
	updated_at: Date;
	fields: ViewField[];
	filter: FilterCompound;
	faces: ViewFaceJSON[];
	state: Record<string, any>;
	temporary?: boolean;
	emoji?: string;
	cover?: string;
	accessed_at?: Date;
}

// ── Saved views store (views.json) ───────────────────────────────────────────────────

const VIEWS_VERSION = 1;

let viewStore: Store | null = null;
async function getViewStore(): Promise<Store> {
	if (!viewStore) {
		viewStore = await load('views.json');
		if ((await viewStore.get<number>('version')) !== VIEWS_VERSION) {
			await viewStore.set('version', VIEWS_VERSION);
			await viewStore.save();
		}
	}
	return viewStore;
}

export async function listSavedViewJSON(): Promise<ViewJSON[]> {
	const s = await getViewStore();
	return (await s.get<ViewJSON[]>('views')) ?? [];
}

export async function saveViewJSON(json: ViewJSON): Promise<void> {
	const s = await getViewStore();
	const all = (await s.get<ViewJSON[]>('views')) ?? [];
	const idx = all.findIndex((v) => v.id === json.id);
	if (idx >= 0) all[idx] = json;
	else all.push(json);
	await s.set('views', all);
	await s.save();
}

export async function deleteSavedView(id: string): Promise<void> {
	const s = await getViewStore();
	const all = (await s.get<ViewJSON[]>('views')) ?? [];
	await s.set(
		'views',
		all.filter((v) => v.id !== id)
	);
	await s.save();
}

export async function isViewSaved(id: string): Promise<boolean> {
	return (await listSavedViewJSON()).some((v) => v.id === id);
}

export async function remapIdsInSavedViews(
	oldId: string,
	newId: string,
	subpaths = false
): Promise<void> {
	const remap = (v: unknown): unknown => {
		if (typeof v === 'string') {
			if (v === oldId) return newId;
			if (subpaths && v.startsWith(oldId + '/')) return newId + v.slice(oldId.length);
			return v;
		}
		if (Array.isArray(v)) return v.map(remap);
		if (v && typeof v === 'object') {
			return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, remap(val)]));
		}
		return v;
	};
	const s = await getViewStore();
	const all = (await s.get<ViewJSON[]>('views')) ?? [];
	await s.set('views', remap(all));
	await s.save();
}

class View {
	id: string; // uuid
	slug: string = $state(''); // display label; for a unit view it is refreshed from the unit on open
	unit: string | null = $state(null); // tag or folder id when this is a unit view
	createdAt: Date;
	updatedAt: Date = $state(new Date());
	fields: ViewField[] = $state([]);
	filter: FilterCompound = $state({ op: 'and', children: [] });
	faces: ViewFace[] = $state([]);
	state: Record<string, any> = $state({});
	temporary: boolean = $state(false);
	emoji: string = $state(''); // user-set per-view emoji
	cover: string = $state('');
	accessedAt: Date = $state(new Date());
	private pristine = '';

	constructor(json: ViewJSON) {
		this.id = json.id;
		this.slug = json.slug;
		this.unit = json.unit ?? null;
		this.createdAt = json.created_at;
		this.updatedAt = json.updated_at;
		this.setOwnFields(
			json.fields.map((f) =>
				this.unit && !isDerived(f.type) && !f.unit ? { ...f, unit: this.unit } : f
			)
		);
		this.filter = json.filter;
		this.faces = json.faces.map((j) => new ViewFace(j));
		this.state = json.state ?? {};
		this.temporary = json.temporary ?? false;
		this.emoji = json.emoji ?? '';
		this.cover = json.cover ?? '';
		this.accessedAt = json.accessed_at ?? json.updated_at;
		// a stateful field with no home has nowhere to read or write; drop it and its uses
		for (const f of this.fields.filter((f) => !isDerived(f.type) && !f.unit))
			this.removeField(f.id);
		this.markPristine();
	}

	private snapshot(): string {
		return JSON.stringify({
			slug: this.slug,
			fields: this.ownFields,
			filter: this.filter,
			faces: this.faces
		});
	}

	markPristine(): void {
		this.pristine = this.snapshot();
	}

	get isDirty(): boolean {
		return this.snapshot() !== this.pristine;
	}

	revert(): void {
		if (!this.pristine) return;
		const snap = JSON.parse(this.pristine);
		this.slug = snap.slug;
		this.setOwnFields(snap.fields);
		this.filter = snap.filter;
		this.faces = snap.faces.map((j: ViewFaceJSON) => new ViewFace(j));
	}

	static create(slug: string): View {
		const view = new View({
			id: uuidv4(),
			slug,
			created_at: new Date(),
			updated_at: new Date(),
			fields: [],
			filter: {
				op: 'and',
				children: []
			},
			faces: [], // probably want default
			state: {}
		});
		view.initDefaultFields();
		view.initDefaultFaces();
		view.markPristine();
		return view;
	}

	static createForUnit(unitId: string, name: string): View {
		const view = View.create(name);
		view.unit = unitId;
		view.temporary = true;
		const builtin = BUILTIN_UNITS[unitId];
		if (builtin) {
			view.emoji = builtin.emoji;
			const title = view.fields.find((f) => f.type === 'title')!.id;
			const [done, ...rest] = builtin.display;
			view.faces = [ViewFace.create('table', [done, title, ...rest])];
		}
		view.markPristine();
		return view;
	}

	static createFromUnit(unit: Tag | Folder): View {
		return View.createForUnit(unit.id, unit.slug);
	}

	static createFromSource(source: Source): View {
		return View.createForUnit(folderId(source.id, ''), sourceName(source));
	}

	/** The saved view for this unit if there is one, else a fresh temporary one */
	static async forUnit(unitId: string, name: string): Promise<View> {
		const saved = (await listSavedViewJSON()).find((v) => v.unit === unitId);
		return saved ? new View({ ...saved, slug: name }) : View.createForUnit(unitId, name);
	}

	private initDefaultFields(): void {
		this.fields = [...BUILTIN_FIELD_TYPES.map((t) => createViewField(t, t)), ...builtinFields()];
	}

	// fields this view defines, i.e. everything but the registry overlay
	get ownFields(): ViewField[] {
		return this.fields.filter((f) => !isBuiltinField(f));
	}

	setOwnFields(fields: ViewField[]): void {
		this.fields = [...fields.filter((f) => !isBuiltinField(f)), ...builtinFields()];
	}

	private initDefaultFaces(): void {
		this.faces = [ViewFace.create('grid', this.defaultFaceFieldIds())];
	}

	private defaultFaceFieldIds(): string[] {
		const wanted: ViewFieldType[] = ['title', 'folder', 'tags', 'updated_at'];
		return wanted
			.map((t) => this.fields.find((f) => f.type === t)?.id)
			.filter((id): id is string => !!id);
	}

	// add a fresh face with the default columns, return it
	addFace(type: ViewFaceType = 'table'): ViewFace {
		const face = ViewFace.create(type, this.defaultFaceFieldIds());
		this.faces = [...this.faces, face];
		return face;
	}

	// swap a compound face's body
	setFaceBody(face: ViewFace, type: ViewFaceType): void {
		face.body = ViewFace.create(type, this.defaultFaceFieldIds());
	}

	// copy an existing face (columns, filters, sort, config) under a new id
	duplicateFace(id: string): ViewFace | undefined {
		const src = this.faces.find((f) => f.id === id);
		if (!src) return undefined;
		const json = src.toJSON();
		const face = new ViewFace({
			...json,
			id: uuidv4(),
			name: src.name ? `${src.name} copy` : '',
			display_field_ids: [...json.display_field_ids],
			sort: [...json.sort],
			additive_filter: JSON.parse(JSON.stringify(json.additive_filter)),
			config: JSON.parse(JSON.stringify(json.config)),
			// regen ids for dupe
			body: json.body ? { ...JSON.parse(JSON.stringify(json.body)), id: uuidv4() } : null
		});
		this.faces = [...this.faces, face];
		return face;
	}

	removeFace(id: string): void {
		if (this.faces.length <= 1) return;
		this.faces = this.faces.filter((f) => f.id !== id);
	}

	addField(field: ViewField) {
		this.fields.push(field);
	}

	removeField(fieldId: string) {
		if (isBuiltinField({ id: fieldId })) return;
		this.fields = this.fields.filter((f) => f.id !== fieldId);
		pruneFieldFromFilter(this.filter, fieldId);
		for (const face of this.faces) {
			for (const f of [face, face.body]) {
				if (!f) continue;
				f.display_field_ids = f.display_field_ids.filter((id) => id !== fieldId);
				pruneFieldFromFilter(f.additive_filter, fieldId);
				f.sort = f.sort.filter((k) => k.field_id !== fieldId);
				if (f.config.group_by === fieldId) delete f.config.group_by;
				// A journal keyed on a deleted date field would lose its day scope entirely
				if (f.config.date_field === fieldId) delete f.config.date_field;
				if (f.config.column_widths) delete f.config.column_widths[fieldId];
			}
		}
	}

	/**
	 * Create a new field of the given type with a unique default name, append it
	 * to the view's fields, and return it. Caller decides display placement.
	 */
	addFieldOfType(type: ViewFieldType): ViewField {
		if (!this.unit) throw new Error('Only unit views can own stateful fields');
		const taken = new Set(this.fields.map((f) => f.name));
		let name: string = type;
		let n = 2;
		while (taken.has(name)) name = `${type}_${n++}`;
		const field = createViewField(name, type, {}, this.unit);
		this.fields.push(field);
		return field;
	}

	/**
	 * Adds a simple filter to the outer 'and' compound predicate
	 */
	addBasicFilter(filter: FilterLeaf) {
		this.filter.children.push(filter);
	}

	/**
	 * Two views can't share a unit, so a copy gives up the unit and keeps its members as an ordinary
	 * filter instead. Stateful fields stay with the unit
	 */
	detachUnit(): void {
		const unitId = this.unit;
		if (!unitId) return;
		for (const f of this.ownFields.filter((f) => !isDerived(f.type))) this.removeField(f.id);
		const isTag = unitId.startsWith('tag:');
		const type: ViewFieldType = isTag ? 'tags' : 'folder';
		let field = this.fields.find((f) => f.type === type);
		if (!field) {
			field = createViewField(type, type);
			this.fields.push(field);
		}
		this.addBasicFilter({
			field_id: field.id,
			op: isTag ? 'has_any' : 'in',
			value: isTag ? [unitId] : unitId
		});
		this.unit = null;
	}

	/** Persist this view to views.json and mark it as a saved (non-temporary) view. */
	async save() {
		this.temporary = false;
		await saveViewJSON(this.toJSON());
	}

	async touchAccessed() {
		if (this.temporary) return;
		this.accessedAt = new Date();
		await saveViewJSON(this.toJSON());
	}

	/** Remove this view from views.json; it becomes a temporary view again. */
	async unsave() {
		this.temporary = true;
		await deleteSavedView(this.id);
	}

	static async listSaved(): Promise<View[]> {
		return (await listSavedViewJSON()).map((j) => new View(j));
	}

	toJSON(): ViewJSON {
		return {
			id: this.id,
			slug: this.slug,
			unit: this.unit,
			created_at: this.createdAt,
			updated_at: this.updatedAt,
			fields: this.ownFields,
			filter: this.filter,
			faces: this.faces,
			state: this.state,
			temporary: this.temporary,
			emoji: this.emoji,
			cover: this.cover,
			accessed_at: this.accessedAt
		};
	}

	// `scope` is an extra, non-persisted predicate from whoever is rendering the face
	// (a journal scoping its body to the selected day)
	// The unit scope is implicit and always applies; view and face filters are additive on top
	private compileScope(opts?: { face?: ViewFace; scope?: FilterNode | null }): CompiledFilter {
		const compiled = compileFilter(memberFilter(this.filter, opts?.face, opts?.scope), this.fields);
		if (!this.unit) return compiled;
		const unit = compileUnit(this.unit);
		if (!compiled.sql) return unit;
		return {
			sql: `(${unit.sql} AND ${compiled.sql})`,
			params: [...unit.params, ...compiled.params]
		};
	}

	async getMembers(opts?: {
		face?: ViewFace;
		scope?: FilterNode | null;
		limit?: number;
		offset?: number;
		ids_in?: string[];
	}): Promise<MemberRow[]> {
		const compiled = this.compileScope(opts);
		const params = [...compiled.params];

		const idsIn = opts?.ids_in;
		let idsClause = '';
		if (idsIn !== undefined) {
			if (idsIn.length === 0) return [];
			idsClause = ` AND d.id IN (${idsIn.map(() => '?').join(', ')})`;
			params.push(...idsIn);
		}

		const sort = opts?.face?.sort ?? [];
		const orderBy = sort.length ? compileSort(sort, this.fields) : '';

		let sql = `SELECT d.id, d.title, d.rel_path, d.created_at, d.updated_at, d.properties, d.source_id
			FROM documents d
			WHERE d.deleted_at IS NULL${compiled.sql ? ` AND ${compiled.sql}` : ''}${idsClause}`;

		if (!idsIn) {
			sql += ` ORDER BY ${orderBy || 'd.updated_at DESC'}`;
		}

		if (opts?.limit !== undefined) {
			sql += ' LIMIT ?';
			params.push(opts.limit);
		}
		if (opts?.offset !== undefined) {
			sql += ' OFFSET ?';
			params.push(opts.offset);
		}

		return select<MemberRow>(sql, params);
	}

	// This face's scope (view filter + face filter + any extra scope) as compiled SQL
	searchScope(opts?: { face?: ViewFace; scope?: FilterNode | null }): {
		sql: string;
		params: unknown[];
	} {
		const compiled = this.compileScope(opts);
		return { sql: compiled.sql, params: [...compiled.params] };
	}

	// total matching members
	async countMembers(opts?: { face?: ViewFace; scope?: FilterNode | null }): Promise<number> {
		const compiled = this.compileScope(opts);
		const sql = `SELECT COUNT(*) AS n
			FROM documents d
			WHERE d.deleted_at IS NULL${compiled.sql ? ` AND ${compiled.sql}` : ''}`;
		const [row] = await select<{ n: number }>(sql, [...compiled.params]);
		return row?.n ?? 0;
	}

	// ── Brain Damaging Ops (multi-doc) ──────────────────────────────────────────────────

	renameSlug(newSlug: string): void {
		if (this.unit || !isValidName(newSlug)) return;
		this.slug = newSlug;
	}

	/** Rename a stateful field, moving its stored values to the new key, then update the model */
	async renameField(field: ViewField, newName: string): Promise<void> {
		const oldName = field.name;
		if (isBuiltinField(field) || !isValidName(newName) || newName === oldName) return;
		this.fields = this.fields.map((f) => (f.id === field.id ? { ...f, name: newName } : f));
		await bulkPerSource('bulk_rename_view_field', { viewSlug: fieldKey(field), oldName, newName });
	}

	/** Rename a select/multiselect option value across all stored documents */
	async renameOption(field: ViewField, oldValue: string, newValue: string): Promise<void> {
		if (isBuiltinField(field)) return;
		await bulkPerSource('bulk_rename_view_option', {
			viewSlug: fieldKey(field),
			fieldName: field.name,
			oldValue,
			newValue
		});
	}

	/** Write a stateful field value onto the given documents in a source */
	async writeFieldValue(
		sourceId: string,
		field: ViewField,
		value: unknown,
		docIds: string[]
	): Promise<BulkResult> {
		return await invoke<BulkResult>('bulk_set_view_field', {
			sourceId,
			viewSlug: fieldKey(field),
			fieldName: field.name,
			value,
			docIds
		});
	}
}

export interface BulkFailure {
	rel_path: string;
	kind: string;
}

export interface BulkResult {
	touched: number;
	failed: number;
	failures: BulkFailure[];
	source_unreachable: boolean;
}

export function describeBulkFailure(r: BulkResult): string {
	if (r.source_unreachable) {
		return "Couldn't save changes: the source folder is unavailable. Check that the drive or folder is connected.";
	}
	const n = r.failed;
	const noun: 'notes' | 'note' = n === 1 ? 'note' : 'notes';
	switch (r.failures[0]?.kind) {
		case 'permission':
			return `${n} ${noun} couldn't be saved: they're read-only or you don't have permission.`;
		case 'not_found':
			return `${n} ${noun} couldn't be found: they may have moved, been deleted, or not yet downloaded from your sync app.`;
		case 'no_space':
			return "Couldn't save changes: your disk is out of space.";
		case 'invalid_data':
			return `${n} ${noun} couldn't be read: their content couldn't be parsed.`;
		case 'locked':
			return `${n} ${noun} are in use by another app. Close them and retry.`;
		default:
			return `${n} ${noun} couldn't be saved.`;
	}
}

/** Move every `views.<oldPrefix>*` namespace to `<newPrefix>*`, e.g. when a folder is renamed */
export async function renameUnitViewPrefix(oldPrefix: string, newPrefix: string): Promise<void> {
	if (oldPrefix === newPrefix) return;
	await bulkPerSource('bulk_rename_view_prefix', { oldPrefix, newPrefix });
}

export async function bulkPerSource(
	cmd: string,
	args: Record<string, unknown>,
	opts: { frontmatterOnly?: boolean; silent?: boolean } = {}
): Promise<{ source: Source; result: BulkResult }[]> {
	const sources = (await listSources()).filter((s) => !opts.frontmatterOnly || s.use_frontmatter);
	const results: { source: Source; result: BulkResult }[] = [];
	for (const s of sources) {
		results.push({ source: s, result: await invoke<BulkResult>(cmd, { sourceId: s.id, ...args }) });
	}
	if (!opts.silent) toastBulkFailures(results.map((r) => r.result));
	return results;
}

export function toastBulkFailures(results: BulkResult[]): void {
	const failed = results.reduce((n, r) => n + r.failed, 0);
	const source_unreachable = results.some((r) => r.source_unreachable);
	if (failed === 0 && !source_unreachable) return;
	toasts.push(
		describeBulkFailure({
			touched: results.reduce((n, r) => n + r.touched, 0),
			failed,
			failures: results.flatMap((r) => r.failures),
			source_unreachable
		})
	);
}

export default View;
