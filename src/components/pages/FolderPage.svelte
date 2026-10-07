<script lang="ts">
	import { folderPresence, type FolderPresence } from '$lib/views/project.svelte';
	import GonePage from '../GonePage.svelte';
	import type { GoneAction } from '../GoneActions.svelte';
	import catBox from '$assets/art/cat-box.txt?raw';
	import { reportError } from '$lib/overlays.svelte';
	import { onDestroy, onMount } from 'svelte';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import View, { listSavedViewJSON } from '$lib/models/View.svelte';
	import type { FilterNode, ViewField } from '$lib/models/View.svelte';
	import type EditorState from '$lib/models/EditorState.svelte.js';
	import type { TabState } from '$lib/models/EditorState.svelte.js';
	import type { SettingsState } from '$lib/models/Settings.svelte';
	import Folder, { folderId, folderIdPath, folderIdSource, isSourceRoot } from '$lib/models/Folder';
	import {
		getSource,
		onSourceReconciled,
		removeSource,
		sourceName,
		type Source
	} from '$lib/models/Source';
	import DocHandle from '$lib/models/DocHandle';
	import { mark } from '$lib/overlays.svelte';
	import { addSourceRequest } from '$lib/overlays.svelte';
	import { folderNameProblem } from '$lib/util/paths';
	import ListFace from '../views/faces/ListFace.svelte';
	import Menu from '../views/Menu.svelte';
	import InputPopover from '../views/InputPopover.svelte';
	import NewFolderDialog from '../NewFolderDialog.svelte';
	import frog from '$assets/art/frog.txt?raw';
	import { openProjectSetup } from '$lib/views/project.svelte';
	import { metaDialog } from '$lib/overlays.svelte';
	import { isMove, readMove, movingNow, moveInto, type MovePayload } from '$lib/views/move.svelte';
	import SourceDialog from '../SourceDialog.svelte';
	import ScrollThumb from '../ScrollThumb.svelte';
	import FolderChips from '../views/FolderChips.svelte';
	import NewFab from '../views/NewFab.svelte';
	import { undoKey } from '$lib/views/FaceRows.svelte';
	import { contextMenu } from '$lib/overlays.svelte';
	import { createInView } from '$lib/views/FaceRows.svelte';
	import {
		ChevronRight,
		ChevronDown,
		ChevronUp,
		Folder as FolderIcon,
		FolderPlus,
		FilePlus,
		Pencil,
		Settings,
		Trash2,
		ExternalLink,
		Search,
		X,
		List,
		LayoutGrid,
		Bookmark,
		FolderInput,
		CalendarClock,
		SquareCheck,
		GitBranch,
		FileLock,
		FilePen
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
	let root: Folder | null = $state(null);
	const here = $derived(isRoot ? root : (folders.find((f) => f.id === unitId) ?? null));
	const subject = $derived(mark(isRoot ? 'source' : 'folder', view.slug));

	function siblingProblem(name: string, parentId: string | undefined, selfId: string | null) {
		const lower = name.trim().toLowerCase();
		return folderNameProblem(
			name,
			folders.some(
				(f) => f.id !== selfId && f.parentId === parentId && f.slug.toLowerCase() === lower
			)
		);
	}
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
			const [list, saved, r] = await Promise.all([
				Folder.list(),
				listSavedViewJSON(),
				Folder.fromID(`folder:${sourceId}:`).catch(() => null)
			]);
			folders = list;
			root = r;
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

	let presence = $state<FolderPresence>({ state: 'ok' });

	async function checkPresence() {
		const unit = unitId;
		const next = await folderPresence(unit);
		if (unitId === unit) presence = next;
	}

	$effect(() => {
		void unitId;
		void checkPresence();
	});
	$effect(() => onSourceReconciled(() => void checkPresence()));

	function goneFor(
		p: FolderPresence,
		kind: 'project' | 'folder'
	): { headline: string; detail: string; actions: GoneAction[] } | null {
		const close = { label: 'Close', run: () => editor.closeTab(view.id, false) };
		switch (p.state) {
			case 'removed':
				return {
					headline: 'this source was removed from limestone',
					detail:
						"The folder on disk wasn't touched. Add it again from settings to bring this back.",
					actions: [close]
				};
			case 'source_missing':
				return {
					headline: `the ${p.source} source isn't available`,
					detail:
						"Check that the drive or folder is connected. This opens by itself when it's back.",
					actions: [close]
				};
			case 'gone':
				return {
					headline: `couldn't find the ${kind} ${p.path.split('/').pop()}`,
					detail: `It was at \`${p.source}/${p.path}\`. It may have been moved, renamed or deleted outside Limestone.`,
					actions: [close]
				};
			default:
				return null;
		}
	}

	const gone = $derived.by(() => {
		const g = goneFor(presence, 'folder');
		if (g && presence.state === 'gone' && source) {
			g.actions = [{ label: `Go to ${sourceName(source)}`, run: openRoot }, ...g.actions];
		}
		return g;
	});

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
			view.save().catch((e) => reportError(e, "This view's changes couldn't be saved."));
		}, 250);
	});
	onDestroy(() => {
		if (saveTimer && !view.temporary)
			view.save().catch((e) => reportError(e, "This view's changes couldn't be saved."));
	});

	// ── Navigation: a place moves within its own tab, like a folder window ──────
	async function show(id: string, name: string) {
		const next = await View.forUnit(id, name);
		if (tab) editor.showViewInTab(tab, next);
		else editor.openView(next);
	}

	const openFolder = (f: Folder) => show(f.id, f.slug);
	const openInNewTab = async (f: Folder) => editor.openView(await View.forUnit(f.id, f.slug));

	function openCrumb(p: string) {
		const id = `folder:${sourceId}:${p}`;
		const f = folders.find((x) => x.id === id);
		show(id, f?.slug ?? p.split('/').pop() ?? p);
	}

	function openRoot() {
		if (source) show(`folder:${sourceId}:`, sourceName(source));
	}

	function onOpenRow(rowId: string, newTab: boolean | 'side' = false) {
		DocHandle.fromID(rowId)
			.then((d) => {
				const content = { type: 'markdown', handle: d } as const;
				if (newTab === 'side') editor.beside().openDetail(content, view.slug);
				else if (newTab || !tab) editor.openDoc(d);
				else if (editor.peer) editor.peer.openDetail(content, view.slug);
				else editor.showDocInTab(tab, d);
			})
			.catch(console.error);
	}

	// ── Sections fold; the folded set lives on the tab so it survives navigation ──
	type SectionId = 'projects' | 'folders' | 'files';
	const folded = $derived((tab?.state.folded as Record<string, boolean> | undefined) ?? {});

	function toggleFold(id: SectionId) {
		if (!tab) return;
		tab.state.folded = { ...folded, [id]: !folded[id] };
	}

	let selectedFolder: string | null = $state(null);
	let foldersShowAll = $state(false);
	let foldersHidden = $state(0);

	// ── Drag: documents and folders dropped on a folder chip or a crumb move there ──
	let overCrumb: string | null = $state(null);

	function crumbCanTake(targetPath: string, p: MovePayload | null): boolean {
		if (p?.kind === 'folder') {
			const fp = folderIdPath(p.id);
			return fp !== targetPath && !targetPath.startsWith(fp + '/');
		}
		return targetPath !== path;
	}

	function onCrumbDragOver(e: DragEvent, targetPath: string) {
		if (!isMove(e) || !crumbCanTake(targetPath, movingNow())) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		overCrumb = targetPath;
	}

	function onCrumbDrop(e: DragEvent, targetPath: string) {
		overCrumb = null;
		if (!isMove(e)) return;
		e.preventDefault();
		const p = readMove(e);
		if (p && crumbCanTake(targetPath, p))
			moveInto(folderId(sourceId, targetPath), p).then((moved) => {
				if (moved) loadFolders();
			});
	}

	// ── Actions: the page's menu is the folder's menu ──────────────────────────
	let menuOpen = $state(false);
	let menuEl: HTMLElement | null = $state(null);
	let nameOpen = $state(false);
	let sourceDialogOpen = $state(false);
	let newFolderOpen = $state(false);

	let fabEl: HTMLButtonElement | null = $state(null);
	const fabItems = [
		{ value: 'new-note', label: 'New note', icon: FilePlus },
		{ value: 'new-todo', label: 'New todo', icon: SquareCheck },
		{ value: 'new-folder', label: 'New folder', icon: FolderPlus }
	];

	async function newDoc(todo: boolean) {
		try {
			const id = await createInView(view, todo);
			if (id) onOpenRow(id);
			else addSourceRequest.open();
		} catch (e) {
			reportError(e, `A note couldn't be created in ${subject}.`, () => newDoc(todo));
		}
	}

	function onFabSelect(value: string) {
		if (value === 'new-folder') newFolderOpen = true;
		else void newDoc(value === 'new-todo');
	}

	// the blank page is the FAB's menu, where the pointer is
	function onBodyContextMenu(e: MouseEvent) {
		if ((e.target as Element).closest('.head, button, input, a')) return;
		e.preventDefault();
		contextMenu.show(
			e.clientX,
			e.clientY,
			fabItems.map((it) => ({
				label: it.label,
				icon: it.icon,
				action: () => onFabSelect(it.value)
			}))
		);
	}

	let confirmingDelete = $state(false);
	$effect(() => {
		if (!menuOpen) confirmingDelete = false;
	});

	function metaItem(f: Folder) {
		return {
			value: 'meta',
			label: 'Metadata…',
			icon: f.writesMeta ? FilePen : FileLock,
			hint: f.writesMeta ? 'On' : 'Off'
		};
	}

	// making things here is the fab's job; this menu is about the folder itself
	const menuItems = $derived([
		isRoot
			? { value: 'configure', label: 'Configure source', icon: Settings }
			: { value: 'rename', label: 'Rename', icon: Pencil },
		{ value: 'reveal', label: 'Reveal in file manager', icon: ExternalLink },
		...(here ? [metaItem(here)] : []),
		{ kind: 'divider' as const },
		view.temporary
			? { value: 'project', label: 'Turn into project', icon: Bookmark }
			: { value: 'unproject', label: 'Stop being a project', icon: Bookmark },
		{ kind: 'divider' as const },
		confirmingDelete
			? {
					value: 'confirm-delete',
					label: isRoot ? 'Confirm remove' : 'Confirm delete',
					icon: Trash2,
					danger: true
				}
			: {
					value: 'delete',
					label: isRoot ? 'Remove source' : 'Delete folder',
					icon: Trash2,
					keepOpen: true
				}
	]);

	// removing a source only forgets it: the folder on disk stays where it is
	async function removeThisSource() {
		try {
			await removeSource(sourceId);
			editor.closeTab(view.id, false);
		} catch (e) {
			reportError(e, `${subject} couldn't be removed.`);
		}
	}

	// the folder goes to the trash and the page steps up to its parent
	async function deleteFolder() {
		const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		try {
			await Folder.delete(sourceId, path);
			if (parent) openCrumb(parent);
			else openRoot();
		} catch (e) {
			Folder.reportOpError(e, `${subject} couldn't be deleted.`, deleteFolder);
		}
	}

	async function onMenuSelect(value: string) {
		if (value === 'delete') {
			confirmingDelete = true;
			return;
		}
		menuOpen = false;
		switch (value) {
			case 'rename':
				nameOpen = true;
				break;
			case 'reveal':
				if (source) revealItemInDir(`${source.path}/${path}`).catch(console.error);
				break;
			case 'configure':
				if (source) sourceDialogOpen = true;
				break;
			case 'meta':
				metaDialog.show(unitId);
				break;
			case 'project':
				openProjectSetup(editor, { id: unitId, name: crumbs.at(-1)?.slug ?? view.slug }, tab);
				break;
			case 'unproject':
				await view.unsave();
				break;
			case 'confirm-delete':
				if (isRoot) await removeThisSource();
				else await deleteFolder();
				break;
		}
	}

	async function createFolder(name: string) {
		try {
			const created = await Folder.create(name, sourceId, path ? { id: unitId, path } : undefined);
			await loadFolders();
			show(created.id, created.slug);
		} catch (e) {
			Folder.reportOpError(e, `${mark('folder', name)} couldn't be created.`, () =>
				createFolder(name)
			);
		}
	}

	async function commitName(raw: string) {
		const name = raw.trim();
		nameOpen = false;
		if (!name) return;
		try {
			const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
			const newId = await Folder.move(sourceId, path, `${parent}${name}`);
			const f = await Folder.fromID(newId);
			show(newId, f.slug);
		} catch (e) {
			Folder.reportOpError(e, `${subject} couldn't be renamed.`, () => commitName(raw));
		}
	}

	let bodyEl: HTMLDivElement | null = $state(null);

	// nothing here at all: no search, no folders, and the list came back empty
	let fileTotal: number | null = $state(null);
	const bare = $derived(!query && children.length === 0 && fileTotal === 0);
</script>

{#snippet fold(id: SectionId, label: string)}
	<button class="fold" class:folded={folded[id]} type="button" onclick={() => toggleFold(id)}>
		<span>{label}</span>
		<span class="fold-caret"><ChevronDown size={12} strokeWidth={2} /></span>
	</button>
{/snippet}

<svelte:window onkeydown={(e) => undoKey(e, view.id, bodyEl)} />

<div class="folder-page">
	{#if gone}
		<GonePage art={catBox} headline={gone.headline} detail={gone.detail} actions={gone.actions} />
	{:else}
		<div
			class="body"
			class:bare
			bind:this={bodyEl}
			oncontextmenu={onBodyContextMenu}
			role="presentation"
		>
			<div class="inner" class:bare>
				<header class="head">
					<span class="place-icon">
						{#if isRoot}<FolderInput size={18} strokeWidth={1.75} />{:else}<FolderIcon
								size={18}
								strokeWidth={1.75}
							/>{/if}
					</span>
					<nav class="crumbs" aria-label="Location">
						<button
							class="crumb"
							class:current={isRoot}
							class:over={overCrumb === ''}
							type="button"
							onclick={openRoot}
							ondragover={(e) => onCrumbDragOver(e, '')}
							ondragleave={() => overCrumb === '' && (overCrumb = null)}
							ondrop={(e) => onCrumbDrop(e, '')}
						>
							{#if root?.repo}
								<GitBranch size={13} strokeWidth={1.75} />
							{/if}
							{source ? sourceName(source) : ''}
						</button>
						{#each crumbs as c, i (c.path)}
							<ChevronRight size={14} strokeWidth={2} class="sep" />
							<button
								class="crumb"
								class:current={i === crumbs.length - 1}
								class:over={overCrumb === c.path}
								type="button"
								onclick={() => openCrumb(c.path)}
								ondragover={(e) => onCrumbDragOver(e, c.path)}
								ondragleave={() => overCrumb === c.path && (overCrumb = null)}
								ondrop={(e) => onCrumbDrop(e, c.path)}
							>
								{#if folders.find((f) => f.id === `folder:${sourceId}:${c.path}`)?.repo}
									<GitBranch size={13} strokeWidth={1.75} />
								{/if}
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
						<Search size={14} strokeWidth={1.75} />
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

				{#if projectChildren.length > 0}
					<div class="section-label">
						{@render fold('projects', 'Projects')}
					</div>
					{#if !folded.projects}
						<div class="strip">
							<FolderChips
								folders={projectChildren}
								{projects}
								whereOf={(f) => (query ? relDir(f) : '')}
								onOpen={openInNewTab}
								onChanged={loadFolders}
								bind:selected={selectedFolder}
							/>
						</div>
					{/if}
				{/if}

				{#if plainChildren.length > 0}
					<div class="section-label">
						{@render fold('folders', 'Folders')}
						{#if !folded.folders && (foldersHidden > 0 || foldersShowAll)}
							<button
								class="more-btn"
								type="button"
								onclick={() => (foldersShowAll = !foldersShowAll)}
							>
								{#if foldersShowAll}
									<ChevronUp size={13} strokeWidth={1.75} />
								{:else}
									<ChevronDown size={13} strokeWidth={1.75} />
								{/if}
								<span>{foldersShowAll ? 'fewer' : `${foldersHidden} more`}</span>
							</button>
						{/if}
					</div>
					{#if !folded.folders}
						<div class="strip">
							<FolderChips
								folders={plainChildren}
								rows={query ? 99 : 3}
								whereOf={(f) => (query ? relDir(f) : '')}
								onOpen={openFolder}
								onOpenNewTab={openInNewTab}
								onChanged={loadFolders}
								bind:selected={selectedFolder}
								bind:showAll={foldersShowAll}
								onHidden={(n) => (foldersHidden = n)}
							/>
						</div>
					{/if}
				{/if}

				<div class="section-label files">
					{@render fold('files', 'Files')}
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
				{#if face && !folded.files}
					<ListFace
						{view}
						{face}
						{onOpenRow}
						{scope}
						moveable
						editable={false}
						onTotal={(n) => (fileTotal = n)}
					/>
				{/if}
				{#if bare}
					<div class="nothing">
						<pre class="frog">{frog}</pre>
						<p class="bare-text">pretty empty...</p>
					</div>
				{/if}
			</div>
		</div>

		<ScrollThumb scroller={bodyEl} top={20} />

		<NewFab items={fabItems} onSelect={onFabSelect} bind:el={fabEl} />
	{/if}
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
<SourceDialog
	bind:open={sourceDialogOpen}
	mode="edit"
	{source}
	onSaved={() => getSource(sourceId).then((s) => (source = s))}
/>
<InputPopover
	bind:open={nameOpen}
	anchor={nameOpen ? menuEl : null}
	value={crumbs.at(-1)?.slug ?? ''}
	placeholder="Folder name"
	icon={FolderIcon}
	guard="file"
	problem={(v) => (v.trim() === here?.slug ? null : siblingProblem(v, here?.parentId, unitId))}
	onChange={(v) => commitName(String(v ?? ''))}
/>
<NewFolderDialog
	bind:open={newFolderOpen}
	onCreate={createFolder}
	problem={(v) => siblingProblem(v, unitId, null)}
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
		margin: 0 24px 0 18px;
		padding: 29px 0 10px 6px;
		background: linear-gradient(var(--menu-search-divider), var(--menu-search-divider)) bottom
			right / calc(100% - 6px) 1px no-repeat;
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
		display: inline-flex;
		align-items: center;
		gap: 5px;
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

	.crumb.over {
		background: var(--chip-bg-hover);
		box-shadow: inset 0 0 0 1.5px var(--color-accent);
	}

	.crumb-menu:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.search {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 32px;
		flex: 0 1 320px;
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

	/* a folder is a project page, so it takes the project column */
	.inner {
		max-width: var(--view-max-width, 1200px);
		margin: 0 auto;
		padding: 16px 16px 0 24px;
	}

	/* an empty folder fills the page so the frog can sit in the middle of what's left */
	.body.bare {
		padding-bottom: 0;
	}

	.inner.bare {
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		min-height: 100%;
	}

	.strip {
		margin: 0 24px 6px;
	}

	.nothing {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		margin: 0 24px;
		padding-bottom: 48px;
		color: var(--color-ui-dulled);
	}

	.frog {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.2;
		white-space: pre;
		user-select: none;
	}

	.bare-text {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.section-label {
		display: flex;
		align-items: center;
		height: 22px;
		margin: 28px 24px 8px;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-ui-muted);
	}

	.section-label:first-of-type {
		margin-top: 14px;
	}

	/* the label is the fold toggle; its caret shows on hover, and stays while folded */
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

	.more-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin-left: auto;
		height: 22px;
		padding: 0 6px 0 4px;
		border: none;
		border-radius: 5px;
		background: transparent;
		font: inherit;
		font-weight: 400;
		color: var(--color-ui-dulled);
		cursor: pointer;
	}

	.more-btn:hover {
		color: var(--color-text-secondary);
		background: var(--chip-bg);
	}

	/* folders: compact chips in a grid, like a place's shelves */
</style>
