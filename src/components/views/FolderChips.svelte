<script
	lang="ts"
	generics="F extends { id: string; slug: string; parentId?: string; repo?: boolean; writesMeta?: boolean }"
>
	import {
		Folder as FolderIcon,
		FolderInput,
		Bookmark,
		EllipsisVertical,
		GitBranch,
		ChevronRight,
		Pencil,
		ExternalLink,
		FilePen,
		FileLock,
		Trash2
	} from '@lucide/svelte';
	import Folder, { folderIdPath, folderIdSource, isSourceRoot } from '$lib/models/Folder';
	import { getSource } from '$lib/models/Source';
	import View from '$lib/models/View.svelte';
	import { contextMenu, ctxMenu, type CtxEntry } from '$lib/contextMenu.svelte';
	import { metaDialog } from '$lib/metaDialog.svelte';
	import { toasts } from '$lib/toasts.svelte';
	import { isValidSegment } from '$lib/util/paths';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import {
		startMove,
		endMove,
		isMove,
		readMove,
		movingNow,
		canMoveInto,
		moveInto
	} from '$lib/views/dragMove';

	// Folders as a strip of compact chips: projects first with their own icon, plain folders
	// after. Shows a few rows and tucks the rest behind a quiet "show more"
	let {
		folders,
		projects = new Map(),
		rows = 3,
		whereOf,
		onOpen,
		onChanged,
		showAll = $bindable(false),
		onHidden,
		selected = $bindable(null)
	}: {
		folders: F[];
		projects?: Map<string, { emoji: string }>;
		rows?: number;
		whereOf?: (f: F) => string; // a location hint under search
		onOpen: (f: F) => void;
		onChanged?: () => void;
		showAll?: boolean; // past the row cap; the page owns the toggle
		onHidden?: (n: number) => void; // how many chips the cap is hiding
		selected?: string | null;
	} = $props();

	function onWindowPointerDown(e: PointerEvent) {
		if (!selected) return;
		if ((e.target as Element | null)?.closest?.('.folder, button, .ctx-menu')) return;
		selected = null;
	}

	let overId: string | null = $state(null);

	function onDragOver(e: DragEvent, f: F) {
		if (renamingId || !isMove(e) || !canMoveInto(f.id, movingNow())) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		overId = f.id;
	}

	function onDragDrop(e: DragEvent, f: F) {
		overId = null;
		if (!isMove(e)) return;
		e.preventDefault();
		const p = readMove(e);
		if (p && canMoveInto(f.id, p))
			moveInto(f.id, p).then((moved) => {
				if (moved) onChanged?.();
			});
	}

	let renamingId: string | null = $state(null);
	let draft = $state('');
	let renameEl: HTMLInputElement | null = $state(null);

	function startRename(f: F) {
		renamingId = f.id;
		draft = f.slug;
		queueMicrotask(() => {
			renameEl?.focus();
			renameEl?.select();
		});
	}

	function renameInvalid(f: F): boolean {
		const name = draft.trim();
		if (name === f.slug || name === '') return false;
		if (!isValidSegment(name) || name.startsWith('.')) return true;
		const lower = name.toLowerCase();
		return folders.some(
			(o) => o.id !== f.id && o.parentId === f.parentId && o.slug.toLowerCase() === lower
		);
	}

	async function commitRename(f: F) {
		if (renamingId !== f.id) return;
		const name = draft.trim();
		const invalid = renameInvalid(f);
		renamingId = null;
		if (!name || name === f.slug || invalid) return;
		const oldPath = folderIdPath(f.id);
		const dir = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : '';
		try {
			const newId = await Folder.move(folderIdSource(f.id), oldPath, dir ? `${dir}/${name}` : name);
			if (selected === f.id) selected = newId;
			onChanged?.();
		} catch (e) {
			toasts.push(Folder.describeOpError(e, "The folder couldn't be renamed."));
		}
	}

	function onRenameKey(e: KeyboardEvent, f: F) {
		e.stopPropagation();
		if (e.key === 'Enter') commitRename(f);
		else if (e.key === 'Escape') renamingId = null;
	}

	let confirmDelete: string | null = $state(null);
	$effect(() => {
		if (!contextMenu.open) confirmDelete = null;
	});

	async function deleteFolder(f: F) {
		confirmDelete = null;
		try {
			await Folder.delete(folderIdSource(f.id), folderIdPath(f.id));
			if (selected === f.id) selected = null;
			onChanged?.();
		} catch (e) {
			toasts.push(Folder.describeOpError(e, "That folder couldn't be deleted."));
		}
	}

	function reveal(f: F) {
		getSource(folderIdSource(f.id))
			.then((s) => revealItemInDir(`${s.path}/${folderIdPath(f.id)}`))
			.catch(console.error);
	}

	function entries(f: F): CtxEntry[] {
		if (isSourceRoot(f.id)) return [];
		const isProject = projects.has(f.id);
		return [
			{ label: 'Open', icon: ChevronRight, action: () => onOpen(f) },
			{ label: 'Rename', icon: Pencil, action: () => startRename(f) },
			{ label: 'Reveal in file manager', icon: ExternalLink, action: () => reveal(f) },
			{
				label: 'Metadata…',
				icon: f.writesMeta === false ? FileLock : FilePen,
				action: () => metaDialog.show(f.id)
			},
			{ divider: true },
			{
				label: isProject ? 'Stop being a project' : 'Turn into project',
				icon: Bookmark,
				action: () => {
					View.forUnit(f.id, f.slug)
						.then((v) => (isProject ? v.unsave() : v.save()))
						.then(() => onChanged?.())
						.catch(console.error);
				}
			},
			{ divider: true },
			confirmDelete === f.id
				? { label: 'Confirm delete', icon: Trash2, danger: true, action: () => deleteFolder(f) }
				: {
						label: 'Delete folder',
						icon: Trash2,
						keepOpen: true,
						action: () => (confirmDelete = f.id)
					}
		];
	}

	const CHIP_MIN = 200;
	const GAP = 10;
	let width = $state(0);
	const perRow = $derived(Math.max(1, Math.floor((width + GAP) / (CHIP_MIN + GAP))));
	const cap = $derived(rows * perRow);
	const ordered = $derived(
		[...folders].sort(
			(a, b) =>
				Number(projects.has(b.id)) - Number(projects.has(a.id)) || a.slug.localeCompare(b.slug)
		)
	);
	const shown = $derived(showAll ? ordered : ordered.slice(0, cap));
	$effect(() => {
		onHidden?.(showAll ? 0 : Math.max(0, ordered.length - cap));
	});
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="folders" bind:clientWidth={width}>
	{#each shown as f (f.id)}
		{@const emoji = projects.get(f.id)?.emoji}
		{@const where = whereOf?.(f) ?? ''}
		{@const root = isSourceRoot(f.id)}
		<div
			class="folder"
			class:over={overId === f.id}
			class:selected={selected === f.id}
			role="button"
			tabindex="-1"
			draggable={!root && renamingId !== f.id}
			use:ctxMenu={() => entries(f)}
			ondragstart={(e) => startMove(e, { kind: 'folder', id: f.id })}
			ondragend={endMove}
			ondragover={(e) => onDragOver(e, f)}
			ondragleave={() => {
				if (overId === f.id) overId = null;
			}}
			ondrop={(e) => onDragDrop(e, f)}
			onclick={() => (selected = f.id)}
			ondblclick={() => renamingId !== f.id && onOpen(f)}
			onkeydown={(e) => {
				if (e.key === 'Enter') onOpen(f);
			}}
		>
			{#if emoji}
				<span class="emoji">{emoji}</span>
			{:else if projects.has(f.id)}
				<Bookmark size={16} strokeWidth={1.75} />
			{:else if root}
				<FolderInput size={16} strokeWidth={1.75} />
			{:else if f.repo}
				<GitBranch size={16} strokeWidth={1.75} />
			{:else}
				<FolderIcon size={16} strokeWidth={1.75} />
			{/if}
			{#if renamingId === f.id}
				<input
					class="rename"
					class:invalid={renameInvalid(f)}
					type="text"
					bind:value={draft}
					bind:this={renameEl}
					onkeydown={(e) => onRenameKey(e, f)}
					onblur={() => commitRename(f)}
					onclick={(e) => e.stopPropagation()}
					ondblclick={(e) => e.stopPropagation()}
				/>
			{:else}
				<span class="name">
					{f.slug}{#if where}<span class="where">{where}</span>{/if}
				</span>
			{/if}
			{#if !root}
				<button
					class="menu"
					type="button"
					tabindex="-1"
					aria-label="More"
					onclick={(e) => {
						e.stopPropagation();
						contextMenu.showAt(e.currentTarget as HTMLElement, () => entries(f));
					}}
				>
					<EllipsisVertical size={14} strokeWidth={1.75} />
				</button>
			{/if}
		</div>
	{/each}
</div>

<style>
	.folders {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 10px;
		font-family: var(--font-ui);
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

	.folder.selected {
		background: var(--accent-a22);
	}

	.folder.selected:hover {
		background: var(--accent-a30);
	}

	.folder.over {
		background: var(--chip-bg-hover);
		box-shadow: inset 0 0 0 1.5px var(--color-accent);
	}

	.folder > :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.emoji {
		width: 16px;
		text-align: center;
		font-size: 14px;
		line-height: 1;
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.rename {
		flex: 1;
		min-width: 0;
		padding: 0;
		border: none;
		background: transparent;
		font: inherit;
		color: inherit;
		outline: none;
	}

	.rename.invalid {
		text-decoration: underline;
		text-decoration-color: var(--error-fg);
		text-underline-offset: 3px;
	}

	.where {
		margin-left: 6px;
		font-size: 11px;
		color: var(--color-ui-muted);
	}

	.menu {
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

	.folder:hover .menu,
	.folder:focus-within .menu {
		opacity: 1;
	}

	.menu:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}
</style>
