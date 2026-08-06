<script lang="ts">
	import type View from '$lib/models/View.svelte';
	import type { ViewFace, FilterNode, MemberRow } from '$lib/models/View.svelte';
	import { TabState } from '$lib/models/EditorState.svelte.js';
	import DocHandle from '$lib/models/DocHandle';
	import { getDefaultSourceId, listSources, pickCreationSource } from '$lib/models/Source';
	import {
		createMetaDate,
		deriveCreateContext,
		folderPath,
		folderLinkChain
	} from '$lib/views/createDefaults';
	import Group, { GroupType } from '$lib/models/Group';
	import type { DocPicker } from '$lib/views/docPicker.svelte';
	import { searchDocuments } from '$lib/services/search';
	import type { SearchResult } from '$lib/types/SearchResult';
	import MarkdownEditor from '../../editor/MarkdownEditor.svelte';
	import { untrack } from 'svelte';

	let {
		view,
		face,
		flow = false,
		scope = null,
		queryScope,
		labels = {},
		picker,
		tab,
		onCreated,
		onPicked
	}: {
		view: View;
		face: ViewFace;
		flow?: boolean;
		scope?: FilterNode | null;
		queryScope?: FilterNode | null;
		labels?: { newTitle?: string; empty?: string; create?: string };
		picker?: DocPicker;
		tab?: TabState;
		onCreated?: (rowId: string) => void;
		onPicked?: (rowId: string) => void | Promise<void>;
	} = $props();

	const query = $derived((view.state.search as string | undefined) ?? '');

	let rows = $state<SearchResult[]>([]);
	let rowsLoaded = $state(false);
	let searchRows = $state<SearchResult[]>([]);
	let loadGen = 0;

	function asResult(row: MemberRow): SearchResult {
		return {
			id: row.id,
			title: row.title ?? 'untitled',
			rel_path: row.rel_path,
			source_id: row.source_id,
			score: 0,
			match_indices: [],
			kind: 'document',
			group_type: null
		};
	}

	// Idle lists the scope in the face's own sort order.
	async function load() {
		const gen = ++loadGen;
		try {
			const next = (await view.getMembers({ face, scope, limit: 100 })).map(asResult);
			if (gen !== loadGen) return;
			rows = next;
			rowsLoaded = true;
		} catch (e) {
			console.error('doc face load failed', e);
		}
	}

	let loadTimer: ReturnType<typeof setTimeout> | null = null;

	// Compiling the scope up front is also how this subscribes: it reads the view filter,
	// the face filter and the scope, and face.sort orders the list.
	$effect(() => {
		void view.searchScope({ face, scope });
		void face.sort;
		if (loadTimer) clearTimeout(loadTimer);
		loadTimer = setTimeout(load, 0);
		return () => {
			if (loadTimer) clearTimeout(loadTimer);
		};
	});

	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	// a query hands off to FTS, which searches the whole scope rather than whatever the
	// idle list happened to load
	$effect(() => {
		const q = query.trim();
		if (searchTimer) clearTimeout(searchTimer);
		if (!q) {
			searchRows = [];
			return;
		}
		const searchScope = view.searchScope({
			face,
			scope: queryScope === undefined ? scope : queryScope
		});
		searchTimer = setTimeout(async () => {
			try {
				const next = await searchDocuments(q, searchScope);
				if (query.trim() === q) searchRows = next;
			} catch (e) {
				console.error('doc face search failed', e);
			}
		}, 120);
		return () => {
			if (searchTimer) clearTimeout(searchTimer);
		};
	});

	const pickedId = $derived(picker?.activeId ?? null);
	const activeDocId = $derived(pickedId ?? (rowsLoaded ? (rows[0]?.id ?? null) : null));
	let pickPinned = $state(false);

	$effect(() => {
		if (!picker) return;
		picker.results = (query.trim() ? searchRows : rows).slice(0, 25);
	});

	// Nothing is picked until you pick something, but a document is on screen the whole
	// time. Resolving the fallback back into the picker is what marks it as current. A
	// pick that falls out of scope (the journal moving day) drops back to the first row.
	$effect(() => {
		if (!picker || !rowsLoaded || query.trim()) return;
		const id = picker.activeId;
		if (id && rows.some((r) => r.id === id)) {
			pickPinned = false;
			return;
		}
		if (id && pickPinned) {
			const gen = loadGen;
			view.getMembers({ face, scope, ids_in: [id] })
				.then((members) => {
					if (gen !== loadGen || picker.activeId !== id) return;
					if (members.length === 0) {
						pickPinned = false;
						picker.activeId = rows[0]?.id ?? null;
					}
				})
				.catch(() => {});
			return;
		}
		const first = rows[0]?.id ?? null;
		if (picker.activeId !== first) picker.activeId = first;
	});

	$effect(() => {
		if (!picker) return;
		picker.onPick = (id: string) => {
			if (!rows.some((r) => r.id === id)) pickPinned = true;
			Promise.resolve(onPicked?.(id)).finally(() => {
				if (view.state.search) view.state.search = '';
			});
		};
		return () => {
			picker.onPick = null;
		};
	});

	$effect(() => {
		if (!picker) return;
		picker.create = (title?: string) => createDoc(title);
		return () => {
			picker.create = null;
		};
	});

	let docTab: TabState | null = $state(null);

	function docStateFor(id: string): Record<string, any> {
		if (!tab) return {};
		const docs = (tab.state.docs ??= {});
		const bag = (docs[id] ??= {});
		if (bag.zoom === undefined && typeof tab.state.doc_zoom === 'number')
			bag.zoom = tab.state.doc_zoom;
		return bag;
	}

	$effect(() => {
		const id = activeDocId;
		if (!id) {
			docTab = null;
			return;
		}
		if (untrack(() => docTab)?.handle?.id === id) return;
		let cancelled = false;
		DocHandle.fromID(id)
			.then((h) => {
				if (cancelled) return;
				docTab = new TabState({ type: 'markdown', handle: h }, docStateFor(h.id));
			})
			.catch((e) => console.error('open doc failed', e));
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const z = docTab?.state.zoom;
		if (tab && typeof z === 'number' && tab.state.doc_zoom !== z) tab.state.doc_zoom = z;
	});

	let folders = $state<Group[]>([]);
	Group.list()
		.then((gs) => (folders = gs.filter((g) => g.groupType === GroupType.Folder)))
		.catch(() => {});

	let creating = $state(false);
	async function createDoc(title?: string) {
		if (creating) return;
		creating = true;
		try {
			const ctx = deriveCreateContext(view, face, folders, scope);
			const folderId = ctx.folderGroupId;
			const sources = await listSources();
			let source = ctx.sourceId ? sources.find((s) => s.id === ctx.sourceId) : undefined;
			if (!source && folderId) {
				const g = folders.find((f) => f.id === folderId);
				source = g?.sourceId ? sources.find((s) => s.id === g.sourceId) : undefined;
			}
			source = source ?? pickCreationSource(sources, await getDefaultSourceId());
			if (!source) return;

			const dir = folderId ? folderPath(folderId, folders) : '';
			const groupIds = [
				...(folderId ? folderLinkChain(folderId, folders) : []),
				...ctx.tagGroupIds
			];
			const properties = Object.keys(ctx.fieldValues).length
				? { views: { [view.slug]: ctx.fieldValues } }
				: {};

			const doc = await DocHandle.createFromTitle(source, {
				title: title?.trim() || labels.newTitle || 'Untitled',
				dir,
				groupIds,
				properties
			});
			// keep the doc inside the scope it was created from (e.g. a journal's day)
			const createdAt = createMetaDate(ctx, 'created_at');
			const updatedAt = createMetaDate(ctx, 'updated_at');
			if (createdAt || updatedAt) {
				await doc.saveMeta({
					createdAt: createdAt ?? undefined,
					updatedAt: updatedAt ?? undefined
				});
			}
			if (folderId)
				folders
					.find((f) => f.id === folderId)
					?.touch()
					.catch(() => {});
			if (view.state.search) view.state.search = '';
			await load();
			picker?.pick(doc.id);
			onCreated?.(doc.id);
		} catch (e) {
			console.error('create doc failed', e);
		} finally {
			creating = false;
		}
	}
</script>

<div class="doc-face" class:flow>
	{#if docTab}
		{#key docTab.id}
			<MarkdownEditor tab={docTab} {flow} />
		{/key}
	{:else}
		<div class="doc-empty">
			<p>{labels.empty ?? 'No document here'}</p>
			<button class="create-doc" type="button" disabled={creating} onclick={() => createDoc()}
				>{labels.create ?? 'Create document'}</button
			>
		</div>
	{/if}
</div>

<style>
	.doc-face {
		position: relative;
		padding: 0 24px;
	}

	.doc-face.flow {
		min-height: calc(100vh - 180px);
	}

	.doc-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding-top: 40px;
		color: var(--color-ui-muted);
	}

	.doc-empty p {
		margin: 0;
		font-size: 13px;
	}

	.create-doc {
		padding: 7px 14px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 13px;
		cursor: pointer;
	}

	.create-doc:hover {
		color: var(--color-text-primary);
		background: var(--chip-bg);
	}

	.create-doc:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
