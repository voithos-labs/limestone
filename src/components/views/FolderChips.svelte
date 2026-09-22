<script lang="ts">
	import { Folder as FolderIcon, Bookmark, EllipsisVertical } from '@lucide/svelte';
	import type Folder from '$lib/models/Folder';
	import { ctxMenu, type CtxEntry } from '$lib/contextMenu.svelte';

	// Folders as a strip of compact chips: projects first with their own icon, plain folders
	// after. Shows a few rows and tucks the rest behind a quiet "show more"
	let {
		folders,
		projects = new Map(),
		rows = 3,
		whereOf,
		onOpen,
		context,
		onMenu
	}: {
		folders: Folder[];
		projects?: Map<string, { emoji: string }>;
		rows?: number;
		whereOf?: (f: Folder) => string; // a location hint under search
		onOpen: (f: Folder) => void;
		context?: (f: Folder) => CtxEntry[];
		onMenu?: (e: MouseEvent, f: Folder) => void;
	} = $props();

	const CHIP_MIN = 200;
	const GAP = 10;
	let width = $state(0);
	let showAll = $state(false);
	const perRow = $derived(Math.max(1, Math.floor((width + GAP) / (CHIP_MIN + GAP))));
	const cap = $derived(rows * perRow);
	const ordered = $derived(
		[...folders].sort(
			(a, b) =>
				Number(projects.has(b.id)) - Number(projects.has(a.id)) || a.slug.localeCompare(b.slug)
		)
	);
	const shown = $derived(showAll ? ordered : ordered.slice(0, cap));
</script>

<div class="folders" bind:clientWidth={width}>
	{#each shown as f (f.id)}
		{@const emoji = projects.get(f.id)?.emoji}
		{@const where = whereOf?.(f) ?? ''}
		<div
			class="folder"
			role="button"
			tabindex="-1"
			use:ctxMenu={() => context?.(f) ?? []}
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
</div>
{#if ordered.length > cap}
	<button class="show-more" type="button" onclick={() => (showAll = !showAll)}>
		{showAll ? 'Show fewer' : `Show ${ordered.length - cap} more`}
	</button>
{/if}

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

	.show-more {
		display: block;
		margin-top: 2px;
		padding: 4px 6px;
		border: none;
		border-radius: 5px;
		background: transparent;
		font: inherit;
		font-family: var(--font-ui);
		font-size: 11.5px;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.show-more:hover {
		color: var(--color-text-primary);
		background: var(--chip-bg);
	}
</style>
