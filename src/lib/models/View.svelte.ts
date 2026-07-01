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
import Group, { GroupType } from '$lib/models/Group';
import { getSource, listSources, sourceName, type Source } from '$lib/models/Source';
import { select } from '$lib/db';
import { saveViewJSON, deleteSavedView, listSavedViewJSON } from '$lib/models/savedViews';

/**
 * okay so a Face instance is 1:1 with a view-component, e.g. table, kanban etc.
 * todo: some sort of registry or something, so you can select amongst them in the UI and also
 * to have it mapped correctly when you go to open a view
 *
 * A view may have many faces
 *
 * Need to think about how to selectively display / hide fields, and how to do group by and sort by
 * Based the running UX model we've discussed, faces need additive filters on from the overall view
 * too, e.g. a kanban face doesn't show documents with field 'status' eq to 'postponed' but the
 * primary tab, a table for instance, just shows all
 *
 * faces: table, list, kanban, calendar, pinned doc
 *
 */
export type ViewFaceType = 'table' | 'list' | 'kanban' | 'calendar' | 'pinned' | 'journal';

interface ViewFaceJSON {
	id: string;
	type: ViewFaceType;
	name?: string;
	display_field_ids: string[];
	additive_filter: FilterCompound;
	sort: SortKey[];
	config: Record<string, any>;
}

const FACE_TYPE_LABEL: Record<ViewFaceType, string> = {
	table: 'Table',
	list: 'List',
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

	constructor(json: ViewFaceJSON) {
		this.id = json.id;
		this.type = json.type;
		this.name = json.name ?? '';
		this.display_field_ids = json.display_field_ids;
		this.additive_filter = json.additive_filter;
		this.sort = json.sort;
		this.config = json.config;
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
			config: this.config
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
	'source',
	'tags',
	'folder',
	'path',
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

export interface ViewField {
	id: string; // uuid
	name: string; // all lowercase, alphanumeric, '-' and '_'
	type: ViewFieldType;
	config: Record<string, any>; // field specific config, e.g. mappings & formulas
	// todo: think about adding 'locked' bool for UX
}

function createViewField(
	name: string,
	type: ViewFieldType,
	config: Record<string, any> = {}
): ViewField {
	return {
		id: uuidv4(),
		name,
		type,
		config
	};
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
	source: ['eq', 'neq'],
	tags: ['has_any', 'has_all', 'has_none'],
	folder: ['in', 'not_in'],
	path: ['contains', 'not_contains', 'starts_with'],
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
	'source',
	'path',
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

const UNSAFE_SEG = /["'.\\\n\r\t]/;
function pathSeg(s: string, kind: string): string {
	if (!s || UNSAFE_SEG.test(s)) throw new Error(`Unsafe ${kind}: ${s}`);
	return s;
}
export function sanitizeName(raw: string): string {
	return raw
		.replace(/["'.\\]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function resolveColumn(fieldType: ViewFieldType, fieldName: string, viewSlug: string): string {
	switch (fieldType) {
		case 'id':
			return 'd.id';
		case 'title':
			return 'd.title';
		case 'source':
			return 'd.source_id';
		case 'path':
			return 'd.rel_path';
		case 'created_at':
			return 'd.created_at';
		case 'updated_at':
			return 'd.updated_at';
		case 'tags':
		case 'folder':
			throw new Error(`${fieldType} field has no scalar column; handle separately`);
		default:
			return `json_extract(d.properties, '$.views."${pathSeg(viewSlug, 'view slug')}"."${pathSeg(fieldName, 'field name')}"')`;
	}
}

function compileFolderLeaf(op: string, value: unknown): CompiledFilter {
	// docs carry every ancestor folder as a group includes children without recursive lookup
	// (done at index time)
	const exists = `EXISTS (SELECT 1 FROM document_groups dg WHERE dg.document_id = d.id AND dg.group_id = ?)`;
	switch (op) {
		case 'in':
			return { sql: exists, params: [value] };
		case 'not_in':
			return { sql: `NOT ${exists}`, params: [value] };
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
	const anyExists = `EXISTS (SELECT 1 FROM document_groups dg WHERE dg.document_id = d.id AND dg.group_id IN (${placeholders}))`;
	switch (op) {
		case 'has_any':
			return { sql: anyExists, params: [...ids] };
		case 'has_none':
			return { sql: `NOT ${anyExists}`, params: [...ids] };
		case 'has_all':
			return {
				sql: `(SELECT COUNT(DISTINCT dg.group_id) FROM document_groups dg WHERE dg.document_id = d.id AND dg.group_id IN (${placeholders})) = ?`,
				params: [...ids, ids.length]
			};
		default:
			throw new Error(`Unsupported op '${op}' for tags`);
	}
}

function compileLeafSql(
	field: ViewField,
	op: string,
	value: unknown,
	viewSlug: string
): CompiledFilter {
	if (field.type === 'folder') return compileFolderLeaf(op, value);
	if (field.type === 'tags') return compileTagsLeaf(op, value);

	const expr = resolveColumn(field.type, field.name, viewSlug);

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
			if (field.type === 'text' || field.type === 'title' || field.type === 'path') {
				return { sql: `(${expr} IS NULL OR ${expr} = '')`, params: [] };
			}
			if (field.type === 'multiselect') {
				return { sql: `(${expr} IS NULL OR json_array_length(${expr}) = 0)`, params: [] };
			}
			return { sql: `${expr} IS NULL`, params: [] };
		case 'is_not_empty':
			if (field.type === 'text' || field.type === 'title' || field.type === 'path') {
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

function compileNode(
	node: FilterNode,
	fieldsById: Map<string, ViewField>,
	viewSlug: string
): CompiledFilter {
	if ('children' in node) {
		const compiled = node.children
			.map((c) => compileNode(c, fieldsById, viewSlug))
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
	return compileLeafSql(field, node.op, node.value, viewSlug);
}

function compileFilter(
	filter: FilterNode | null,
	fields: ViewField[],
	viewSlug: string
): CompiledFilter {
	if (!filter) return { sql: '', params: [] };
	const fieldsById = new Map(fields.map((f) => [f.id, f]));
	return compileNode(filter, fieldsById, viewSlug);
}

function compileSort(sort: SortKey[], fields: ViewField[], viewSlug: string): string {
	const fieldsById = new Map(fields.map((f) => [f.id, f]));
	const terms: string[] = [];
	for (const key of sort) {
		const field = fieldsById.get(key.field_id);
		if (!field || !VIEW_FIELD_SORTABLE.has(field.type)) continue;
		const expr = resolveColumn(field.type, field.name, viewSlug);
		const dir = key.direction === 'desc' ? 'DESC' : 'ASC';
		const nulls = key.nulls === 'first' ? 'NULLS FIRST' : 'NULLS LAST';
		terms.push(`${expr} ${dir} ${nulls}`);
	}
	return terms.join(', ');
}

// ── View Model ───────────────────────────────────────────────────────────────────────

export interface MemberRow {
	id: string;
	title: string;
	rel_path: string;
	created_at: string;
	updated_at: string;
	properties: string;
	source_id: string;
}

interface ViewJSON {
	id: string;
	slug: string;
	created_at: Date;
	updated_at: Date;
	fields: ViewField[];
	filter: FilterCompound;
	faces: ViewFaceJSON[];
	state: Record<string, any>;
	temporary?: boolean;
	emoji?: string;
	cover?: string;
}

class View {
	id: string; // uuid
	slug: string = $state(''); // global unique view slug
	createdAt: Date;
	updatedAt: Date = $state(new Date());
	fields: ViewField[] = $state([]);
	filter: FilterCompound = $state({ op: 'and', children: [] });
	faces: ViewFace[] = $state([]);
	state: Record<string, any> = $state({});
	temporary: boolean = $state(false);
	emoji: string = $state(''); // user-set per-view emoji
	cover: string = $state('');

	constructor(json: ViewJSON) {
		this.id = json.id;
		this.slug = json.slug;
		this.createdAt = json.created_at;
		this.updatedAt = json.updated_at;
		this.fields = json.fields;
		this.filter = json.filter;
		this.faces = json.faces.map((j) => new ViewFace(j));
		this.state = json.state ?? {};
		this.temporary = json.temporary ?? false;
		this.emoji = json.emoji ?? '';
		this.cover = json.cover ?? '';
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
		return view;
	}

	static createFromGroup(group: Group): View {
		const view = View.create(group.slug);

		if (group.groupType === GroupType.Folder) {
			const folderFieldId = view.fields.find((f) => f.type == 'folder')!.id;
			view.addBasicFilter({
				field_id: folderFieldId,
				op: 'in',
				value: group.id
			});
		} else {
			const tagsFieldId = view.fields.find((f) => f.type == 'tags')!.id;
			view.addBasicFilter({
				field_id: tagsFieldId,
				op: 'has_any',
				value: [group.id]
			});
		}

		view.temporary = true;
		return view;
	}

	static createFromSource(source: Source): View {
		const view = View.create(sourceName(source));
		const sourceFieldId = view.fields.find((f) => f.type == 'source')!.id;

		view.addBasicFilter({
			field_id: sourceFieldId,
			op: 'eq',
			value: source.id
		});

		view.temporary = true;
		return view;
	}

	private initDefaultFields(): void {
		this.fields = BUILTIN_FIELD_TYPES.map((t) => createViewField(t, t));
	}

	private initDefaultFaces(): void {
		this.faces = [ViewFace.create('table', this.defaultFaceFieldIds())];
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
			config: JSON.parse(JSON.stringify(json.config))
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

	/**
	 * Create a new field of the given type with a unique default name, append it
	 * to the view's fields, and return it. Caller decides display placement.
	 */
	addFieldOfType(type: ViewFieldType): ViewField {
		const taken = new Set(this.fields.map((f) => f.name));
		let name: string = type;
		let n = 2;
		while (taken.has(name)) name = `${type}_${n++}`;
		const field = createViewField(name, type);
		this.fields.push(field);
		return field;
	}

	/**
	 * Adds a simple filter to the outer 'and' compound predicate
	 */
	addBasicFilter(filter: FilterLeaf) {
		this.filter.children.push(filter);
	}

	/** Persist this view to views.json and mark it as a saved (non-temporary) view. */
	async save() {
		this.temporary = false;
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
			created_at: this.createdAt,
			updated_at: this.updatedAt,
			fields: this.fields,
			filter: this.filter,
			faces: this.faces,
			state: this.state,
			temporary: this.temporary,
			emoji: this.emoji,
			cover: this.cover
		};
	}

	async getMembers(opts?: {
		face?: ViewFace;
		limit?: number;
		offset?: number;
		ids_in?: string[];
	}): Promise<MemberRow[]> {
		const filterNode: FilterNode = opts?.face
			? { op: 'and', children: [this.filter, opts.face.additive_filter] }
			: this.filter;
		const compiled = compileFilter(filterNode, this.fields, this.slug);
		const params = [...compiled.params];

		const idsIn = opts?.ids_in;
		let idsClause = '';
		if (idsIn !== undefined) {
			if (idsIn.length === 0) return [];
			idsClause = ` AND d.id IN (${idsIn.map(() => '?').join(', ')})`;
			params.push(...idsIn);
		}

		const sort = opts?.face?.sort ?? [];
		const orderBy = sort.length ? compileSort(sort, this.fields, this.slug) : '';

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

	// total matching members
	async countMembers(opts?: { face?: ViewFace }): Promise<number> {
		const filterNode: FilterNode = opts?.face
			? { op: 'and', children: [this.filter, opts.face.additive_filter] }
			: this.filter;
		const compiled = compileFilter(filterNode, this.fields, this.slug);
		const sql = `SELECT COUNT(*) AS n
			FROM documents d
			WHERE d.deleted_at IS NULL${compiled.sql ? ` AND ${compiled.sql}` : ''}`;
		const [row] = await select<{ n: number }>(sql, [...compiled.params]);
		return row?.n ?? 0;
	}

	// ── Brain Damaging Ops (multi-doc) ──────────────────────────────────────────────────

	/** Rename the view slug, moving every stored `views.<old>.*` value to the new namespace */
	async renameSlug(newSlug: string): Promise<void> {
		const oldSlug = this.slug;
		if (!newSlug || newSlug === oldSlug) return;
		const sources = await listSources();
		for (const s of sources) {
			await invoke('bulk_rename_view', {
				sourceId: s.id,
				sourcePath: s.path,
				oldSlug,
				newSlug
			});
		}
		this.slug = newSlug;
	}

	/** Rename a stateful field, moving its stored values to the new key, then update the model */
	async renameField(field: ViewField, newName: string): Promise<void> {
		const oldName = field.name;
		if (!newName || newName === oldName) return;
		const sources = await listSources();
		for (const s of sources) {
			await invoke('bulk_rename_view_field', {
				sourceId: s.id,
				sourcePath: s.path,
				viewSlug: this.slug,
				oldName,
				newName
			});
		}
		this.fields = this.fields.map((f) => (f.id === field.id ? { ...f, name: newName } : f));
	}

	/** Rename a select/multiselect option value across all stored documents */
	async renameOption(field: ViewField, oldValue: string, newValue: string): Promise<void> {
		const sources = await listSources();
		for (const s of sources) {
			await invoke('bulk_rename_view_option', {
				sourceId: s.id,
				sourcePath: s.path,
				viewSlug: this.slug,
				fieldName: field.name,
				oldValue,
				newValue
			});
		}
	}

	/** Write a stateful field value onto the given documents in a source */
	async writeFieldValue(
		sourceId: string,
		field: ViewField,
		value: unknown,
		docIds: string[]
	): Promise<BulkResult> {
		const source = await getSource(sourceId);
		return await invoke<BulkResult>('bulk_set_view_field', {
			sourceId,
			sourcePath: source.path,
			viewSlug: this.slug,
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
			return `${n} ${noun} couldn't be read: unsupported file encoding.`;
		case 'locked':
			return `${n} ${noun} are in use by another app. Close them and retry.`;
		default:
			return `${n} ${noun} couldn't be saved.`;
	}
}

export default View;
