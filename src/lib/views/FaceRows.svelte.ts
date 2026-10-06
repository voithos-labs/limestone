import { reportError } from '$lib/errors';
import { addSourceRequest } from '$lib/addSource.svelte';
import type View from '$lib/models/View.svelte';
import type { FilterNode, MemberRow, SortKey, ViewField } from '$lib/models/View.svelte';
import {
	describeBulkFailure,
	isBuiltinUnit,
	isLeafActive,
	ViewFace
} from '$lib/models/View.svelte';
import {
	createMetaDate,
	deriveCreateContext,
	folderPath,
	type CreateContext
} from '$lib/views/createDefaults';
import { rawStatefulValue, seedProperties, withStatefulValue } from '$lib/views/fieldValue';
import { listInlineByDefault } from '$lib/views/listLayout';
import { select } from '$lib/services/db';
import { searchDocuments } from '$lib/services/search';
import type { SearchResult } from '$lib/types/SearchResult';
import {
	getDefaultSourceId,
	listSources,
	pickCreationSource,
	type Source
} from '$lib/models/Source';
import Folder, { folderIdPath } from '$lib/models/Folder';
import DocHandle from '$lib/models/DocHandle';
import { sanitizeSegment } from '$lib/util/paths';
import { tagId } from '$lib/models/Tag';
import { invoke } from '@tauri-apps/api/core';
import { toasts, mark } from '$lib/toasts.svelte';

export type RowTag = { id: string; slug: string };

const PAGE = 100;

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
		return first?.type === 'boolean' ? first : null;
	}

	get lanes(): { inline: ViewField[]; meta: ViewField[] } {
		const rest = this.checkField ? this.shown.slice(1) : this.shown;
		const rightIds = this.face().config.right as string[] | undefined;
		const isRight = (f: ViewField) =>
			rightIds ? rightIds.includes(f.id) : !listInlineByDefault(f.type);
		return { inline: rest.filter((f) => !isRight(f)), meta: rest.filter(isRight) };
	}

	// ── Mutations ────────────────────────────────────────────────────────────
	// a field the view filters or sorts on changes membership or order, so reload after
	fieldAffectsView(fieldId: string): boolean {
		const hit = (n: FilterNode): boolean =>
			'children' in n
				? n.children.some(hit)
				: n.field_id === fieldId && isLeafActive(n.op, n.value);
		if (hit(this.view().filter) || hit(this.face().additive_filter)) return true;
		return this.face().sort.some((s) => s.field_id === fieldId);
	}

	// the rows as the reader dragged them; the face's owner persists the order
	reorder(ids: string[]): void {
		const byId = new Map(this.rows.map((r) => [r.id, r]));
		this.rows = ids.map((id) => byId.get(id)).filter((r): r is MemberRow => !!r);
	}

	patchRow(id: string, patch: Partial<MemberRow>): void {
		this.rows = this.rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
	}

	async writeCell(row: MemberRow, field: ViewField, value: unknown): Promise<void> {
		if (!this.writable(row)) return;
		const before = row.properties;
		this.patchRow(row.id, { properties: withStatefulValue(before, field, value) });
		try {
			const result = await this.view().writeFieldValue(row.source_id, field, value, [row.id]);
			if (result.failed > 0) {
				this.patchRow(row.id, { properties: before });
				toasts.push(describeBulkFailure(result), {
					action: { label: 'Retry', run: () => this.writeCell(row, field, value) }
				});
			} else if (this.fieldAffectsView(field.id)) {
				this.load(true);
			}
		} catch (e) {
			this.patchRow(row.id, { properties: before });
			reportError(e, `${mark('note', row.title)} couldn't be saved.`, () =>
				this.writeCell(row, field, value)
			);
		}
	}

	toggle(row: MemberRow, field: ViewField): void {
		if (!this.writable(row)) return;
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
