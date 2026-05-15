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
import type DocHandle from '$lib/models/DocHandle';
import type Group from '$lib/models/Group';
import type { Source } from '$lib/models/Source';
import { select } from '$lib/db';

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
interface ViewFace {
	display_field_ids: string[];
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
 */

// built-ins: derived (mapped) from existing document attributes
const BUILTIN_FIELD_TYPES = [
	'title',
	'id',
	'source',
	'groups',
	'path',
	'created_at',
	'updated_at'
] as const;

// idk probably some more this seems fine for now
type ViewFieldType =
	| 'date'
	| 'text'
	| 'number'
	| 'boolean'
	| 'select'
	| 'multiselect' // might prune
	| (typeof BUILTIN_FIELD_TYPES)[number];

// does this add a prop to documents? If not it is derived (mapped)
function isDerived(type: ViewFieldType): boolean {
	return (BUILTIN_FIELD_TYPES as readonly string[]).includes(type);
}

interface ViewField {
	id: string; // uuid
	name: string; // all lowercase, alphanumeric, '-' and '_'
	type: ViewFieldType;
	config: Record<string, any>; // field specific config, e.g. mappings & formulas
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

const VIEW_FIELD_OPS: Record<ViewFieldType, string[]> = {
	text: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'is_empty', 'is_not_empty'],
	number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
	date: ['eq', 'neq', 'before', 'on_or_before', 'after', 'on_or_after', 'is_empty', 'is_not_empty'],
	boolean: ['eq'],
	select: ['eq', 'neq', 'is_empty', 'is_not_empty'],
	multiselect: ['contains', 'not_contains', 'is_empty', 'is_not_empty'], // might prune multiselect
	// BUILT-INS
	title: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'is_empty', 'is_not_empty'],
	id: ['eq', 'neq'],
	source: ['eq', 'neq'],
	groups: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
	path: ['contains', 'not_contains', 'starts_with'],
	created_at: ['before', 'on_or_before', 'after', 'on_or_after'],
	updated_at: ['before', 'on_or_before', 'after', 'on_or_after']
};

type FilterNode = FilterCompound | FilterLeaf;

interface FilterCompound {
	op: 'and' | 'or';
	children: FilterNode[];
}

interface FilterLeaf {
	field_id: string;
	op: string;
	value: unknown;
}

// ── SQL Compilation ──────────────────────────────────────────────────────────────────

interface CompiledFilter {
	sql: string;
	params: unknown[];
}

const SAFE_IDENT = /^[a-z0-9_-]+$/;
function safeIdent(s: string, kind: string): string {
	if (!SAFE_IDENT.test(s)) throw new Error(`Unsafe ${kind} identifier: ${s}`);
	return s;
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
		case 'groups':
			throw new Error('groups field has no scalar column; handle separately');
		default:
			return `json_extract(d.properties, '$.views.${safeIdent(viewSlug, 'view slug')}.${safeIdent(fieldName, 'field name')}')`;
	}
}

function compileGroupsLeaf(op: string, value: unknown): CompiledFilter {
	const exists = `EXISTS (SELECT 1 FROM document_groups dg WHERE dg.document_id = d.id`;
	switch (op) {
		case 'contains':
			return { sql: `${exists} AND dg.group_id = ?)`, params: [value] };
		case 'not_contains':
			return { sql: `NOT ${exists} AND dg.group_id = ?)`, params: [value] };
		case 'is_empty':
			return { sql: `NOT ${exists})`, params: [] };
		case 'is_not_empty':
			return { sql: `${exists})`, params: [] };
		default:
			throw new Error(`Unsupported op '${op}' for groups`);
	}
}

function compileLeafSql(
	field: ViewField,
	op: string,
	value: unknown,
	viewSlug: string
): CompiledFilter {
	if (field.type === 'groups') return compileGroupsLeaf(op, value);

	const expr = resolveColumn(field.type, field.name, viewSlug);

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

function compileNode(
	node: FilterNode,
	fieldsById: Map<string, ViewField>,
	viewSlug: string
): CompiledFilter {
	if ('children' in node) {
		const compiled = node.children.map((c) => compileNode(c, fieldsById, viewSlug));
		if (compiled.length === 0) return { sql: '', params: [] };
		const joiner = node.op === 'and' ? ' AND ' : ' OR ';
		return {
			sql: '(' + compiled.map((c) => c.sql).join(joiner) + ')',
			params: compiled.flatMap((c) => c.params)
		};
	}
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

// ── View Model ───────────────────────────────────────────────────────────────────────

interface MemberRow {
	id: string;
	title: string;
	rel_path: string;
	created_at: string;
	updated_at: string;
}

interface ViewJSON {
	id: string;
	slug: string;
	created_at: Date;
	updated_at: Date;
	fields: ViewField[];
	filter: FilterCompound;
	faces: ViewFace[];
}

class View {
	id: string; // uuid
	slug: string; // global unique view slug
	createdAt: Date;
	updatedAt: Date;
	fields: ViewField[];
	filter: FilterCompound;
	faces: ViewFace[];

	constructor(json: ViewJSON) {
		this.id = json.id;
		this.slug = json.slug;
		this.createdAt = json.created_at;
		this.updatedAt = json.updated_at;
		this.fields = json.fields;
		this.filter = json.filter;
		this.faces = json.faces;
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
			faces: [] // probably want default
		});
		view.initDefaultFields();
		return view;
	}

	static createFromGroup(group: Group): View {
		const view = View.create(group.slug);
		// group field already exists, find it
		const groupFieldId = view.fields.find((f) => f.type == 'groups')!.id;

		view.addBasicFilter({
			field_id: groupFieldId,
			op: 'contains',
			value: group.id
		});

		return view;
	}

	static createFromSource(source: Source): View {
		const view = View.create(source.title);
		const sourceFieldId = view.fields.find((f) => f.type == 'source')!.id;

		view.addBasicFilter({
			field_id: sourceFieldId,
			op: 'eq',
			value: source.id
		});

		return view;
	}

	private initDefaultFields(): void {
		this.fields = BUILTIN_FIELD_TYPES.map((t) => createViewField(t, t));
	}

	addField(field: ViewField) {
		this.fields.push(field);
	}

	/**
	 * Adds a simple filter to the outer 'and' compound predicate
	 */
	addBasicFilter(filter: FilterLeaf) {
		this.filter.children.push(filter);
	}

	async save() {
		// todo
	}

	toJSON(): ViewJSON {
		return {
			id: this.id,
			slug: this.slug,
			created_at: this.createdAt,
			updated_at: this.updatedAt,
			fields: this.fields,
			filter: this.filter,
			faces: this.faces
		};
	}

	async getMembers(opts?: { limit?: number; offset?: number }): Promise<MemberRow[]> {
		const compiled = compileFilter(this.filter, this.fields, this.slug);
		const params = [...compiled.params];

		let sql = `SELECT d.id, d.title, d.rel_path, d.created_at, d.updated_at
			FROM documents d
			WHERE d.deleted_at IS NULL${compiled.sql ? ` AND ${compiled.sql}` : ''}
			ORDER BY d.updated_at DESC`;

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

	// ── Global View Management ──────────────────────────────────────────────────────────

	// static async loadViews(): View[] {
	// 	// todo
	// }
}

export default View;
