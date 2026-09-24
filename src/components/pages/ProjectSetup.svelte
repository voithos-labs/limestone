<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		LayoutPanelTop,
		NotebookText,
		SquareCheck,
		LayoutGrid,
		List,
		FileText,
		Folder as FolderIcon,
		FolderInput,
		Hash,
		ChevronDown,
		Globe
	} from '@lucide/svelte';
	import type { Component } from 'svelte';
	import type EditorState from '$lib/models/EditorState.svelte.js';
	import { TabState } from '$lib/models/EditorState.svelte.js';
	import View, { ViewFace, sanitizeName } from '$lib/models/View.svelte';
	import type { ViewFieldType } from '$lib/models/View.svelte';
	import Folder, { folderIdPath, folderIdSource, isSourceRoot } from '$lib/models/Folder';
	import { listSources, getDefaultSourceId, sourceName, type Source } from '$lib/models/Source';
	import { toasts } from '$lib/toasts.svelte';
	import { palette } from '$lib/palette.svelte';
	import Menu from '../views/Menu.svelte';
	import EmojiPicker from '../views/EmojiPicker.svelte';
	import { dashboardSections } from '$lib/views/dashboard';

	let { tab, editor }: { tab: TabState; editor: EditorState } = $props();

	// setting up an existing place (folder, tag, source) rather than making a new one
	const unitId = $derived(tab.state.unit as string | undefined);
	const unitName = $derived((tab.state.unit_name as string | undefined) ?? '');
	const unitKind = $derived(
		!unitId ? null : unitId.startsWith('tag:') ? 'tag' : isSourceRoot(unitId) ? 'source' : 'folder'
	);
	const UnitIcon = $derived(
		unitKind === 'tag' ? Hash : unitKind === 'source' ? FolderInput : FolderIcon
	);

	// ── The new-project inputs ────────────────────────────────────────────────
	let name = $state('');
	let emoji = $state('');
	let emojiOpen = $state(false);
	let emojiAnchor: HTMLElement | null = $state(null);
	let nameEl: HTMLInputElement | null = $state(null);
	let sources: Source[] = $state([]);
	let sourceId = $state('');
	let sourceOpen = $state(false);
	let sourceEl: HTMLElement | null = $state(null);
	let busy = $state(false);

	const source = $derived(sources.find((s) => s.id === sourceId) ?? null);

	// a project makes a folder, so the name has to be free at the source's root
	let folders: Folder[] = $state([]);
	const slug = $derived(sanitizeName(name));
	const taken = $derived(
		!unitId && !!slug && folders.some((f) => f.sourceId === sourceId && folderIdPath(f.id) === slug)
	);
	const ready = $derived(!!unitId || (!!slug && !!sourceId && !taken));
	const where = $derived.by(() => {
		if (!unitId) return '';
		const parts = [
			sourceName(sources.find((s) => s.id === folderIdSource(unitId)) ?? { path: '', title: '' })
		];
		if (unitKind === 'folder') {
			const dir = folderIdPath(unitId).split('/').slice(0, -1).join(' / ');
			if (dir) parts.push(dir);
		}
		return unitKind === 'tag' ? 'tag' : parts.filter(Boolean).join(' / ');
	});

	$effect(() => {
		untrack(async () => {
			const [all, def, dirs] = await Promise.all([
				listSources(),
				getDefaultSourceId(),
				Folder.list().catch(() => [])
			]);
			sources = all;
			folders = dirs;
			sourceId = def ?? all[0]?.id ?? '';
			if (!unitId) {
				await tick();
				nameEl?.focus();
			}
		});
	});

	// ── Templates ─────────────────────────────────────────────────────────────
	type Template = { id: string; label: string; hint: string; icon: Component };
	const TEMPLATES: Template[] = [
		{
			id: 'project',
			label: 'Project',
			hint: 'Todos, documents and folders on one page',
			icon: LayoutPanelTop
		},
		{ id: 'todo', label: 'Todo list', hint: 'Tasks with due dates', icon: SquareCheck },
		{ id: 'journal', label: 'Journal', hint: 'A day at a time', icon: NotebookText },
		{ id: 'notes', label: 'Notes', hint: 'Everything as a list', icon: List },
		{ id: 'grid', label: 'Grid', hint: 'Everything as cards', icon: LayoutGrid },
		{ id: 'blank', label: 'Blank', hint: 'Start from nothing', icon: FileText }
	];
	let picked = $state(0);

	const TODO = 'tag:todo';

	function applyTemplate(view: View, id: string) {
		const of = (t: ViewFieldType) => view.fields.find((f) => f.type === t)?.id ?? '';
		const title = of('title');
		const tags = of('tags');
		const updated = of('updated_at');
		const keep = (ids: string[]) => ids.filter(Boolean);
		switch (id) {
			case 'project': {
				const dash = ViewFace.create('dashboard');
				dash.config.sections = dashboardSections(dash).map((s) =>
					s.id === 'done' ? { ...s, hidden: true } : s
				);
				const tasks = ViewFace.create(
					'list',
					keep([`${TODO}/done`, title, tags, `${TODO}/due`]),
					{ op: 'and', children: [{ field_id: tags, op: 'has_any', value: [TODO] }] },
					[{ field_id: `${TODO}/due`, direction: 'asc', nulls: 'last' }],
					{ right: [tags, `${TODO}/due`], hide_tag: TODO, edit_in_place: true }
				);
				tasks.name = 'Tasks';
				const docs = ViewFace.create(
					'list',
					keep([title, tags, updated]),
					{ op: 'and', children: [{ field_id: tags, op: 'has_none', value: [TODO] }] },
					[],
					{ layout: 'grid' }
				);
				docs.name = 'Documents';
				view.faces = [dash, tasks, docs];
				break;
			}
			case 'todo':
				view.faces = [
					ViewFace.create(
						'list',
						keep([`${TODO}/done`, title, tags, `${TODO}/due`]),
						{ op: 'and', children: [{ field_id: tags, op: 'has_any', value: [TODO] }] },
						[{ field_id: `${TODO}/due`, direction: 'asc', nulls: 'last' }],
						{
							right: [`${TODO}/due`],
							hide_tag: TODO,
							edit_in_place: true,
							group_by: `${TODO}/done`
						}
					)
				];
				break;
			case 'journal':
				view.faces = [ViewFace.create('journal', keep([title, tags, updated]))];
				break;
			case 'grid':
				view.faces = [
					ViewFace.create('list', keep([title, tags, updated]), undefined, [], { layout: 'grid' })
				];
				break;
			case 'blank':
				view.faces = [ViewFace.create('list', keep([title]))];
				break;
			default:
				view.faces = [ViewFace.create('list', keep([title, tags, updated]))];
		}
		view.state.active_face_id = view.faces[0].id;
	}

	async function create(template: string) {
		if (busy || !ready) {
			nameEl?.focus();
			return;
		}
		busy = true;
		try {
			let id = unitId;
			let label = unitName;
			if (!id) {
				if (!sourceId) {
					toasts.push('Add a source before creating a project.');
					return;
				}
				const folder = await Folder.create(slug, sourceId);
				id = folder.id;
				label = folder.slug;
			}
			const view = await View.forUnit(id, label);
			if (emoji) view.emoji = emoji;
			applyTemplate(view, template);
			await view.save();
			editor.replaceTab(tab.id, TabState.forView(view));
		} catch (e) {
			toasts.push(Folder.describeOpError(e, "That project couldn't be created."));
		} finally {
			busy = false;
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			create(TEMPLATES[picked].id);
		}
	}

	const COLS = 3;
	function onGridKey(e: KeyboardEvent) {
		const step =
			e.key === 'ArrowRight'
				? 1
				: e.key === 'ArrowLeft'
					? -1
					: e.key === 'ArrowDown'
						? COLS
						: e.key === 'ArrowUp'
							? -COLS
							: 0;
		if (step) {
			e.preventDefault();
			picked = (picked + step + TEMPLATES.length) % TEMPLATES.length;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			create(TEMPLATES[picked].id);
		}
	}
</script>

<div class="setup">
	<div class="inner">
		<p class="eyebrow">{unitId ? 'Set up project' : 'New project'}</p>

		{#if unitId}
			<div class="unit">
				<span class="unit-icon"><UnitIcon size={17} strokeWidth={1.75} /></span>
				<span class="unit-text">
					<span class="unit-name">{unitName}</span>
					{#if where}<span class="unit-where">{where}</span>{/if}
				</span>
				<span class="unit-note">Using what's already here</span>
			</div>
		{:else}
			<div class="name-row">
				<button
					class="emoji"
					type="button"
					bind:this={emojiAnchor}
					title="Set an emoji"
					onclick={() => (emojiOpen = !emojiOpen)}
				>
					{#if emoji}{emoji}{:else}<Globe size={17} strokeWidth={1.75} />{/if}
				</button>
				<input
					class="name"
					bind:this={nameEl}
					bind:value={name}
					onkeydown={onKey}
					class:invalid={taken}
					placeholder="Project name"
					spellcheck="false"
				/>
				{#if taken}
					<span class="taken">Already a folder here</span>
				{/if}
				<button
					class="src"
					type="button"
					bind:this={sourceEl}
					onclick={() => (sourceOpen = !sourceOpen)}
				>
					<FolderInput size={13} strokeWidth={1.75} />
					<span>{source ? sourceName(source) : 'No source'}</span>
					<ChevronDown size={12} strokeWidth={2} />
				</button>
			</div>
		{/if}

		<div class="grid" role="listbox" tabindex="-1" onkeydown={onGridKey}>
			{#each TEMPLATES as t, i (t.id)}
				{@const Icon = t.icon}
				<button
					class="card"
					class:picked={i === picked}
					type="button"
					role="option"
					aria-selected={i === picked}
					onclick={() => (picked = i)}
					ondblclick={() => create(TEMPLATES[picked].id)}
				>
					<span class="card-icon"><Icon size={20} strokeWidth={1.5} /></span>
					<span class="card-label">{t.label}</span>
					<span class="card-hint">{t.hint}</span>
				</button>
			{/each}
		</div>

		<div class="actions">
			<p class="foot">
				{#if unitId}
					Its notes stay where they are; a project only adds the way you look at them.
				{:else}
					Already have the notes?
					<button class="link" type="button" onclick={() => palette.show()}>Find the folder</button>
					and turn it into a project.
				{/if}
			</p>
			<button
				class="create"
				type="button"
				disabled={busy || !ready}
				onclick={() => create(TEMPLATES[picked].id)}
			>
				{unitId ? 'Set up project' : 'Create project'}
			</button>
		</div>
	</div>
</div>

<EmojiPicker bind:open={emojiOpen} anchor={emojiAnchor} onPick={(e) => (emoji = e)} />
<Menu
	bind:open={sourceOpen}
	anchor={sourceEl}
	items={sources.map((s) => ({ value: s.id, label: sourceName(s), icon: FolderInput }))}
	selected={sourceId}
	onSelect={(v) => (sourceId = v)}
	minWidth={200}
/>

<style>
	.setup {
		height: 100%;
		overflow-y: auto;
		font-family: var(--font-ui);
		color: var(--color-text-primary);
	}

	.inner {
		max-width: 720px;
		margin: 0 auto;
		padding: 14vh 24px 48px;
	}

	.eyebrow {
		margin: 0 0 18px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-ui-muted);
	}

	/* the place being set up, stated plainly so nothing looks like it's being created */
	.unit {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 26px;
		padding: 14px 16px;
		border-radius: 10px;
		background: var(--chip-bg);
	}

	.unit-icon {
		display: inline-flex;
		color: var(--color-ui-muted);
	}

	.unit-text {
		display: flex;
		align-items: baseline;
		gap: 10px;
		min-width: 0;
	}

	.unit-name {
		font-size: 17px;
		font-weight: 600;
	}

	.unit-where {
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.unit-note {
		margin-left: auto;
		font-size: 12px;
		color: var(--color-ui-dulled);
	}

	.name-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 26px;
		padding-bottom: 10px;
		border-bottom: 1px solid var(--color-border);
	}

	.emoji {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		flex-shrink: 0;
		border: none;
		border-radius: 8px;
		background: transparent;
		font-size: 19px;
		line-height: 1;
		cursor: pointer;
	}

	.emoji:hover {
		background: var(--chip-bg);
	}

	.emoji :global(svg) {
		color: var(--color-ui-dulled);
	}

	.emoji:hover :global(svg) {
		color: var(--color-ui-muted);
	}

	.name {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		font: inherit;
		font-size: 22px;
		font-weight: 600;
		color: var(--color-text-primary);
		outline: none;
	}

	.name.invalid {
		color: var(--error-fg);
		text-decoration: underline wavy var(--error-fg);
		text-underline-offset: 4px;
	}

	.taken {
		flex-shrink: 0;
		font-size: 12px;
		color: var(--error-fg);
	}

	.name::placeholder {
		color: var(--color-ui-dulled);
		font-weight: 500;
	}

	.src {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		height: 28px;
		padding: 0 8px 0 10px;
		border: none;
		border-radius: 7px;
		background: var(--chip-bg);
		font: inherit;
		font-size: 12.5px;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.src:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.src :global(svg) {
		color: var(--color-ui-muted);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		outline: none;
	}

	/* outlined tiles; the pick fills and keeps its outline in the accent */
	.card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		min-height: 118px;
		padding: 16px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: transparent;
		font: inherit;
		text-align: left;
		color: inherit;
		cursor: pointer;
		transition:
			background-color 100ms ease,
			border-color 100ms ease;
	}

	.card:hover {
		background: var(--chip-bg);
	}

	.card.picked {
		border-color: var(--color-accent);
		background: var(--accent-a9);
	}

	.card-icon {
		display: inline-flex;
		margin-bottom: 9px;
		color: var(--color-ui-muted);
	}

	.card.picked .card-icon {
		color: var(--color-accent);
	}

	.card-label {
		font-size: 14px;
		font-weight: 600;
	}

	.card-hint {
		font-size: 12px;
		line-height: 1.45;
		color: var(--color-ui-muted);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 24px;
		margin-top: 22px;
	}

	.foot {
		flex: 1;
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--color-ui-dulled);
	}

	.link {
		padding: 0;
		border: none;
		background: transparent;
		font: inherit;
		color: var(--color-text-secondary);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}

	.link:hover {
		color: var(--color-text-primary);
	}

	.create {
		flex-shrink: 0;
		height: 34px;
		padding: 0 16px;
		border: none;
		border-radius: 8px;
		background: var(--color-accent);
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		color: #fff;
		cursor: pointer;
		transition: filter 100ms ease;
	}

	.create:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	.create:disabled {
		background: var(--chip-bg);
		color: var(--color-ui-dulled);
		cursor: default;
	}
</style>
