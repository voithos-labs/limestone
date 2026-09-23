<script lang="ts">
	import { FilePlus, LayoutPanelTop, FolderInput, Bookmark, TextAlignStart } from '@lucide/svelte';
	import type { Component } from 'svelte';
	import type EditorState from '$lib/models/EditorState.svelte.js';
	import DocHandle from '$lib/models/DocHandle';
	import View from '$lib/models/View.svelte';
	import { listSources, sourceName, type Source } from '$lib/models/Source';
	import { folderIdSource } from '$lib/models/Folder';
	import { select } from '$lib/services/db';
	import { getViewIcon } from '$lib/views/filterDisplay';
	import { formatDateFriendly } from '$lib/views/dateFormat';
	import { openProjectSetup } from '$lib/views/projectSetup';
	import { toasts } from '$lib/toasts.svelte';

	// Where the app lands when no tab is open: what you can start, and what you were in
	let { editor, onAddSource }: { editor: EditorState; onAddSource?: () => void } = $props();

	type Recent = {
		id: string;
		title: string;
		rel_path: string;
		source_id: string;
		updated_at: number;
	};

	let projects: View[] = $state([]);
	let recent: Recent[] = $state([]);
	let sources: Source[] = $state([]);

	$effect(() => {
		listSources()
			.then((s) => (sources = s))
			.catch(() => {});
		View.listSaved()
			.then((all) => {
				projects = all.sort((a, b) => b.accessedAt.getTime() - a.accessedAt.getTime()).slice(0, 6);
			})
			.catch((e) => console.error('home projects failed', e));
		select<Recent>(
			`SELECT id, title, rel_path, source_id, updated_at FROM documents
			 WHERE deleted_at IS NULL ORDER BY accessed_at DESC LIMIT 5`
		)
			.then((r) => (recent = r))
			.catch((e) => console.error('home recents failed', e));
	});

	function where(r: Recent): string {
		const src = sources.find((s) => s.id === r.source_id);
		const dir = r.rel_path.split('/').slice(0, -1).join(' / ');
		return [src ? sourceName(src) : '', dir].filter(Boolean).join(' / ');
	}

	async function newNote() {
		const doc = await DocHandle.createDraft();
		if (doc) editor.openDoc(doc);
		else toasts.push('Add a source before creating a document.');
	}

	const actions: { label: string; hint: string; icon: Component; run: () => void }[] = [
		{
			label: 'New note',
			hint: 'A blank note in your default source',
			icon: FilePlus,
			run: newNote
		},
		{
			label: 'New project',
			hint: 'A journal, a todo list, a place for notes',
			icon: LayoutPanelTop,
			run: () => openProjectSetup(editor)
		},
		{
			label: 'Add source',
			hint: 'Point Limestone at a folder of markdown',
			icon: FolderInput,
			run: () => onAddSource?.()
		}
	];

	async function openNote(id: string) {
		try {
			editor.openDoc(await DocHandle.fromID(id));
		} catch (e) {
			console.error('open note failed', e);
		}
	}
</script>

<div class="home">
	<div class="inner">
		<p class="eyebrow">Limestone</p>

		<div class="cards">
			{#each actions as a (a.label)}
				{@const Icon = a.icon}
				<button class="card" type="button" onclick={a.run}>
					<span class="card-icon"><Icon size={18} strokeWidth={1.5} /></span>
					<span class="card-label">{a.label}</span>
					<span class="card-hint">{a.hint}</span>
				</button>
			{/each}
		</div>

		{#if projects.length}
			<p class="sec">Projects</p>
			<div class="chips">
				{#each projects as v (v.id)}
					{@const Icon = getViewIcon(v)}
					<button class="chip" type="button" onclick={() => editor.openView(v)}>
						{#if v.emoji}
							<span class="chip-emoji">{v.emoji}</span>
						{:else}
							<Icon size={15} strokeWidth={1.75} />
						{/if}
						<span class="chip-name">{v.slug}</span>
						{#if v.unit?.startsWith('folder:')}
							{@const src = sources.find((s) => s.id === folderIdSource(v.unit ?? ''))}
							{#if src}<span class="chip-where">{sourceName(src)}</span>{/if}
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		{#if recent.length}
			<p class="sec">Recent</p>
			<div class="rows">
				{#each recent as r (r.id)}
					<button class="row" type="button" onclick={() => openNote(r.id)}>
						<TextAlignStart size={14} strokeWidth={1.75} />
						<span class="row-title">{r.title}</span>
						<span class="row-where">{where(r)}</span>
						<span class="row-when">{formatDateFriendly(r.updated_at)}</span>
					</button>
				{/each}
			</div>
		{:else if !projects.length}
			<p class="empty">
				<Bookmark size={14} strokeWidth={1.75} />
				Add a source to get started.
			</p>
		{/if}
	</div>
</div>

<style>
	.home {
		height: 100%;
		overflow-y: auto;
		scrollbar-width: none;
		font-family: var(--font-ui);
		color: var(--color-text-primary);
	}

	.home::-webkit-scrollbar {
		display: none;
	}

	.inner {
		max-width: 720px;
		margin: 0 auto;
		padding: 12vh 24px 48px;
	}

	.eyebrow {
		margin: 0 0 18px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-ui-muted);
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
	}

	.card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		min-height: 96px;
		padding: 14px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: transparent;
		font: inherit;
		text-align: left;
		color: inherit;
		cursor: pointer;
		transition: background-color 100ms ease;
	}

	.card:hover {
		background: var(--chip-bg);
	}

	.card-icon {
		display: inline-flex;
		margin-bottom: 7px;
		color: var(--color-ui-muted);
	}

	.card:hover .card-icon {
		color: var(--color-accent);
	}

	.card-label {
		font-size: 13.5px;
		font-weight: 600;
	}

	.card-hint {
		font-size: 12px;
		line-height: 1.4;
		color: var(--color-ui-muted);
	}

	.sec {
		margin: 28px 2px 10px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-ui-muted);
	}

	.chips {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 10px;
	}

	.chip {
		display: flex;
		align-items: center;
		gap: 9px;
		height: 40px;
		padding: 0 12px;
		border: none;
		border-radius: 8px;
		background: var(--chip-bg);
		font: inherit;
		font-size: 13px;
		color: inherit;
		text-align: left;
		cursor: pointer;
		transition: background-color 80ms ease;
	}

	.chip:hover {
		background: var(--chip-bg-hover);
	}

	.chip :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.chip-emoji {
		width: 16px;
		text-align: center;
		font-size: 14px;
		line-height: 1;
	}

	.chip-name {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.chip-where {
		margin-left: auto;
		padding-left: 8px;
		font-size: 11px;
		color: var(--color-ui-muted);
	}

	.rows {
		display: flex;
		flex-direction: column;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 36px;
		margin: 0 -10px;
		padding: 0 10px;
		border: none;
		border-radius: 8px;
		background: transparent;
		font: inherit;
		font-size: 13.5px;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.row:hover {
		background: var(--row-hover-bg, rgba(127, 127, 127, 0.06));
	}

	.row :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.row-title {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.row-where,
	.row-when {
		font-size: 12px;
		color: var(--color-ui-muted);
		white-space: nowrap;
	}

	.row-where {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.row-when {
		margin-left: auto;
		padding-left: 10px;
	}

	.empty {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 28px 2px 0;
		font-size: 13px;
		color: var(--color-ui-muted);
	}
</style>
