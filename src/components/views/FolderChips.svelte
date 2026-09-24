<script lang="ts">
	import {
		Folder as FolderIcon,
		Bookmark,
		EllipsisVertical,
		FolderPlus,
		ChevronDown,
		ChevronUp
	} from '@lucide/svelte';
	import type Folder from '$lib/models/Folder';
	import { ctxMenu, type CtxEntry } from '$lib/contextMenu.svelte';
	import {
		startMove,
		endMove,
		isMove,
		readMove,
		movingNow,
		type MovePayload
	} from '$lib/views/dragMove';

	// Folders as a strip of compact chips: projects first with their own icon, plain folders
	// after. Shows a few rows and tucks the rest behind a quiet "show more"
	let {
		folders,
		projects = new Map(),
		rows = 3,
		whereOf,
		onOpen,
		context,
		onMenu,
		onDrop,
		onCreate,
		showAll = $bindable(false),
		onHidden
	}: {
		folders: Folder[];
		projects?: Map<string, { emoji: string }>;
		rows?: number;
		whereOf?: (f: Folder) => string; // a location hint under search
		onOpen: (f: Folder) => void;
		context?: (f: Folder) => CtxEntry[];
		onMenu?: (e: MouseEvent, f: Folder) => void;
		onDrop?: (target: Folder, payload: MovePayload) => void; // chips take drops, and drag themselves
		showAll?: boolean; // past the row cap; the page owns the toggle
		onHidden?: (n: number) => void; // how many chips the cap is hiding
		onCreate?: (name: string) => void; // a trailing chip that names and makes another folder
	} = $props();

	let naming = $state(false);
	let draft = $state('');

	function commitNew() {
		const name = draft.trim();
		naming = false;
		draft = '';
		if (name) onCreate?.(name);
	}

	function onNewKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			(e.currentTarget as HTMLInputElement).blur();
		} else if (e.key === 'Escape') {
			e.stopPropagation();
			draft = '';
			(e.currentTarget as HTMLInputElement).blur();
		}
	}

	function focusNew(node: HTMLInputElement) {
		node.focus();
	}

	let overId: string | null = $state(null);

	// a folder can't take itself or anything above it
	function canTake(f: Folder, p: MovePayload | null): boolean {
		if (p?.kind === 'folder') return p.id !== f.id && !f.id.startsWith(p.id + '/');
		return true;
	}

	function onDragOver(e: DragEvent, f: Folder) {
		if (!onDrop || !isMove(e) || !canTake(f, movingNow())) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		overId = f.id;
	}

	function onDragDrop(e: DragEvent, f: Folder) {
		overId = null;
		if (!onDrop || !isMove(e)) return;
		e.preventDefault();
		const p = readMove(e);
		if (p && canTake(f, p)) onDrop(f, p);
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

<div class="folders" bind:clientWidth={width}>
	{#each shown as f (f.id)}
		{@const emoji = projects.get(f.id)?.emoji}
		{@const where = whereOf?.(f) ?? ''}
		<div
			class="folder"
			class:over={overId === f.id}
			role="button"
			tabindex="-1"
			draggable={!!onDrop}
			use:ctxMenu={() => context?.(f) ?? []}
			ondragstart={(e) => startMove(e, { kind: 'folder', id: f.id })}
			ondragend={endMove}
			ondragover={(e) => onDragOver(e, f)}
			ondragleave={() => {
				if (overId === f.id) overId = null;
			}}
			ondrop={(e) => onDragDrop(e, f)}
			onclick={() => onOpen(f)}
			onkeydown={(e) => {
				if (e.key === 'Enter') onOpen(f);
			}}
		>
			{#if emoji}
				<span class="emoji">{emoji}</span>
			{:else if projects.has(f.id)}
				<Bookmark size={16} strokeWidth={1.75} />
			{:else}
				<FolderIcon size={16} strokeWidth={1.75} />
			{/if}
			<span class="name">
				{f.slug}{#if where}<span class="where">{where}</span>{/if}
			</span>
			{#if onMenu}
				<button
					class="menu"
					type="button"
					tabindex="-1"
					aria-label="More"
					onclick={(e) => {
						e.stopPropagation();
						onMenu(e, f);
					}}
				>
					<EllipsisVertical size={14} strokeWidth={1.75} />
				</button>
			{/if}
		</div>
	{/each}
	{#if onCreate && naming}
		<label class="folder new naming">
			<FolderPlus size={16} strokeWidth={1.75} />
			<input
				class="name-input"
				placeholder="New folder"
				spellcheck="false"
				bind:value={draft}
				use:focusNew
				onblur={commitNew}
				onkeydown={onNewKey}
			/>
		</label>
	{:else if onCreate}
		<button class="folder new" type="button" onclick={() => (naming = true)}>
			<FolderPlus size={16} strokeWidth={1.75} />
			<span class="name">New folder</span>
		</button>
	{/if}
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

	.folder.new {
		border: none;
		background: transparent;
		font: inherit;
		font-family: var(--font-ui);
		font-size: 13px;
		color: var(--color-ui-muted);
		text-align: left;
	}

	.folder.new:hover,
	.folder.new.naming {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.name-input {
		flex: 1 1 auto;
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		font: inherit;
		color: var(--color-text-primary);
		outline: none;
	}

	.name-input::placeholder {
		color: var(--color-ui-muted);
	}

	.folder:hover,
	.folder:focus-visible {
		background: var(--chip-bg-hover);
		outline: none;
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
