import { reportError, addSourceRequest, toasts, mark } from '$lib/overlays.svelte';
import View, {
	type FilterNode,
	type MemberRow,
	type SortKey,
	type ViewField,
	describeBulkFailure,
	isBuiltinUnit,
	isLeafActive,
	isStatusField,
	TODO_DONE,
	ViewFace,
	type FilterLeaf
} from '$lib/models/View.svelte';
import {
	rawStatefulValue,
	seedProperties,
	withStatefulValue,
	firstStatus,
	statusIsDone,
	statusOf,
	listInlineByDefault
} from '$lib/views/fieldValue';
import { select } from '$lib/services/db';
import { searchDocuments, type SearchResult } from '$lib/services/search';
import {
	getDefaultSourceId,
	listSources,
	pickCreationSource,
	type Source
} from '$lib/models/Source';
import Folder, { folderIdPath, folderIdSource, isSourceRoot } from '$lib/models/Folder';
import DocHandle from '$lib/models/DocHandle';
import { sanitizeSegment } from '$lib/util/paths';
import { tagId } from '$lib/models/Tag';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { SvelteSet } from 'svelte/reactivity';
import { resolveRelativeDate, wallClockToMs } from '$lib/views/dateFormat';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

export type RowTag = { id: string; slug: string };

const PAGE = 100;
type Write = { field: ViewField; value: unknown };

function applyWrites(props: string, writes: Write[]): string {
	for (const w of writes) props = withStatefulValue(props, w.field, w.value);
	return props;
}

function nodeSig(n: FilterNode): string {
	if ('children' in n) return `C|${n.op}|${n.children.map(nodeSig).join(',')}`;
	return isLeafActive(n.op, n.value) ? `L|${n.field_id}|${n.op}|${String(n.value)}` : '';
}

function sortSig(keys: SortKey[]): string {
	return keys.map((k) => `${k.field_id}|${k.direction}|${k.nulls ?? 'last'}`).join(',');
}

/**
 * The rows a face shows and everything that changes them. A face component owns one of these,
 * runs its load on the signature it exposes, and renders; cards and rows share the same
 * mutations so a list, a grid and a board behave identically
 */
// built-in tags lead: they say what a note is before the user's own tags say what it's about
function orderTags(tags: RowTag[]): RowTag[] {
	return [...tags].sort((a, b) => Number(isBuiltinUnit(b.id)) - Number(isBuiltinUnit(a.id)));
}

export class FaceRows {
	rows: MemberRow[] = $state([]);
	total = $state(0);
	loading = $state(true);
	loadingMore = $state(false);
	error = $state('');
	rowTags: Record<string, RowTag[]> = $state({});
	searchHits: Record<string, SearchResult> = $state({});
	sources: Source[] = $state([]);
	folders: Folder[] = $state([]);
	defaultSourceId: string | null = $state(null);
	// rows a filtered field was just changed on: the reload may drop them, and they leave
	// with a transition rather than a cut
	leaving = new SvelteSet<string>();
	private token = 0;

	constructor(
		private readonly view: () => View,
		private readonly face: () => ViewFace,
		private readonly scope: () => FilterNode | null = () => null
	) {}

	get query(): string {
		return ((this.view().state.search as string | undefined) ?? '').trim();
	}

	// anything that changes which rows come back, or their order
	signature(): string {
		const view = this.view();
		const face = this.face();
		const scope = this.scope();
		return [
			view.unit ?? '',
			view.subfolder ?? '',
			nodeSig(view.filter),
			nodeSig(face.additive_filter),
			scope ? nodeSig(scope) : '',
			sortSig(face.sort),
			((face.config.order as string[] | undefined) ?? []).join(','),
			this.query
		].join('#');
	}

	init(): void {
		listSources()
			.then((ss) => (this.sources = ss))
			.catch(() => {});
		Folder.list()
			.then((fs) => (this.folders = fs))
			.catch(() => {});
		getDefaultSourceId()
			.then((id) => (this.defaultSourceId = id))
			.catch(() => {});
	}

	async load(silent = false): Promise<void> {
		const token = ++this.token;
		const view = this.view();
		const face = this.face();
		const scope = this.scope();
		if (!silent) this.loading = true;
		this.error = '';
		try {
			const q = this.query;
			let out: MemberRow[];
			let hits: Record<string, SearchResult> = {};
			if (q) {
				const results = await searchDocuments(q, view.searchScope({ face, scope }));
				if (token !== this.token) return;
				const ids = results.map((r) => r.id);
				hits = Object.fromEntries(results.map((r) => [r.id, r]));
				if (ids.length === 0) {
					out = [];
				} else {
					const members = await view.getMembers({ face, scope, ids_in: ids, limit: ids.length });
					if (face.config.keep_sort) {
						// a face that is itself a timeline keeps its order under search
						out = members;
					} else {
						const byId = new Map(members.map((m) => [m.id, m]));
						out = ids.map((id) => byId.get(id)).filter((r): r is MemberRow => !!r);
					}
				}
			} else {
				out = await view.getMembers({ face, scope, limit: PAGE });
			}
			if (token !== this.token) return;
			const tags = await this.fetchTags(out);
			if (token !== this.token) return;

			// a hand-ordered face: rows it knows go in that order, the rest follow as sorted
			const order = face.config.order as string[] | undefined;
			if (order?.length && !q) {
				const rank = new Map(order.map((id, i) => [id, i]));
				const known = out
					.filter((r) => rank.has(r.id))
					.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
				out = [...known, ...out.filter((r) => !rank.has(r.id))];
			}

			this.rows = out;
			this.rowTags = tags;
			this.searchHits = hits;
			this.total = out.length;
			// rows still here after all weren't leaving; the ones gone keep their mark while
			// their exit plays, then it's dropped
			const gone = [...this.leaving].filter((id) => !out.some((r) => r.id === id));
			for (const id of this.leaving) if (!gone.includes(id)) this.leaving.delete(id);
			if (gone.length) setTimeout(() => gone.forEach((id) => this.leaving.delete(id)), 400);
			if (!q && out.length === PAGE) {
				view
					.countMembers({ face, scope })
					.then((n) => {
						if (token === this.token) this.total = n;
					})
					.catch(() => {});
			}
		} catch (e) {
			if (token === this.token) this.error = "This list couldn't be loaded. Try reopening it.";
		} finally {
			if (token === this.token) this.loading = false;
		}
	}

	async loadMore(): Promise<void> {
		if (this.loadingMore || this.query) return;
		const token = this.token;
		this.loadingMore = true;
		try {
			const more = await this.view().getMembers({
				face: this.face(),
				scope: this.scope(),
				limit: PAGE,
				offset: this.rows.length
			});
			if (token !== this.token) return;
			const tags = await this.fetchTags(more);
			if (token !== this.token) return;
			this.rows = [...this.rows, ...more];
			this.rowTags = { ...this.rowTags, ...tags };
		} catch (e) {
			if (token === this.token) this.error = "More notes couldn't be loaded. Try scrolling again.";
		} finally {
			this.loadingMore = false;
		}
	}

	private async fetchTags(list: MemberRow[]): Promise<Record<string, RowTag[]>> {
		if (list.length === 0) return {};
		try {
			const ph = list.map(() => '?').join(', ');
			const hits = await select<{ doc_id: string; id: string; slug: string }>(
				`SELECT dt.document_id AS doc_id, t.id, t.slug
                 FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
                 WHERE dt.document_id IN (${ph})`,
				list.map((r) => r.id)
			);
			const next: Record<string, RowTag[]> = {};
			for (const h of hits) (next[h.doc_id] ??= []).push({ id: h.id, slug: h.slug });
			for (const id in next) next[id] = orderTags(next[id]);
			return next;
		} catch {
			return {};
		}
	}

	tagSlugsFor(rowId: string): string[] {
		return (this.rowTags[rowId] ?? []).map((t) => t.slug);
	}

	// a unit's fields count only on the unit's members: a todo checkbox on a note without
	// the tag is inert, so it's drawn but not live. Folder units are always satisfied here,
	// their views only ever hold their own subtree
	writable(row: MemberRow): boolean {
		return row.writes_meta !== 0;
	}

	memberOf(row: MemberRow, field: ViewField): boolean {
		const unit = field.unit;
		if (!unit || !unit.startsWith('tag:')) return true;
		return (this.rowTags[row.id] ?? []).some((t) => t.id === unit);
	}

	// a value that is the view's own scope says nothing: the tag of a tag view, the folder of
	// a folder view for notes sitting directly in it
	get scopeTag(): string | null {
		const hidden = this.face().config.hide_tag as string | undefined;
		if (hidden) return hidden.slice('tag:'.length);
		const u = this.view().unit;
		return u?.startsWith('tag:') ? u.slice('tag:'.length) : null;
	}

	// a built-in tag whose fields are on the row already says what the note is: the checkbox
	// is the todo-ness, the pill would only repeat it
	get hiddenTags(): Set<string> {
		const out = new Set<string>();
		const scope = this.scopeTag;
		if (scope) out.add(scope);
		for (const f of this.shown) {
			if (f.unit && isBuiltinUnit(f.unit)) out.add(f.unit.slice('tag:'.length));
		}
		return out;
	}

	get scopeDir(): string | null {
		const u = this.view().unit;
		return u && !u.startsWith('tag:') ? folderIdPath(u) : null;
	}

	// ── Lanes ────────────────────────────────────────────────────────────────
	// A boolean shown first is the leading checkbox. The rest split into what a note is
	// (after the title) and when or how much (packed right), by face override or type default
	get shown(): ViewField[] {
		const view = this.view();
		return this.face()
			.display_field_ids.map((fid) => view.fields.find((f) => f.id === fid))
			.filter((f): f is ViewField => !!f && f.type !== 'title');
	}

	get checkField(): ViewField | null {
		const first = this.shown[0];
		return first && (first.type === 'boolean' || isStatusField(first)) ? first : null;
	}

	get lanes(): { inline: ViewField[]; meta: ViewField[] } {
		const rest = this.checkField ? this.shown.slice(1) : this.shown;
		const rightIds = this.face().config.right as string[] | undefined;
		const isRight = (f: ViewField) =>
			rightIds ? rightIds.includes(f.id) : !listInlineByDefault(f.type);
		return { inline: rest.filter((f) => !isRight(f)), meta: rest.filter(isRight) };
	}

	// ── Mutations ────────────────────────────────────────────────────────────
	// a field the view filters on changes membership: the row may be leaving
	fieldFiltersView(fieldId: string): boolean {
		const hit = (n: FilterNode): boolean =>
			'children' in n
				? n.children.some(hit)
				: n.field_id === fieldId && isLeafActive(n.op, n.value);
		return hit(this.view().filter) || hit(this.face().additive_filter);
	}

	// a field the view filters or sorts on changes membership or order, so reload after
	fieldAffectsView(fieldId: string): boolean {
		return this.fieldFiltersView(fieldId) || this.face().sort.some((s) => s.field_id === fieldId);
	}

	// the rows as the reader dragged them; the face's owner persists the order
	reorder(ids: string[]): void {
		const byId = new Map(this.rows.map((r) => [r.id, r]));
		this.rows = ids.map((id) => byId.get(id)).filter((r): r is MemberRow => !!r);
	}

	patchRow(id: string, patch: Partial<MemberRow>): void {
		this.rows = this.rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
	}

	// the todo's status and checkbox say the same thing: setting one may move the other. A
	// status is only ever written once it's been set; until then it follows the checkbox
	private companion(row: MemberRow, field: ViewField, value: unknown): Write | null {
		const fields = this.view().fields;
		if (isStatusField(field)) {
			const done = fields.find((f) => f.id === TODO_DONE);
			if (!done || value === null || value === '') return null;
			const want = statusIsDone(field, String(value));
			if ((rawStatefulValue(row, done) === true) === want) return null;
			return { field: done, value: want };
		}
		if (field.id === TODO_DONE) {
			const status = fields.find((f) => isStatusField(f));
			const raw = status ? rawStatefulValue(row, status) : null;
			if (!status || typeof raw !== 'string' || !raw) return null;
			const want = value === true;
			if (statusIsDone(status, raw) === want) return null;
			return { field: status, value: firstStatus(status, want) };
		}
		return null;
	}

	async writeCell(row: MemberRow, field: ViewField, value: unknown): Promise<void> {
		if (!this.writable(row)) return;
		const extra = this.companion(row, field, value);
		const writes: Write[] = extra ? [{ field, value }, extra] : [{ field, value }];
		const prev: Write[] = writes.map((w) => ({
			field: w.field,
			value: rawStatefulValue(row, w.field)
		}));
		history.push(this.view().id, {
			back: () => this.restore(row, prev),
			forward: () => this.restore(row, writes)
		});
		if (writes.some((w) => this.fieldFiltersView(w.field.id))) this.leaving.add(row.id);
		const before = row.properties;
		this.patchRow(row.id, { properties: applyWrites(before, writes) });
		try {
			const view = this.view();
			for (const w of writes) {
				const result = await view.writeFieldValue(row.source_id, w.field, w.value, [row.id]);
				if (result.failed > 0) {
					this.patchRow(row.id, { properties: before });
					this.leaving.delete(row.id);
					toasts.push(describeBulkFailure(result), {
						action: { label: 'Retry', run: () => this.writeCell(row, field, value) }
					});
					return;
				}
			}
			if (writes.some((w) => this.fieldAffectsView(w.field.id))) this.load(true);
		} catch (e) {
			this.patchRow(row.id, { properties: before });
			this.leaving.delete(row.id);
			reportError(e, `${mark('note', row.title)} couldn't be saved.`, () =>
				this.writeCell(row, field, value)
			);
		}
	}

	// an undo or redo: the values go to the file as they were, and the view follows
	private async restore(row: MemberRow, writes: Write[]): Promise<void> {
		const here = this.rows.find((r) => r.id === row.id);
		if (here) {
			if (writes.some((w) => this.fieldFiltersView(w.field.id))) this.leaving.add(row.id);
			this.patchRow(row.id, { properties: applyWrites(here.properties, writes) });
		}
		try {
			for (const w of writes)
				await this.view().writeFieldValue(row.source_id, w.field, w.value, [row.id]);
		} catch (e) {
			reportError(e, `${mark('note', row.title)} couldn't be saved.`);
		}
		this.load(true);
	}

	toggle(row: MemberRow, field: ViewField): void {
		if (!this.writable(row)) return;
		if (isStatusField(field)) {
			const done = statusIsDone(field, statusOf(row, field));
			this.writeCell(row, field, firstStatus(field, !done));
			return;
		}
		this.writeCell(row, field, rawStatefulValue(row, field) !== true);
	}

	private readTags(row: MemberRow): Promise<{ frontmatter: string[]; body: string[] }> {
		return invoke('read_document_tags', { sourceId: row.source_id, relPath: row.rel_path });
	}

	async textTags(row: MemberRow): Promise<Map<string, number>> {
		const counts = new Map<string, number>();
		try {
			for (const slug of (await this.readTags(row)).body) {
				counts.set(tagId(slug), (counts.get(tagId(slug)) ?? 0) + 1);
			}
		} catch (e) {
			console.error('read text tags failed', e);
		}
		return counts;
	}

	async setTag(rowId: string, slug: string, on: boolean): Promise<RowTag[] | null> {
		const row = this.rows.find((r) => r.id === rowId);
		if (!row || !this.writable(row)) return null;
		history.push(this.view().id, {
			back: async () => void (await this.applyTag(rowId, slug, !on)),
			forward: async () => void (await this.applyTag(rowId, slug, on))
		});
		return this.applyTag(rowId, slug, on);
	}

	private async applyTag(rowId: string, slug: string, on: boolean): Promise<RowTag[] | null> {
		const row = this.rows.find((r) => r.id === rowId);
		if (!row) return null;
		try {
			const id = tagId(slug);
			const { frontmatter, body } = await this.readTags(row);
			const kept = frontmatter.filter((t) => tagId(t) !== id);
			if (!on && body.some((t) => tagId(t) === id)) {
				await invoke('strip_document_tag', {
					id: rowId,
					sourceId: row.source_id,
					relPath: row.rel_path,
					slug
				});
			}
			if (on || kept.length !== frontmatter.length) {
				const doc = await DocHandle.fromID(rowId);
				await doc.setTags(on ? [...kept, slug] : kept);
			}
			const tags = (await this.fetchTags([row]))[rowId] ?? [];
			this.rowTags = { ...this.rowTags, [rowId]: tags };
			const fid = this.view().fields.find((f) => f.type === 'tags')?.id;
			if (fid && this.fieldAffectsView(fid)) this.load(true);
			return tags;
		} catch (e) {
			reportError(e, `Tags on ${mark('note', row.title)} couldn't be saved.`);
			return null;
		}
	}

	async rename(rowId: string, title: string): Promise<void> {
		const row = this.rows.find((r) => r.id === rowId);
		if (!row || !title.trim() || title.trim() === row.title) return;
		const prev = row.title;
		history.push(this.view().id, {
			back: () => this.applyRename(rowId, prev),
			forward: () => this.applyRename(rowId, title.trim())
		});
		await this.applyRename(rowId, title);
	}

	private async applyRename(rowId: string, title: string): Promise<void> {
		const prev = this.rows.find((r) => r.id === rowId)?.title ?? '';
		this.patchRow(rowId, { title: title.trim() });
		try {
			const doc = await DocHandle.fromID(rowId);
			await doc.rename(title.trim());
			this.patchRow(rowId, { title: doc.title });
		} catch (e) {
			this.patchRow(rowId, { title: prev });
			reportError(e, `${mark('note', prev)} couldn't be renamed.`);
		}
	}

	async delete(rowId: string): Promise<void> {
		const title = this.rows.find((r) => r.id === rowId)?.title ?? '';
		try {
			const doc = await DocHandle.fromID(rowId);
			await doc.delete();
			this.rows = this.rows.filter((r) => r.id !== rowId);
			this.total = Math.max(0, this.total - 1);
		} catch (e) {
			reportError(e, `${mark('note', title)} couldn't be deleted.`, () => this.delete(rowId));
		}
	}

	// ── Create ───────────────────────────────────────────────────────────────
	get createCtx() {
		return deriveCreateContext(this.view(), this.face(), this.folders, this.scope());
	}

	creationSource(): Source | undefined {
		return sourceFor(this.createCtx, this.sources, this.folders, this.defaultSourceId);
	}

	// the path a new note with this title would take, for the collision warning
	async titleTaken(title: string): Promise<boolean> {
		const source = this.creationSource();
		if (!source || !title.trim()) return false;
		const ctx = this.createCtx;
		const dir = ctx.folderGroupId ? folderPath(ctx.folderGroupId) : '';
		const base = sanitizeSegment(title);
		if (!base) return false;
		return DocHandle.pathTaken(source, dir ? `${dir}/${base}.md` : `${base}.md`).catch(() => false);
	}

	async renameTaken(row: MemberRow, title: string): Promise<boolean> {
		const source = this.sources.find((s) => s.id === row.source_id);
		const base = sanitizeSegment(title);
		if (!source || !base) return false;
		const cut = row.rel_path.lastIndexOf('/');
		const rel = cut === -1 ? `${base}.md` : `${row.rel_path.slice(0, cut)}/${base}.md`;
		if (rel.toLowerCase() === row.rel_path.toLowerCase()) return false;
		return DocHandle.pathTaken(source, rel).catch(() => false);
	}

	async create(title = '', values: Record<string, unknown> = {}): Promise<string | null> {
		const source = this.creationSource();
		if (!source) {
			addSourceRequest.open();
			return null;
		}
		try {
			const ctx = this.createCtx;
			const status = this.view().fields.find((f) => isStatusField(f));
			if (status && status.name in values && statusIsDone(status, String(values[status.name])))
				values = { ...values, done: true };
			ctx.fieldValues = { ...ctx.fieldValues, ...values };
			const doc = await createFromContext(this.view(), ctx, source, title);
			await this.load(true);
			return doc.id;
		} catch (e) {
			reportError(
				e,
				title ? `${mark('note', title)} couldn't be created.` : "The new note couldn't be created.",
				() => this.create(title, values)
			);
			return null;
		}
	}
}

function sourceFor(
	ctx: CreateContext,
	sources: Source[],
	folders: Folder[],
	defaultSourceId: string | null
): Source | undefined {
	let source: Source | undefined;
	if (ctx.sourceId) source = sources.find((s) => s.id === ctx.sourceId);
	if (!source && ctx.folderGroupId) {
		const g = folders.find((f) => f.id === ctx.folderGroupId);
		if (g?.sourceId) source = sources.find((s) => s.id === g.sourceId);
	}
	return source ?? pickCreationSource(sources, defaultSourceId) ?? undefined;
}

async function createFromContext(
	view: View,
	ctx: CreateContext,
	source: Source,
	title: string
): Promise<DocHandle> {
	const doc = await DocHandle.createFromTitle(source, {
		title: title.trim() || 'Untitled',
		dir: ctx.folderGroupId ? folderPath(ctx.folderGroupId) : '',
		groupIds: [...ctx.tagGroupIds],
		properties: seedProperties(view.fields, ctx.fieldValues)
	});
	const createdAt = createMetaDate(ctx, 'created_at');
	const updatedAt = createMetaDate(ctx, 'updated_at');
	if (createdAt || updatedAt) {
		await doc.saveMeta({
			createdAt: createdAt ?? undefined,
			updatedAt: updatedAt ?? undefined
		});
	}
	return doc;
}

export async function createInView(view: View, todo = false): Promise<string | null> {
	const tags = view.fields.find((f) => f.type === 'tags');
	const face = ViewFace.create('list');
	if (todo && tags) face.addBasicFilter({ field_id: tags.id, op: 'has_any', value: ['tag:todo'] });
	const [sources, folders, defaultSourceId] = await Promise.all([
		listSources(),
		Folder.list(),
		getDefaultSourceId()
	]);
	const ctx = deriveCreateContext(view, face, folders);
	const source = sourceFor(ctx, sources, folders, defaultSourceId);
	if (!source) return null;
	return (await createFromContext(view, ctx, source, '')).id;
}

export interface CreateContext {
	folderGroupId: string | null;
	ambiguous: boolean;
	fieldValues: Record<string, unknown>;
	tagGroupIds: string[];
	sourceId: string | null;
	metaDates: { created_at?: string; updated_at?: string };
}

function conjunctiveLeaves(node: FilterNode, out: FilterLeaf[]): void {
	if ('children' in node) {
		if (node.op !== 'and') return;
		for (const c of node.children) conjunctiveLeaves(c, out);
	} else {
		out.push(node);
	}
}

function ancestorChain(id: string, byId: Map<string, Folder>): string[] {
	const chain: string[] = [];
	let g = byId.get(id);
	let guard = 0;
	while (g?.parentId && guard++ < 64) {
		chain.push(g.parentId);
		g = byId.get(g.parentId);
	}
	return chain;
}

function resolveFolder(
	folderIds: string[],
	byId: Map<string, Folder>
): { id: string | null; ambiguous: boolean } {
	const ids = [...new Set(folderIds)];
	if (ids.length === 0) return { id: null, ambiguous: false };
	if (ids.length === 1) return { id: ids[0], ambiguous: false };

	const deepest = ids.filter((c) => {
		const ancestors = new Set(ancestorChain(c, byId));
		return ids.every((o) => o === c || ancestors.has(o));
	});
	if (deepest.length === 1) return { id: deepest[0], ambiguous: false };
	return { id: null, ambiguous: true };
}

export function deriveCreateContext(
	view: View,
	face: ViewFace,
	folders: Folder[],
	scope?: FilterNode | null
): CreateContext {
	const leaves: FilterLeaf[] = [];
	conjunctiveLeaves(view.filter, leaves);
	conjunctiveLeaves(face.additive_filter, leaves);
	// the caller's scope (a journal's selected day) seeds new docs (so they stay on screen)
	if (scope) conjunctiveLeaves(scope, leaves);

	const fieldsById = new Map(view.fields.map((f) => [f.id, f]));
	const byId = new Map(folders.map((g) => [g.id, g]));

	const folderIds: string[] = [];
	const tagGroupIds: string[] = [];
	const fieldValues: Record<string, unknown> = {};
	const metaDates: { created_at?: string; updated_at?: string } = {};
	let sourceId: string | null = null;
	let folderSourceId: string | null = null;

	for (const field of view.fields) {
		const def = field.config?.default;
		if (def === undefined || def === null || def === '') continue;
		if (field.type === 'select' || field.type === 'multiselect') {
			fieldValues[field.name] = field.type === 'multiselect' && !Array.isArray(def) ? [def] : def;
		}
	}

	if (view.unit?.startsWith('tag:')) tagGroupIds.push(view.unit);
	else if (view.unit && isSourceRoot(view.unit)) folderSourceId = folderIdSource(view.unit);
	else if (view.unit) folderIds.push(view.subfolder ?? view.unit);

	for (const leaf of leaves) {
		const field = fieldsById.get(leaf.field_id);
		if (!field) continue;

		if (field.type === 'folder') {
			if (leaf.op === 'in' && typeof leaf.value === 'string') {
				if (isSourceRoot(leaf.value)) {
					if (!folderSourceId) folderSourceId = folderIdSource(leaf.value);
				} else folderIds.push(leaf.value);
			}
		} else if (field.type === 'tags') {
			if ((leaf.op === 'has_any' || leaf.op === 'has_all') && Array.isArray(leaf.value)) {
				for (const v of leaf.value) if (typeof v === 'string') tagGroupIds.push(v);
			}
		} else if (field.type === 'created_at' || field.type === 'updated_at') {
			// a day scope ("on or after <day>", "before <next day>") seeds
			if (leaf.op === 'on_or_after' && typeof leaf.value === 'string') {
				metaDates[field.type] = resolveRelativeDate(leaf.value) ?? leaf.value;
			}
		} else {
			collectFieldDefault(field, leaf, fieldValues);
		}
	}

	const folder = resolveFolder(folderIds, byId);
	if (!sourceId && folder.id) sourceId = byId.get(folder.id)?.sourceId ?? null;
	if (!sourceId) sourceId = folderSourceId;

	return {
		folderGroupId: folder.id,
		ambiguous: folder.ambiguous,
		fieldValues,
		tagGroupIds: [...new Set(tagGroupIds)],
		sourceId,
		metaDates
	};
}

/**
 * The created_at/updated_at a new doc needs to land inside the view's date scope
 * or null when shit does not work out
 */
export function createMetaDate(ctx: CreateContext, type: 'created_at' | 'updated_at'): Date | null {
	const raw = ctx.metaDates[type];
	if (!raw) return null;
	const ms = wallClockToMs(raw);
	if (ms === null) return null;
	const d = new Date(ms);
	const now = new Date();
	const isToday =
		d.getFullYear() === now.getFullYear() &&
		d.getMonth() === now.getMonth() &&
		d.getDate() === now.getDate();
	return isToday ? null : d;
}

function collectFieldDefault(
	field: ViewField,
	leaf: FilterLeaf,
	out: Record<string, unknown>
): void {
	if (leaf.value === null || leaf.value === undefined || leaf.value === '') return;
	if (field.type === 'multiselect') {
		if (leaf.op === 'contains') out[field.name] = [leaf.value];
		return;
	}
	// boolean filters use eq with a real true/false ;;;; both are valid defaults
	if (field.type === 'boolean') {
		if (leaf.op === 'eq') out[field.name] = leaf.value === true || leaf.value === 'true';
		return;
	}
	// a day scope is a range, so seed from its lower bound as well as from eq
	if (field.type === 'date') {
		if (leaf.op === 'eq' || leaf.op === 'on_or_after')
			out[field.name] = resolveRelativeDate(leaf.value) ?? leaf.value;
		return;
	}
	if (leaf.op === 'eq') out[field.name] = leaf.value;
}

export function folderPath(groupId: string): string {
	return folderIdPath(groupId);
}

// Cheap previews for cards until there are real thumbnails: the first image embedded in the
// body if there is one, else the first few hundred characters of prose with the markdown
// stripped. Cached per (id, updated_at) so a reload only reads files that changed.

export type Preview = { text: string; image: string };

const PREVIEW_MAX = 280;
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const IMAGE_EMBED_RE = /!\[\[([^\]\n]+?)\]\]|!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/;

function stripMd(s: string): string {
	return s
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/!\[\[[^\]\n]*\]\]/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/^[-*+]\s+\[[ xX]\]\s+/gm, '')
		.replace(/^\s*[-*+>]\s+/gm, '')
		.replace(/[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}/g, '$1')
		.replace(/\n{2,}/g, '\n')
		.trim();
}

// same resolution the editor's inline embeds use: source-relative, falling back to the
// source's asset folder for bare filenames
function firstImage(body: string, source: Source): string {
	const m = IMAGE_EMBED_RE.exec(body);
	if (!m) return '';
	const target = (m[1] ? m[1].split('|')[0] : m[3]).trim();
	if (/^(https?|data|asset):/i.test(target)) return target;
	const clean = target.replace(/\\/g, '/').replace(/^\.?\//, '');
	const ext = clean.split('.').pop()?.toLowerCase() ?? '';
	if (!IMAGE_EXTS.has(ext)) return '';
	const loc = (source.asset_location ?? '').replace(/^\/+|\/+$/g, '');
	const rel = clean.includes('/') || !loc ? clean : `${loc}/${clean}`;
	return convertFileSrc(`${source.path}/${rel}`);
}

export class PreviewCache {
	private cache = new Map<string, Preview>();

	async fetch(rows: MemberRow[], sources: Source[]): Promise<Record<string, Preview>> {
		const out: Record<string, Preview> = {};
		if (rows.length === 0) return out;
		const byId = new Map(sources.map((s) => [s.id, s]));
		await Promise.all(
			rows.map(async (r) => {
				const key = `${r.id}:${r.updated_at}`;
				let hit = this.cache.get(key);
				if (hit === undefined) {
					const src = byId.get(r.source_id);
					if (!src) return;
					try {
						const raw = await readTextFile(`${src.path}/${r.rel_path}`);
						const body = DocHandle.deserialize(raw).body;
						hit = { text: stripMd(body).slice(0, PREVIEW_MAX), image: firstImage(body, src) };
					} catch {
						hit = { text: '', image: '' };
					}
					this.cache.set(key, hit);
				}
				out[r.id] = hit;
			})
		);
		return out;
	}
}

export type RowOpen = boolean | 'side';

export function openHow(e: MouseEvent): RowOpen {
	const mod = e.ctrlKey || e.metaKey;
	return mod && e.shiftKey ? 'side' : mod;
}

// How a row or card that stopped matching the view goes: rows and board cards fold up so what's
// below slides in, grid cards fade and shrink a touch. Anything else removed goes at once
export function leave(node: HTMLElement, { mode }: { mode: 'row' | 'card' }): TransitionConfig {
	if (node.dataset.leaving === undefined) return { duration: 0 };
	if (mode === 'card') {
		return {
			duration: 160,
			easing: cubicOut,
			css: (t) => `opacity: ${t}; transform: scale(${0.96 + 0.04 * t});`
		};
	}
	const h = node.offsetHeight;
	const s = getComputedStyle(node);
	const mt = parseFloat(s.marginTop) || 0;
	const mb = parseFloat(s.marginBottom) || 0;
	return {
		duration: 200,
		easing: cubicOut,
		css: (t) =>
			`overflow: hidden; height: ${t * h}px; min-height: 0; margin-top: ${t * mt}px; ` +
			`margin-bottom: ${t * mb}px; opacity: ${t};`
	};
}

// Undo for view actions: one stack, owned by whichever view last pushed, cleared when its face
// changes. Entries put the file back (or forward again); the screen follows the file
export type Entry = { back: () => Promise<void>; forward: () => Promise<void> };

const MAX = 50;

class History {
	private owner: string | null = null;
	private undos: Entry[] = [];
	private redos: Entry[] = [];
	private batch: Entry[] | null = null;

	push(owner: string, entry: Entry): void {
		if (owner !== this.owner) {
			this.owner = owner;
			this.undos = [];
			this.redos = [];
		}
		if (this.batch) {
			this.batch.push(entry);
			return;
		}
		this.redos = [];
		this.undos.push(entry);
		if (this.undos.length > MAX) this.undos.shift();
	}

	// everything pushed inside runs as one step, undone in reverse
	group(owner: string, fn: () => void): void {
		if (this.batch) {
			fn();
			return;
		}
		const list: Entry[] = (this.batch = []);
		try {
			fn();
		} finally {
			this.batch = null;
		}
		if (list.length === 0) return;
		this.push(owner, {
			back: async () => {
				for (const e of [...list].reverse()) await e.back();
			},
			forward: async () => {
				for (const e of list) await e.forward();
			}
		});
	}

	clear(): void {
		this.owner = null;
		this.undos = [];
		this.redos = [];
	}

	async undo(owner: string): Promise<boolean> {
		if (owner !== this.owner) return false;
		const e = this.undos.pop();
		if (!e) return false;
		await e.back();
		this.redos.push(e);
		return true;
	}

	async redo(owner: string): Promise<boolean> {
		if (owner !== this.owner) return false;
		const e = this.redos.pop();
		if (!e) return false;
		await e.forward();
		this.undos.push(e);
		return true;
	}
}

export const history = new History();

// a page's Ctrl/Cmd+Z and Shift+Z / Y, when the page is the active pane and nothing with its
// own undo (a field, the editor, a menu) has the keyboard
export function undoKey(e: KeyboardEvent, owner: string, root: HTMLElement | null): void {
	if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
	const k = e.key.toLowerCase();
	if (k !== 'z' && k !== 'y') return;
	if (!root?.closest('.content-area.active')) return;
	const a = document.activeElement as HTMLElement | null;
	if (a && (a.matches('input, textarea, select') || a.isContentEditable || a.closest('.editor')))
		return;
	if (document.querySelector('.menu, .pop, .overlay, .ctx-menu, [role="dialog"]')) return;
	e.preventDefault();
	const redo = k === 'y' || e.shiftKey;
	void (redo ? history.redo(owner) : history.undo(owner));
}
