<script lang="ts">
	import type EditorState from '$lib/models/EditorState.svelte.js';
	import {
		listSources,
		removeSource,
		setDefaultSource,
		getDefaultSourceId,
		type Source
	} from '$lib/models/Source';
	import DocHandle from '$lib/models/DocHandle';
	import View from '$lib/models/View.svelte';
	import { listen } from '@tauri-apps/api/event';
	import { openPath } from '@tauri-apps/plugin-opener';
	import type { MenuEntry } from '$lib/views/menuTypes';
	import ClockHero from '../ClockHero.svelte';
	import QuickSearch from '../QuickSearch.svelte';
	import SourceDialog from '../SourceDialog.svelte';
	import Menu from '../views/Menu.svelte';
	import ListFace from '../views/faces/ListFace.svelte';
	import {
		Box,
		Plus,
		Folders,
		FilePlus,
		FolderPlus,
		GripVertical,
		EllipsisVertical,
		Pencil,
		Star,
		ExternalLink,
		Trash2
	} from '@lucide/svelte';
	import FoldersStar from '../FoldersStar.svelte';
	import { fly } from 'svelte/transition';
	import { onMount } from 'svelte';

	let { editor }: { editor: EditorState } = $props();

	let savedViews: View[] = $state([]);

	// Every document, newest first, drawn by the list face's grid. A throwaway view:
	// never saved, no filters, just the sort.
	const recentView = View.create('Recent');
	recentView.temporary = true;
	const recentFace = recentView.addFace('grid');
	recentView.faces = [recentFace];
	recentView.state.active_face_id = recentFace.id;
	{
		const updated = recentView.fields.find((f) => f.type === 'updated_at');
		if (updated) recentFace.sort = [{ field_id: updated.id, direction: 'desc' }];
	}

	// Views are a peek, not a list: the few most recent, sharing one row with sources.
	const MAX_VIEWS = 3;
	const visibleViews = $derived(savedViews.slice(0, MAX_VIEWS));

	// The pinned row scrolls horizontally when it overflows
	function onPinnedWheel(e: WheelEvent) {
		const el = e.currentTarget as HTMLElement;
		if (el.scrollWidth <= el.clientWidth) return;
		if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
		el.scrollLeft += e.deltaY;
		e.preventDefault();
	}

	// Edge fade only where there's more to scroll, so a non-overflowing row stays crisp.
	let pinnedEl: HTMLElement | null = $state(null);
	let pinnedAtStart = $state(true);
	let pinnedAtEnd = $state(true);

	function updatePinnedFade() {
		const el = pinnedEl;
		if (!el) return;
		pinnedAtStart = el.scrollLeft <= 1;
		pinnedAtEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth - 1;
	}

	$effect(() => {
		visibleViews;
		orderedSources;
		requestAnimationFrame(updatePinnedFade);
	});

	// Click-and-drag to scroll, matching the journal date strip.
	let pinnedDragMoved = false;

	function pinnedDrag(e: PointerEvent) {
		if (e.button !== 0) return;
		const el = e.currentTarget as HTMLElement;
		pinnedDragMoved = false;
		const baseX = e.clientX;
		const baseScroll = el.scrollLeft;

		function move(ev: PointerEvent) {
			const dx = ev.clientX - baseX;
			if (Math.abs(dx) > 3) pinnedDragMoved = true;
			el.scrollLeft = baseScroll - dx;
		}

		function up() {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		}

		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	// A source is browsable as the view that filters to it, so the row is just views:
	// same card, same open path. Sources are few and none may be hidden, so show them all.
	let sourceViews: { view: View; source: Source }[] = $state([]);

	// Default source leads the row; the rest keep their listed order
	const orderedSources = $derived(
		[...sourceViews].sort(
			(a, b) => Number(b.source.id === defaultSourceId) - Number(a.source.id === defaultSourceId)
		)
	);

	// Remounts the list face so a reconcile (files changed on disk) redraws the cards
	// todo: this may need to be reworked when file watching is configured
	let docsKey = $state(0);

	async function loadRecents() {
		const [saved, sources, defId] = await Promise.all([
			View.listSaved(),
			listSources(),
			getDefaultSourceId()
		]);
		savedViews = saved.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
		sourceViews = sources.map((s) => ({ view: View.createFromSource(s), source: s }));
		defaultSourceId = defId;
	}

	// ── Source options (same menu as Settings) ─────────────────────────────────
	let defaultSourceId: string | null = $state(null);
	let srcMenuOpen = $state(false);
	let srcMenuAnchor: HTMLElement | null = $state(null);
	let menuSource: Source | null = $state(null);
	let confirmingRemove = $state(false);

	$effect(() => {
		if (!srcMenuOpen) confirmingRemove = false;
	});

	const srcMenuItems: MenuEntry[] = $derived([
		{ value: 'edit', label: 'Edit', icon: Pencil },
		{ value: 'reveal', label: 'Reveal in file manager', icon: ExternalLink },
		{
			value: 'default',
			label: menuSource?.id === defaultSourceId ? 'Remove default' : 'Set as default',
			icon: Star
		},
		{ kind: 'divider' },
		confirmingRemove
			? { value: 'confirm-remove', label: 'Confirm remove', icon: Trash2, danger: true }
			: { value: 'remove', label: 'Remove', icon: Trash2, keepOpen: true }
	]);

	function openSourceMenu(s: Source, e: MouseEvent) {
		menuSource = s;
		srcMenuAnchor = e.currentTarget as HTMLElement;
		srcMenuOpen = true;
	}

	async function onSourceMenuSelect(value: string) {
		if (value === 'remove') {
			confirmingRemove = true;
			return;
		}
		srcMenuOpen = false;
		const s = menuSource;
		if (!s) return;
		try {
			if (value === 'edit') {
				dialogMode = 'edit';
				dialogSource = s;
				sourceDialogOpen = true;
			} else if (value === 'reveal') {
				await openPath(s.path);
			} else if (value === 'default') {
				await setDefaultSource(s.id === defaultSourceId ? null : s.id);
				defaultSourceId = await getDefaultSourceId();
			} else if (value === 'confirm-remove') {
				await removeSource(s.id);
				await loadRecents();
				docsKey++;
			}
		} catch (e) {
			console.error('source action failed', e);
		}
	}

	function openSavedView(v: View) {
		const existing = editor.tabs.find(
			(t) => t.content.type === 'view' && t.content.view.id === v.id
		);
		if (existing) {
			editor.focusTab({ kind: 'tab', id: existing.id });
			return;
		}
		v.state.filters_collapsed = true;
		editor.openView(v);
	}

	let sourceDialogOpen = $state(false);
	let dialogMode: 'create' | 'edit' = $state('create');
	let dialogSource: Source | null = $state(null);

	function newSource() {
		dialogMode = 'create';
		dialogSource = null;
		sourceDialogOpen = true;
	}

	function newView() {
		const v = View.create('New view');
		v.state.filters_collapsed = true;
		editor.openView(v);
	}

	async function newDocument() {
		const doc = await DocHandle.createDraft();
		if (doc) editor.openDoc(doc);
		else newSource();
	}

	let newMenuOpen = $state(false);
	let newMenuAnchor: HTMLElement | null = $state(null);
	const newMenuItems: MenuEntry[] = [
		{ value: 'doc', label: 'New document', icon: FilePlus },
		{ value: 'view', label: 'New view', icon: Box },
		{ value: 'source', label: 'New source', icon: FolderPlus }
	];

	function onNewMenuSelect(v: string) {
		newMenuOpen = false;
		if (v === 'doc') newDocument();
		else if (v === 'view') newView();
		else if (v === 'source') newSource();
	}

	async function openDoc(id: string) {
		const existing = editor.tabs.find((t) => t.id === id);
		if (existing) {
			editor.focusTab({ kind: 'tab', id: existing.id });
			return;
		}
		const doc = await DocHandle.fromID(id);
		editor.openDoc(doc);
	}

	onMount(() => {
		loadRecents();
		const unlisten = listen('source-reconciled', () => {
			loadRecents();
			docsKey++;
		});
		window.addEventListener('resize', updatePinnedFade);
		return () => {
			unlisten.then((fn) => fn());
			window.removeEventListener('resize', updatePinnedFade);
		};
	});
</script>

<div class="library-page">
	<div class="library">
		<div class="lib-inner">
			<div class="lib-hero">
				<ClockHero animateIn={false} />
			</div>
			<div class="search-row">
				<QuickSearch {editor} />
			</div>
			<SourceDialog
				bind:open={sourceDialogOpen}
				mode={dialogMode}
				source={dialogSource}
				onSaved={loadRecents}
			/>
			<Menu
				bind:open={srcMenuOpen}
				anchor={srcMenuAnchor}
				items={srcMenuItems}
				onSelect={onSourceMenuSelect}
				minWidth={190}
			/>

			<section class="lib-section">
				<div
					class="pinned-row"
					class:fade-start={!pinnedAtStart}
					class:fade-end={!pinnedAtEnd}
					bind:this={pinnedEl}
					onwheel={onPinnedWheel}
					onscroll={updatePinnedFade}
					onpointerdown={pinnedDrag}
				>
					{#each visibleViews as v, i (v.id)}
						<button
							class="view-card"
							transition:fly={{ y: 4, duration: 160, delay: i * 25 }}
							onclick={() => !pinnedDragMoved && openSavedView(v)}
						>
							{#if v.emoji}
								<span class="vc-emoji">{v.emoji}</span>
							{:else}
								<Box size={14} />
							{/if}
							<span class="vc-title">{v.slug}</span>
						</button>
					{/each}

					{#if visibleViews.length > 0 && orderedSources.length > 0}
						<span class="pinned-handle" title="Drag to scroll" aria-hidden="true">
							<GripVertical size={14} strokeWidth={1.75} />
						</span>
					{/if}

					{#each orderedSources as s, i (s.view.id)}
						<div class="card-wrap" transition:fly={{ y: 4, duration: 160, delay: i * 25 }}>
							<button
								class="view-card has-menu"
								onclick={() => !pinnedDragMoved && openSavedView(s.view)}
							>
								{#if s.source.id === defaultSourceId}
									<FoldersStar size={14} />
								{:else}
									<Folders size={14} />
								{/if}
								<span class="vc-title">{s.view.slug}</span>
							</button>
							<button
								class="card-kebab"
								title="Source options"
								onclick={(e) => !pinnedDragMoved && openSourceMenu(s.source, e)}
							>
								<EllipsisVertical size={14} strokeWidth={1.75} />
							</button>
						</div>
					{/each}
				</div>
			</section>

			<section class="lib-section">
				<div class="docs-face">
					{#key docsKey}
						<ListFace view={recentView} face={recentFace} onOpenRow={openDoc} />
					{/key}
				</div>
			</section>
		</div>
	</div>

	<button
		class="new-fab"
		type="button"
		title="New"
		bind:this={newMenuAnchor}
		onclick={() => (newMenuOpen = !newMenuOpen)}
	>
		<Plus size={18} strokeWidth={2} />
	</button>
	<Menu
		bind:open={newMenuOpen}
		anchor={newMenuAnchor}
		items={newMenuItems}
		onSelect={onNewMenuSelect}
		minWidth={170}
	/>
</div>

<style>
	.library-page {
		position: relative;
		height: 100%;
		overflow: hidden;
	}

	.library {
		height: 100%;
		overflow-y: auto;
		scrollbar-width: none;
	}

	.library::-webkit-scrollbar {
		display: none;
	}

	.lib-inner {
		max-width: var(--page-max-width, 900px);
		margin: 0 auto;
		padding: 44px 24px 64px;
	}

	.lib-hero {
		margin-bottom: 30px;
	}

	.search-row {
		display: flex;
		align-items: center;
	}

	/* Bare "+" closing each chip row: no card around it, just the glyph in a square hitbox */
	.new-fab {
		position: absolute;
		bottom: 24px;
		right: calc(24px + max(0px, (100% - var(--page-max-width, 900px)) / 2));
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border: none;
		border-radius: 10px;
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		cursor: pointer;
		box-shadow: var(--menu-shadow);
	}

	.new-fab:hover {
		filter: brightness(1.08);
	}

	.lib-section {
		margin-top: 20px;
	}

	/* ── Pinned row: recent views + sources, scrolls sideways instead of wrapping ── */
	.pinned-row {
		--fade-l: 0px;
		--fade-r: 0px;
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: 10px;
		overflow-x: auto;
		scrollbar-width: none;
		touch-action: none;
		user-select: none;
		-webkit-mask-image: linear-gradient(
			to right,
			transparent,
			#000 var(--fade-l),
			#000 calc(100% - var(--fade-r)),
			transparent
		);
		mask-image: linear-gradient(
			to right,
			transparent,
			#000 var(--fade-l),
			#000 calc(100% - var(--fade-r)),
			transparent
		);
	}

	.pinned-row.fade-start {
		--fade-l: 24px;
	}

	.pinned-row.fade-end {
		--fade-r: 24px;
	}

	.pinned-row::-webkit-scrollbar {
		display: none;
	}

	.pinned-handle {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin: 0 1px;
		color: var(--color-ui-dulled);
		cursor: grab;
	}

	.pinned-handle:active {
		cursor: grabbing;
	}

	.view-card {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 0 0 auto;
		min-width: 0;
		max-width: 220px;
		height: 36px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-primary);
		cursor: pointer;
		text-align: left;
		font-family: var(--font-ui);
		transition: background-color 120ms ease;
	}

	.view-card:hover {
		background: var(--row-hover-bg, rgba(127, 127, 127, 0.06));
	}

	.view-card :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.vc-emoji {
		font-size: 14px;
		line-height: 1;
		flex-shrink: 0;
	}

	.vc-title {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		font-weight: 500;
	}

	/* A card that carries its own options button: the kebab can't nest inside the
       card's <button>, so it sits over it. */
	.card-wrap {
		position: relative;
		flex-shrink: 0;
		min-width: 0;
		max-width: 220px;
	}

	.card-wrap .view-card {
		width: 100%;
		max-width: none;
	}

	.view-card.has-menu {
		padding-right: 32px;
	}

	.card-kebab {
		position: absolute;
		top: 50%;
		right: 6px;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-dulled);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.card-kebab:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	/* The list face carries its own 24px side margin (it sits flush in a view page),
       so pull it back out to line the cards up with the views grid above. */
	.docs-face {
		margin: 0 -24px;
	}
</style>
