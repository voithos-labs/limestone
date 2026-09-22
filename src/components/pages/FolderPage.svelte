<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import View, { listSavedViewJSON } from '$lib/models/View.svelte';
	import type { FilterNode, ViewField } from '$lib/models/View.svelte';
	import type EditorState from '$lib/models/EditorState.svelte.js';
	import type { TabState } from '$lib/models/EditorState.svelte.js';
	import type { SettingsState } from '$lib/models/Settings.svelte';
	import Folder, { folderIdPath, folderIdSource, isSourceRoot } from '$lib/models/Folder';
	import { getSource, onSourceReconciled, sourceName, type Source } from '$lib/models/Source';
	import DocHandle from '$lib/models/DocHandle';
	import { toasts } from '$lib/toasts.svelte';
	import ListFace from '../views/faces/ListFace.svelte';
	import Menu from '../views/Menu.svelte';
	import InputPopover from '../views/InputPopover.svelte';
	import ScrollThumb from '../ScrollThumb.svelte';
	import {
		ChevronRight,
		ChevronDown,
		EllipsisVertical,
		Folder as FolderIcon,
		FolderPlus,
		FilePlus,
		Pencil,
		Trash2,
		ExternalLink,
		Search,
		X,
		List,
		LayoutGrid,
		Bookmark,
		FolderInput,
		CalendarClock
	} from '@lucide/svelte';

	// A folder or a source opened as a place, not as a filtered view: what's directly inside it,
	// folders first, files after. The view underneath is the unit's own, so anything saved on it
	// (fields, faces, arrangement) carries; only the chrome is different
	let {
		view,
		tab,
		editor,
		settings
	}: { view: View; tab?: TabState; editor: EditorState; settings: SettingsState } = $props();

	const unitId = $derived(view.unit!);
	const sourceId = $derived(folderIdSource(unitId));
	const path = $derived(folderIdPath(unitId));
	const isRoot = $derived(isSourceRoot(unitId));

	let source: Source | null = $state(null);
	let folders: Folder[] = $state([]);
	// folders that are projects: they have a saved view of their own, and its emoji
	let projects: Map<string, { emoji: string }> = $state(new Map());
	const query = $derived(((view.state.search as string | undefined) ?? '').trim());
	// direct children, or while searching every folder below here whose name matches
	const children = $derived.by(() => {
		const q = query.toLowerCase();
		const prefix = path ? `${path}/` : '';
		const under = (f: Folder) =>
			folderIdSource(f.id) === sourceId && folderIdPath(f.id).startsWith(prefix);
		const hits = q
			? folders.filter((f) => under(f) && f.slug.toLowerCase().includes(q))
			: folders.filter((f) => f.parentId === unitId);
		return hits.sort((a, b) => a.slug.localeCompare(b.slug));
	});
	const projectChildren = $derived(children.filter((f) => projects.has(f.id)));
	const plainChildren = $derived(children.filter((f) => !projects.has(f.id)));

	// folders show three rows; the rest sit behind a quiet "show more"
	const ROWS = 3;
	const CHIP_MIN = 200;
	const GAP = 10;
	let foldersW = $state(0);
	let showAll = $state(false);
	const perRow = $derived(Math.max(1, Math.floor((foldersW + GAP) / (CHIP_MIN + GAP))));
	const folderCap = $derived(ROWS * perRow);
	const visibleFolders = $derived(
		showAll || query ? plainChildren : plainChildren.slice(0, folderCap)
	);
	// where a search hit sits, relative to here
	const relDir = (f: Folder) => {
		const p = folderIdPath(f.id);
		const rel = path ? p.slice(path.length + 1) : p;
		return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
	};
	const crumbs = $derived.by(() => {
		const segs = path ? path.split('/') : [];
		return segs.map((seg, i) => ({ slug: seg, path: segs.slice(0, i + 1).join('/') }));
	});

	async function loadFolders() {
		try {
			const [list, saved] = await Promise.all([Folder.list(), listSavedViewJSON()]);
			folders = list;
			projects = new Map(
				saved
					.filter((v) => v.unit?.startsWith('folder:'))
					.map((v) => [v.unit as string, { emoji: v.emoji ?? '' }])
			);
		} catch (e) {
			console.error('load folders failed', e);
		}
	}

	onMount(() => {
		loadFolders();
		getSource(sourceId)
			.then((s) => (source = s))
			.catch(() => {});
		view.touchAccessed().catch(() => {});
	});

	$effect(() => onSourceReconciled(() => loadFolders()));

	// ── The face: this unit's own list, direct children only unless searching ──
	const face = $derived(view.faces.find((f) => f.type === 'list') ?? view.faces[0]);
	const layout = $derived(face?.config.layout === 'grid' ? 'grid' : 'list');
	const folderField = $derived(view.fields.find((f: ViewField) => f.type === 'folder'));
	const updatedField = $derived(view.fields.find((f: ViewField) => f.type === 'updated_at'));

	// "Modified": the same quick ranges Drive offers, as a scope on updated_at
	const MODIFIED = [
		{ value: 'any', label: 'Any time' },
		{ value: 'today', label: 'Today' },
		{ value: 'week', label: 'Last 7 days' },
		{ value: 'month', label: 'Last 30 days' },
		{ value: 'year', label: 'This year' },
		{ value: 'lastyear', label: 'Last year' }
	];
	const modified = $derived((view.state.modified as string | undefined) ?? 'any');
	const modifiedLabel = $derived(MODIFIED.find((m) => m.value === modified)?.label ?? 'Any time');
	let modifiedOpen = $state(false);
	let modifiedEl: HTMLElement | null = $state(null);

	function modifiedLeaves(): FilterNode[] {
		const f = updatedField;
		if (!f) return [];
		const y = new Date().getFullYear();
		switch (modified) {
			case 'today':
				return [{ field_id: f.id, op: 'on_or_after', value: 'today' }];
			case 'week':
				return [{ field_id: f.id, op: 'on_or_after', value: 'today-6' }];
			case 'month':
				return [{ field_id: f.id, op: 'on_or_after', value: 'today-29' }];
			case 'year':
				return [{ field_id: f.id, op: 'on_or_after', value: `${y}-01-01` }];
			case 'lastyear':
				return [
					{ field_id: f.id, op: 'on_or_after', value: `${y - 1}-01-01` },
					{ field_id: f.id, op: 'before', value: `${y}-01-01` }
				];
			default:
				return [];
		}
	}

	const scope: FilterNode | null = $derived.by(() => {
		const leaves: FilterNode[] = [];
		if (folderField && !query) leaves.push({ field_id: folderField.id, op: 'is', value: unitId });
		leaves.push(...modifiedLeaves());
		if (leaves.length === 0) return null;
		return leaves.length === 1 ? leaves[0] : { op: 'and', children: leaves };
	});

	function setLayout(l: 'list' | 'grid') {
		if (face) face.config.layout = l;
	}

	// the view saves itself once it stops being the plain default, like any other view
	let lastSig = '';
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const sig = JSON.stringify(view.toJSON(), (k, v) =>
			k === 'active_cell' || k === 'search' || k === 'temporary' || k === 'accessed_at'
				? undefined
				: v
		);
		if (lastSig === '') {
			lastSig = sig;
			return;
		}
		if (sig === lastSig || view.temporary) return;
		lastSig = sig;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = null;
			view.save().catch((e) => console.error('save view failed', e));
		}, 250);
	});
	onDestroy(() => {
		if (saveTimer && !view.temporary) view.save().catch(() => {});
	});

	// ── Navigation: a place moves within its own tab, like a folder window ──────
	async function show(id: string, name: string) {
		const next = await View.forUnit(id, name);
		if (tab) editor.showViewInTab(tab, next);
		else editor.openView(next);
	}

	const openFolder = (f: Folder) => show(f.id, f.slug);

	function openCrumb(p: string) {
		const id = `folder:${sourceId}:${p}`;
		const f = folders.find((x) => x.id === id);
		show(id, f?.slug ?? p.split('/').pop() ?? p);
	}

	function openRoot() {
		if (source) show(`folder:${sourceId}:`, sourceName(source));
	}

	function onOpenRow(rowId: string) {
		DocHandle.fromID(rowId)
			.then((d) => editor.openDoc(d))
			.catch(console.error);
	}

	// ── Actions: the page's menu is the folder's menu ──────────────────────────
	let createSignal = $state(0);
	let menuOpen = $state(false);
	let menuEl: HTMLElement | null = $state(null);
	let nameOpen = $state(false);
	let nameMode: 'new-folder' | 'rename' = $state('new-folder');

	const menuItems = $derived([
		{ value: 'new-note', label: 'New note', icon: FilePlus },
		{ value: 'new-folder', label: 'New folder', icon: FolderPlus },
		{ kind: 'divider' as const },
		...(isRoot ? [] : [{ value: 'rename', label: 'Rename', icon: Pencil }]),
		{ value: 'reveal', label: 'Reveal in file manager', icon: ExternalLink },
		...(view.temporary
			? [{ value: 'project', label: 'Turn into project', icon: Bookmark }]
			: [{ value: 'unproject', label: 'Stop being a project', icon: Bookmark }]),
		...(isRoot
			? []
			: [
					{ kind: 'divider' as const },
					{ value: 'delete', label: 'Delete folder', icon: Trash2, danger: true }
				])
	]);

	async function onMenuSelect(value: string) {
		menuOpen = false;
		switch (value) {
			case 'new-note':
				createSignal++;
				break;
			case 'new-folder':
				nameMode = 'new-folder';
				nameOpen = true;
				break;
			case 'rename':
				nameMode = 'rename';
				nameOpen = true;
				break;
			case 'reveal':
				if (source) revealItemInDir(`${source.path}/${path}`).catch(console.error);
				break;
			case 'project':
				await view.save();
				break;
			case 'unproject':
				await view.unsave();
				break;
			case 'delete':
				toasts.push('Deleting folders is not wired up yet. Delete it in your file manager.');
				break;
		}
	}

	async function commitName(raw: string) {
		const name = raw.trim();
		nameOpen = false;
		if (!name) return;
		try {
			if (nameMode === 'new-folder') {
				const created = await Folder.create(
					name,
					sourceId,
					path ? { id: unitId, path } : undefined
				);
				await loadFolders();
				show(created.id, created.slug);
			} else {
				const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
				const newId = await Folder.move(sourceId, path, `${parent}${name}`);
				const f = await Folder.fromID(newId);
				show(newId, f.slug);
			}
		} catch (e) {
			toasts.push(Folder.describeOpError(e, "That couldn't be done."));
		}
	}

	// per-subfolder menu
	let subMenuOpen = $state(false);
	let subMenuEl: HTMLElement | null = $state(null);
	let subMenuFolder: Folder | null = $state(null);
	const subMenuItems = $derived.by(() => {
		const f = subMenuFolder;
		return [
			{ value: 'open', label: 'Open', icon: ChevronRight },
			{ value: 'reveal', label: 'Reveal in file manager', icon: ExternalLink },
			{ kind: 'divider' as const },
			f && projects.has(f.id)
				? { value: 'unproject', label: 'Stop being a project', icon: Bookmark }
				: { value: 'project', label: 'Turn into project', icon: Bookmark }
		];
	});

	function openSubMenu(e: MouseEvent, f: Folder) {
		e.stopPropagation();
		subMenuEl = e.currentTarget as HTMLElement;
		subMenuFolder = f;
		subMenuOpen = true;
	}

	function onSubMenuSelect(value: string) {
		subMenuOpen = false;
		const f = subMenuFolder;
		if (!f) return;
		if (value === 'open') openFolder(f);
		else if (value === 'reveal' && source)
			revealItemInDir(`${source.path}/${folderIdPath(f.id)}`).catch(console.error);
		else if (value === 'project' || value === 'unproject') {
			View.forUnit(f.id, f.slug)
				.then((v) => (value === 'project' ? v.save() : v.unsave()))
				.then(loadFolders)
				.catch(console.error);
		}
	}

	let bodyEl: HTMLDivElement | null = $state(null);
</script>

<div class="folder-page">
	<div class="body" bind:this={bodyEl}>
		<div class="inner">
			<header class="head">
				<span class="place-icon">
					{#if isRoot}<FolderInput size={18} strokeWidth={1.75} />{:else}<FolderIcon
							size={18}
							strokeWidth={1.75}
						/>{/if}
				</span>
				<nav class="crumbs" aria-label="Location">
					<button class="crumb" class:current={isRoot} type="button" onclick={openRoot}>
						{source ? sourceName(source) : ''}
					</button>
					{#each crumbs as c, i (c.path)}
						<ChevronRight size={14} strokeWidth={2} class="sep" />
						<button
							class="crumb"
							class:current={i === crumbs.length - 1}
							type="button"
							onclick={() => openCrumb(c.path)}
						>
							{c.slug}
						</button>
					{/each}
					<button
						class="crumb-menu"
						type="button"
						aria-label="Folder menu"
						bind:this={menuEl}
						onclick={() => (menuOpen = !menuOpen)}
					>
						<ChevronDown size={14} strokeWidth={2} />
					</button>
				</nav>

				<label class="search">
					<Search size={13} strokeWidth={1.75} />
					<input
						type="text"
						placeholder="Search in {isRoot && source
							? sourceName(source)
							: (crumbs.at(-1)?.slug ?? '')}"
						value={view.state.search ?? ''}
						oninput={(e) => (view.state.search = (e.currentTarget as HTMLInputElement).value)}
					/>
					{#if view.state.search}
						<button
							class="clear"
							type="button"
							aria-label="Clear"
							onclick={() => (view.state.search = '')}
						>
							<X size={12} strokeWidth={2} />
						</button>
					{/if}
				</label>
			</header>

			{#snippet folderChip(f: Folder)}
				{@const where = query ? relDir(f) : ''}
				{@const emoji = projects.get(f.id)?.emoji}
				<div
					class="folder"
					role="button"
					tabindex="0"
					onclick={() => openFolder(f)}
					onkeydown={(e) => {
						if (e.key === 'Enter') openFolder(f);
					}}
				>
					{#if emoji}
						<span class="folder-emoji">{emoji}</span>
					{:else if projects.has(f.id)}
						<Bookmark size={16} strokeWidth={1.75} />
					{:else}
						<FolderIcon size={16} strokeWidth={1.75} />
					{/if}
					<span class="folder-name">
						{f.slug}{#if where}<span class="folder-where">{where}</span>{/if}
					</span>
					<button
						class="folder-menu"
						type="button"
						tabindex="-1"
						aria-label="More"
						onclick={(e) => openSubMenu(e, f)}
					>
						<EllipsisVertical size={14} strokeWidth={1.75} />
					</button>
				</div>
			{/snippet}

			{#if projectChildren.length > 0}
				<div class="section-label">Projects</div>
				<div class="folders">
					{#each projectChildren as f (f.id)}
						{@render folderChip(f)}
					{/each}
				</div>
			{/if}

			{#if plainChildren.length > 0}
				<div class="section-label">Folders</div>
				<div class="folders" bind:clientWidth={foldersW}>
					{#each visibleFolders as f (f.id)}
						{@render folderChip(f)}
					{/each}
				</div>
				{#if !query && plainChildren.length > folderCap}
					<button class="show-more" type="button" onclick={() => (showAll = !showAll)}>
						{showAll ? 'Show fewer' : `Show ${plainChildren.length - folderCap} more`}
					</button>
				{/if}
			{/if}

			<div class="section-label files">
				<span>Files</span>
				<span class="controls">
					<button
						class="chip-btn"
						class:set={modified !== 'any'}
						type="button"
						bind:this={modifiedEl}
						onclick={() => (modifiedOpen = !modifiedOpen)}
					>
						<CalendarClock size={13} strokeWidth={1.75} />
						<span>{modified === 'any' ? 'Modified' : modifiedLabel}</span>
						<ChevronDown size={12} strokeWidth={2} />
					</button>
					<span class="layout" role="group" aria-label="Layout">
						<button
							class="lay"
							class:on={layout === 'list'}
							type="button"
							title="List"
							aria-pressed={layout === 'list'}
							onclick={() => setLayout('list')}
						>
							<List size={14} strokeWidth={1.75} />
						</button>
						<button
							class="lay"
							class:on={layout === 'grid'}
							type="button"
							title="Grid"
							aria-pressed={layout === 'grid'}
							onclick={() => setLayout('grid')}
						>
							<LayoutGrid size={14} strokeWidth={1.75} />
						</button>
					</span>
				</span>
			</div>
			{#if face}
				<ListFace {view} {face} {onOpenRow} {createSignal} {scope} />
			{/if}
		</div>
	</div>

	<ScrollThumb scroller={bodyEl} top={20} />
</div>

<Menu
	bind:open={menuOpen}
	anchor={menuEl}
	items={menuItems}
	onSelect={onMenuSelect}
	minWidth={200}
/>
<Menu
	bind:open={modifiedOpen}
	anchor={modifiedEl}
	items={MODIFIED}
	selected={modified}
	onSelect={(v) => {
		view.state.modified = v;
		modifiedOpen = false;
	}}
	minWidth={170}
/>
<Menu
	bind:open={subMenuOpen}
	anchor={subMenuEl}
	items={subMenuItems}
	onSelect={onSubMenuSelect}
	minWidth={180}
/>
<InputPopover
	bind:open={nameOpen}
	anchor={nameOpen ? menuEl : null}
	value={nameMode === 'rename' ? (crumbs.at(-1)?.slug ?? '') : ''}
	placeholder={nameMode === 'rename' ? 'Folder name' : 'New folder'}
	onChange={(v) => commitName(String(v ?? ''))}
/>

<style>
	.folder-page {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		width: 100%;
		overflow: hidden;
		font-family: var(--font-ui);
	}

	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 32px 24px 8px;
	}

	.place-icon {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		margin-right: -6px;
		color: var(--color-ui-muted);
	}

	.crumbs {
		display: flex;
		align-items: center;
		gap: 2px;
		min-width: 0;
		flex-shrink: 0;
	}

	.crumbs :global(.sep) {
		color: var(--color-ui-muted);
		flex-shrink: 0;
	}

	/* one size and weight all the way along; colour says where you are */
	.crumb {
		padding: 4px 6px;
		border: none;
		border-radius: 6px;
		background: transparent;
		font: inherit;
		font-size: 17px;
		font-weight: 500;
		color: var(--color-ui-muted);
		cursor: pointer;
		white-space: nowrap;
	}

	.crumb:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.crumb.current {
		color: var(--color-text-primary);
	}

	.crumb-menu {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		margin-left: 2px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.crumb-menu:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.search {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		flex: 0 1 320px;
		min-width: 120px;
		margin-left: auto;
		padding: 0 12px;
		background: var(--chip-bg);
		border-radius: 999px;
		color: var(--color-ui-muted);
		font-size: 12px;
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
		border: none;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.controls {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin-left: auto;
	}

	/* a filter chip like the view bar's, one field, quick ranges */
	.chip-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 24px;
		padding: 0 6px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		font: inherit;
		font-size: 12px;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.chip-btn:hover {
		color: var(--color-text-primary);
	}

	/* a chosen range gets the same box the chosen layout does */
	.chip-btn.set {
		border-color: var(--color-border);
		color: var(--color-text-primary);
	}

	/* bare icons; the chosen one gets a box, nothing layered underneath */
	.layout {
		display: inline-flex;
		gap: 2px;
	}

	.lay {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.lay:hover {
		color: var(--color-text-primary);
	}

	.lay.on {
		border-color: var(--color-border);
		color: var(--color-text-primary);
	}

	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		scrollbar-width: none;
		padding-bottom: 40px;
	}

	.body::-webkit-scrollbar {
		display: none;
	}

	/* the same reading column every page uses */
	.inner {
		max-width: var(--page-max-width, none);
		margin: 0 auto;
	}

	.section-label {
		display: flex;
		align-items: center;
		margin: 14px 24px 8px;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-ui-muted);
	}

	/* folders: compact chips in a grid, like a place's shelves */
	.folders {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 10px;
		margin: 0 24px 6px;
	}

	.folder {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 40px;
		padding: 0 6px 0 12px;
		border-radius: 8px;
		background: var(--chip-bg);
		color: var(--color-text-primary);
		font-size: 13px;
		cursor: pointer;
		transition: background-color 80ms ease;
	}

	.folder:hover,
	.folder:focus-visible {
		background: var(--chip-bg-hover);
		outline: none;
	}

	.folder > :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.show-more {
		display: block;
		margin: 2px 24px 0;
		padding: 4px 6px;
		border: none;
		border-radius: 5px;
		background: transparent;
		font: inherit;
		font-size: 11.5px;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.show-more:hover {
		color: var(--color-text-primary);
		background: var(--chip-bg);
	}

	.folder-emoji {
		width: 16px;
		text-align: center;
		font-size: 14px;
		line-height: 1;
	}

	.folder-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.folder-where {
		margin-left: 6px;
		font-size: 11px;
		color: var(--color-ui-muted);
	}

	.folder-menu {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
		opacity: 0;
		transition: opacity 80ms ease;
	}

	.folder:hover .folder-menu,
	.folder:focus-within .folder-menu {
		opacity: 1;
	}

	.folder-menu:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}
</style>
