<script lang="ts">
	import { untrack } from 'svelte';
	import {
		ChevronDown,
		ChevronRight,
		FileText,
		FolderInput,
		FolderPlus,
		Search,
		X
	} from '@lucide/svelte';
	import Folder, { folderId, folderIdPath, folderIdSource } from '$lib/models/Folder';
	import { listSources, sourceName, type Source } from '$lib/models/Source';
	import { listSavedViewJSON } from '$lib/models/View.svelte';
	import FolderChips from './views/FolderChips.svelte';
	import { isMove, readMove, movingNow, canMoveInto, moveInto } from '$lib/views/dragMove';
	import { folderNameProblem, nameGuard } from '$lib/util/paths';
	import { mark } from '$lib/toasts.svelte';

	type Place = { id: string; slug: string; repo?: boolean };

	let {
		open = $bindable(false),
		value,
		name,
		onMove
	}: {
		open: boolean;
		value: string;
		name: string;
		onMove: (folderId: string) => Promise<void> | void;
	} = $props();

	let folders: Folder[] = $state([]);
	let sources: Source[] = $state([]);
	let projects: Map<string, { emoji: string }> = $state(new Map());
	let at: string | null = $state(null);
	let selected: string | null = $state(null);
	let busy = $state(false);
	let query = $state('');
	let searchEl: HTMLInputElement | null = $state(null);

	const sourcePlaces = $derived(
		sources.map((s): Place => ({ id: folderId(s.id, ''), slug: sourceName(s) }))
	);
	const multiSource = $derived(sources.length > 1);

	const q = $derived(query.trim().toLowerCase());

	function under(f: Folder): boolean {
		if (at === null) return true;
		const path = folderIdPath(at);
		return (
			folderIdSource(f.id) === folderIdSource(at) &&
			folderIdPath(f.id).startsWith(path ? `${path}/` : '')
		);
	}

	const places = $derived.by((): Place[] => {
		if (q) return folders.filter((f) => under(f) && f.slug.toLowerCase().includes(q));
		if (at === null) return sourcePlaces;
		return folders.filter((f) => f.parentId === at);
	});

	const sections = $derived.by(() => {
		if (!q && at === null) return [{ id: 'sources', label: 'Sources', places }];
		return [
			{ id: 'projects', label: 'Projects', places: places.filter((p) => projects.has(p.id)) },
			{ id: 'folders', label: 'Folders', places: places.filter((p) => !projects.has(p.id)) }
		].filter((sec) => sec.places.length > 0);
	});

	let folded: Record<string, boolean> = $state({});

	let naming = $state(false);
	let draft = $state('');
	let creating = false;
	let draftEl: HTMLInputElement | null = $state(null);

	const draftProblem = $derived.by(() => {
		const lower = draft.trim().toLowerCase();
		return folderNameProblem(
			draft,
			folders.some((f) => f.parentId === at && f.slug.toLowerCase() === lower)
		);
	});

	function startNaming() {
		naming = true;
		draft = '';
		queueMicrotask(() => draftEl?.focus());
	}

	async function commitNaming() {
		if (!naming || creating) return;
		const name = draft.trim();
		const parent = at;
		if (!name || draftProblem || parent === null) {
			naming = false;
			return;
		}
		await createFolder(name, parent);
	}

	async function createFolder(name: string, parent: string) {
		creating = true;
		try {
			const path = folderIdPath(parent);
			const made = await Folder.create(
				name,
				folderIdSource(parent),
				path ? { id: parent, path } : undefined
			);
			folders = await Folder.list();
			naming = false;
			go(made.id);
		} catch (e) {
			naming = false;
			Folder.reportOpError(e, `${mark('folder', name)} couldn't be created.`, () =>
				createFolder(name, parent)
			);
		} finally {
			creating = false;
		}
	}

	function onDraftKey(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Enter') commitNaming();
		else if (e.key === 'Escape') naming = false;
	}

	function whereOf(f: Place): string {
		if (!q) return '';
		const p = folderIdPath(f.id);
		const base = at === null ? '' : folderIdPath(at);
		const rel = base ? p.slice(base.length + 1) : p;
		const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
		if (at !== null || !multiSource) return dir;
		const src = sourcePlaces.find((s) => s.id === folderId(folderIdSource(f.id), ''))?.slug ?? '';
		return dir ? `${src} / ${dir}` : src;
	}

	const crumbs = $derived.by(() => {
		if (at === null) return [] as Place[];
		const src = folderIdSource(at);
		const root = sourcePlaces.find((p) => p.id === folderId(src, ''));
		const segs = folderIdPath(at).split('/').filter(Boolean);
		return [
			{ id: folderId(src, ''), slug: root?.slug ?? '' },
			...segs.map((seg, i) => ({ id: folderId(src, segs.slice(0, i + 1).join('/')), slug: seg }))
		];
	});

	const target = $derived(selected ?? at);
	const targetName = $derived(
		selected ? ([...folders, ...sourcePlaces].find((p) => p.id === selected)?.slug ?? '') : ''
	);
	const canMove = $derived(!!target && target !== value && !busy);

	async function load() {
		const [fs, ss, saved] = await Promise.all([
			Folder.list(),
			listSources(),
			listSavedViewJSON().catch(() => [])
		]);
		folders = fs;
		sources = ss;
		projects = new Map(
			saved
				.filter((v) => v.unit?.startsWith('folder:'))
				.map((v) => [v.unit as string, { emoji: v.emoji ?? '' }])
		);
	}

	$effect(() => {
		if (!open) return;
		untrack(() => {
			at = value;
			selected = null;
			query = '';
			busy = false;
			reload();
		});
		queueMicrotask(() => searchEl?.focus());
	});

	function reload() {
		load().catch((e) => console.error('move dialog load failed', e));
	}

	let overCrumb: string | null = $state(null);

	function onCrumbDragOver(e: DragEvent, id: string) {
		if (!isMove(e) || !canMoveInto(id, movingNow())) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		overCrumb = id;
	}

	function onCrumbDrop(e: DragEvent, id: string) {
		overCrumb = null;
		if (!isMove(e)) return;
		e.preventDefault();
		const p = readMove(e);
		if (p && canMoveInto(id, p))
			moveInto(id, p).then((moved) => {
				if (moved) reload();
			});
	}

	function go(id: string | null) {
		at = id;
		selected = null;
		query = '';
		naming = false;
	}

	async function confirm() {
		if (!canMove || !target) return;
		busy = true;
		try {
			await onMove(target);
			open = false;
		} finally {
			busy = false;
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (query) query = '';
			else open = false;
		} else if (e.key === 'Enter' && selected) go(selected);
	}
</script>

<svelte:window onkeydown={open ? onKey : undefined} />

{#if open}
	<div class="overlay" role="presentation" onclick={() => (open = false)}>
		<div
			class="dialog"
			role="dialog"
			aria-label="Move {name}"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="head">
				<h3 class="title-h">
					Move
					<span class="title-chip">
						<span class="title-icon"><FileText size={14} strokeWidth={1.75} /></span>
						<span class="title-name">{name}</span>
					</span>
				</h3>
				<label class="search">
					<Search size={14} strokeWidth={1.75} />
					<input
						type="text"
						placeholder="Search in {at === null ? 'all sources' : (crumbs.at(-1)?.slug ?? '')}"
						bind:value={query}
						bind:this={searchEl}
						oninput={() => (selected = null)}
					/>
					{#if query}
						<button class="clear" type="button" aria-label="Clear" onclick={() => (query = '')}>
							<X size={12} strokeWidth={2} />
						</button>
					{/if}
				</label>
			</div>

			<div class="loc-row">
				<nav class="crumbs" aria-label="Location">
					{#if multiSource}
						<button
							class="crumb crumb-icon"
							class:current={at === null}
							type="button"
							title="All sources"
							aria-label="All sources"
							onclick={() => go(null)}
						>
							<FolderInput size={17} strokeWidth={1.75} />
						</button>
					{/if}
					{#each crumbs as c, i (c.id)}
						{#if multiSource || i > 0}<ChevronRight size={13} strokeWidth={2} class="sep" />{/if}
						<button
							class="crumb"
							class:current={i === crumbs.length - 1}
							class:over={overCrumb === c.id}
							type="button"
							onclick={() => go(c.id)}
							ondragover={(e) => onCrumbDragOver(e, c.id)}
							ondragleave={() => overCrumb === c.id && (overCrumb = null)}
							ondrop={(e) => onCrumbDrop(e, c.id)}>{c.slug}</button
						>
					{/each}
				</nav>
				{#if at !== null}
					<span class="new-chip" class:naming>
						<button
							class="new-btn"
							type="button"
							tabindex={naming ? -1 : 0}
							aria-hidden={naming}
							onclick={startNaming}
						>
							<FolderPlus size={13} strokeWidth={1.75} />
							<span>New folder</span>
						</button>
						{#if naming}
							<span class="new-edit">
								<FolderPlus size={13} strokeWidth={1.75} />
								<span class="grow" data-value={draft || 'Name'}>
									<input
										class="new-input"
										class:invalid={draftProblem}
										title={draftProblem ?? undefined}
										type="text"
										size="1"
										placeholder="Name"
										bind:value={draft}
										bind:this={draftEl}
										use:nameGuard
										onkeydown={onDraftKey}
										onblur={commitNaming}
									/>
								</span>
							</span>
						{/if}
					</span>
				{/if}
			</div>

			<div class="body">
				{#each sections as sec (sec.id)}
					<div class="section-label">
						<button
							class="fold"
							class:folded={folded[sec.id]}
							type="button"
							onclick={() => (folded[sec.id] = !folded[sec.id])}
						>
							<span>{sec.label}</span>
							<span class="fold-caret"><ChevronDown size={12} strokeWidth={2} /></span>
						</button>
					</div>
					{#if !folded[sec.id]}
						<FolderChips
							folders={sec.places}
							{projects}
							rows={99}
							{whereOf}
							onOpen={(f) => go(f.id)}
							onChanged={reload}
							bind:selected
						/>
					{/if}
				{:else}
					<p class="empty">{q ? 'No matching folders' : 'No folders inside'}</p>
				{/each}
			</div>

			<div class="foot">
				<button class="btn ghost" type="button" onclick={() => (open = false)}>Cancel</button>
				<button class="btn primary" type="button" disabled={!canMove} onclick={confirm}>
					<span class="btn-label"
						>{target === value
							? 'Already here'
							: selected
								? `Move to ${targetName}`
								: 'Move here'}</span
					>
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 900;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
	}

	.dialog {
		display: flex;
		flex-direction: column;
		width: 720px;
		height: 480px;
		max-width: calc(100vw - 32px);
		max-height: calc(100vh - 64px);
		padding: 24px 20px 20px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 13px;
		color: var(--color-text-primary);
		outline: none;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 16px;
		margin: 0 4px 16px;
	}

	.title-h {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}

	.search {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 32px;
		flex: 0 1 260px;
		min-width: 120px;
		margin-left: auto;
		padding: 0 13px;
		background: var(--chip-bg);
		border-radius: 999px;
		color: var(--color-ui-muted);
		font-size: 13px;
	}

	.search input {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		font: inherit;
		font-size: 13px;
		color: var(--color-text-primary);
		outline: none;
	}

	.search input::placeholder {
		color: var(--color-ui-muted);
	}

	.clear {
		display: inline-flex;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.title-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		height: 26px;
		padding: 0 10px 0 8px;
		border-radius: 7px;
		background: var(--chip-bg);
		white-space: nowrap;
	}

	.title-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.title-name {
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 14px;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.loc-row {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 0 4px 10px -3px;
	}

	.crumbs {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 2px;
		min-width: 0;
	}

	.new-chip {
		display: inline-grid;
		flex-shrink: 0;
		max-width: 260px;
		height: 26px;
		margin-left: auto;
		border-radius: 6px;
		background: var(--chip-bg);
		color: var(--color-ui-muted);
		font-size: 12px;
	}

	.new-btn,
	.new-edit {
		grid-area: 1 / 1;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		padding: 0 10px;
	}

	.new-btn {
		border: none;
		border-radius: inherit;
		background: transparent;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.new-chip.naming .new-btn {
		visibility: hidden;
	}

	.new-chip:not(.naming):hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.new-edit {
		color: var(--color-text-primary);
	}

	.new-edit > :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.grow {
		display: inline-grid;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.grow::after {
		content: attr(data-value);
		grid-area: 1 / 1;
		visibility: hidden;
		white-space: pre;
	}

	.new-input {
		grid-area: 1 / 1;
		width: 100%;
		min-width: 0;
		padding: 0;
		border: none;
		background: transparent;
		font: inherit;
		color: inherit;
		outline: none;
	}

	.new-input::placeholder {
		color: var(--color-ui-dulled);
	}

	.new-input.invalid {
		text-decoration: underline;
		text-decoration-color: var(--error-fg);
		text-underline-offset: 3px;
	}

	.crumbs :global(.sep) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.crumb {
		padding: 3px 6px;
		border: none;
		border-radius: 6px;
		background: transparent;
		font: inherit;
		font-size: 14px;
		font-weight: 500;
		color: var(--color-ui-muted);
		white-space: nowrap;
		cursor: pointer;
	}

	.crumb-icon {
		display: inline-flex;
		align-items: center;
		padding: 4px 6px;
	}

	.crumb:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.crumb.current {
		color: var(--color-text-primary);
	}

	.crumb.over {
		background: var(--chip-bg-hover);
		box-shadow: inset 0 0 0 1.5px var(--color-accent);
	}

	.body {
		flex: 1;
		min-height: 120px;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--menu-scrollbar-thumb) transparent;
	}

	.section-label {
		display: flex;
		align-items: center;
		height: 22px;
		margin: 16px 0 8px;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-ui-muted);
	}

	.section-label:first-child {
		margin-top: 0;
	}

	.fold {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0;
		border: none;
		background: transparent;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.fold:hover {
		color: var(--color-text-primary);
	}

	.fold-caret {
		display: inline-flex;
		align-items: center;
		opacity: 0;
		transition:
			opacity 80ms ease,
			transform 120ms ease;
	}

	.fold:hover .fold-caret,
	.fold.folded .fold-caret {
		opacity: 1;
	}

	.fold.folded .fold-caret {
		transform: rotate(-90deg);
	}

	.empty {
		margin: 0;
		padding: 40px 0;
		text-align: center;
		color: var(--color-ui-muted);
	}

	.foot {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin: 18px 4px 0;
	}

	.btn {
		max-width: 280px;
		height: 32px;
		padding: 0 14px;
		border: none;
		border-radius: 8px;
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}

	.btn-label {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.btn.ghost {
		background: transparent;
		color: var(--color-text-secondary);
	}

	.btn.ghost:hover {
		background: var(--chip-bg);
	}

	.btn.primary {
		background: var(--color-accent);
		font-weight: 600;
		color: #fff;
	}

	.btn.primary:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	.btn.primary:disabled {
		background: var(--chip-bg);
		color: var(--color-ui-dulled);
		cursor: default;
	}
</style>
