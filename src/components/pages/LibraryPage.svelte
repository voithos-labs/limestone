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
	const recentFace = recentView.addFace('list');
	recentView.faces = [recentFace];
	recentView.state.active_face_id = recentFace.id;
	{
		const updated = recentView.fields.find((f) => f.type === 'updated_at');
		if (updated) recentFace.sort = [{ field_id: updated.id, direction: 'desc' }];
	}

	// Views are a peek, not a list: the most recent dozen, wrapping as they need to.
	const MAX_VIEWS = 12;
	const visibleViews = $derived(savedViews.slice(0, MAX_VIEWS));

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
		loaded = true;
	}

	// The rows' "+" waits for the chips so it can land after them, rather than sitting
	// there alone while they arrive.
	let loaded = $state(false);

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
		return () => {
			unlisten.then((fn) => fn());
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
				<h2 class="sec-title">Recent Views</h2>
				<div class="views-grid">
					{#each visibleViews as v, i (v.id)}
						<button
							class="view-card"
							transition:fly={{ y: 4, duration: 160, delay: i * 25 }}
							onclick={() => openSavedView(v)}
						>
							{#if v.emoji}
								<span class="vc-emoji">{v.emoji}</span>
							{:else}
								<Box size={14} />
							{/if}
							<span class="vc-title">{v.slug}</span>
						</button>
					{/each}
					{#if loaded}
						<button
							class="row-add"
							title="New view"
							in:fly={{ y: 4, duration: 160, delay: visibleViews.length * 25 }}
							onclick={() => editor.openView(View.create('New view'))}
						>
							<Plus size={16} strokeWidth={2} />
						</button>
					{/if}
				</div>
			</section>

			<section class="lib-section">
				<h2 class="sec-title">Sources</h2>
				<div class="views-grid">
					{#each orderedSources as s, i (s.view.id)}
						<div class="card-wrap" transition:fly={{ y: 4, duration: 160, delay: i * 25 }}>
							<button class="view-card has-menu" onclick={() => openSavedView(s.view)}>
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
								onclick={(e) => openSourceMenu(s.source, e)}
							>
								<EllipsisVertical size={14} strokeWidth={1.75} />
							</button>
						</div>
					{/each}
					{#if loaded}
						<button
							class="row-add"
							title="New source"
							in:fly={{ y: 4, duration: 160, delay: orderedSources.length * 25 }}
							onclick={newSource}
						>
							<Plus size={16} strokeWidth={2} />
						</button>
					{/if}
				</div>
			</section>

			<section class="lib-section">
				<h2 class="sec-title">Recent documents</h2>
				<div class="docs-face">
					{#key docsKey}
						<ListFace view={recentView} face={recentFace} onOpenRow={openDoc} createCard />
					{/key}
				</div>
			</section>
		</div>
	</div>
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
		padding: 40px 24px 64px;
	}

	.lib-hero {
		margin-bottom: 22px;
	}

	.search-row {
		display: flex;
		align-items: center;
	}

	/* Bare "+" closing each chip row: no card around it, just the glyph in a square hitbox */
	.row-add {
		align-self: center;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 30px;
		height: 30px;
		padding: 0;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-ui-dulled);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.row-add:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.lib-section {
		margin-top: 20px;
	}

	.sec-title {
		margin: 0 0 6px;
		font-family: var(--font-ui);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-ui-muted);
	}

	/* ── Views (chip-ish cards, styled like the note cards below) ── */
	/* Cards take only the width their content needs, up to a cap: a short view name
       shouldn't be stretched across a column. */
	.views-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.view-card {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 0 1 auto;
		min-width: 0;
		max-width: 220px;
		height: 38px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
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
