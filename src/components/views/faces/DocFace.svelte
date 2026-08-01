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
	import { searchDocuments, type SearchScope } from '$lib/services/search';
	import type { SearchResult } from '$lib/types/SearchResult';
	import DocumentEditor from '../../editor/DocumentEditor.svelte';

	let {
		view,
		face,
		flow = false,
		scope = null,
		labels = {},
		picker,
		tab,
		onCreated
	}: {
		view: View;
		face: ViewFace;
		flow?: boolean;
		scope?: FilterNode | null;
		labels?: { newTitle?: string; empty?: string; create?: string };
		picker?: DocPicker;
		tab?: TabState;
		onCreated?: (rowId: string) => void;
	} = $props();

	let docEditor: DocumentEditor | undefined = $state();

	const query = $derived((view.state.search as string | undefined) ?? '');

	let rows = $state<SearchResult[]>([]);
	let rowsLoaded = $state(false);

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

	// Idle lists the scope in the face's own sort order; a query hands off to FTS, which
	// searches the whole scope rather than whatever the idle list happened to load.
	async function load(q = query.trim(), searchScope?: SearchScope) {
		try {
			rows = q
				? await searchDocuments(q, searchScope ?? view.searchScope({ face, scope }))
				: (await view.getMembers({ face, scope, limit: 100 })).map(asResult);
			rowsLoaded = true;
		} catch (e) {
			console.error('doc face load failed', e);
		}
	}

	let loadTimer: ReturnType<typeof setTimeout> | null = null;

	// Compiling the scope up front is also how this subscribes: it reads the view filter,
	// the face filter and the scope, and face.sort orders the idle list. Only typing waits.
	$effect(() => {
		const q = query.trim();
		const args = { q, searchScope: view.searchScope({ face, scope }), sort: face.sort };
		if (loadTimer) clearTimeout(loadTimer);
		loadTimer = setTimeout(() => load(args.q, args.searchScope), q ? 120 : 0);
		return () => {
			if (loadTimer) clearTimeout(loadTimer);
		};
	});

	// a pick that falls out of scope (the journal moving day) drops back to the first row
	const pickedId = $derived(picker?.activeId ?? null);
	const activeRow = $derived(rows.find((r) => r.id === pickedId) ?? rows[0] ?? null);

	$effect(() => {
		if (!picker) return;
		picker.results = rows.slice(0, 25);
	});

	// Nothing is picked until you pick something, but a document is on screen the whole
	// time. Resolving the fallback back into the picker is what marks it as current.
	$effect(() => {
		if (!picker || !rowsLoaded) return;
		const id = activeRow?.id ?? null;
		if (picker.activeId !== id) picker.activeId = id;
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
		const target = activeRow;
		if (!target) {
			docTab = null;
			return;
		}
		let cancelled = false;
		DocHandle.fromID(target.id)
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

<!-- Mouse-only, like the editor's own dead-space gesture; keyboard reaches the entry via focus. -->
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div
	class="doc-face"
	class:flow
	onclick={(e) => {
		// Only below the entry, where the in-editor dead-space gesture cannot reach; side gutters
		// stay inert rather than teleporting the caret to the end.
		if (!flow || e.target !== e.currentTarget) return;
		const editorEl = (e.currentTarget as HTMLElement).querySelector('.editor');
		if (editorEl && e.clientY <= editorEl.getBoundingClientRect().bottom) return;
		void docEditor?.focusEntryEnd();
	}}
>
	{#if docTab}
		{#key docTab.id}
			<DocumentEditor bind:this={docEditor} tab={docTab} {flow} />
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
