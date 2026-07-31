<script lang="ts">
	import { Folder, Notebook } from '@lucide/svelte';

	let { dir, rootLabel = 'Root' }: { dir: string; rootLabel?: string } = $props();

	const segs = $derived(dir.split('/').filter(Boolean));
</script>

<span class="folder-crumb">
	{#if segs.length}
		<Folder size={12} strokeWidth={1.75} />
		{#each segs as s, i (i)}
			{#if i > 0}<span class="crumb-sep">›</span>{/if}
			<span class="crumb-seg" class:last={i === segs.length - 1}>{s}</span>
		{/each}
	{:else}
		<Notebook size={12} strokeWidth={1.75} />
		<span class="crumb-seg last">{rootLabel}</span>
	{/if}
</span>

<style>
	.folder-crumb {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		color: var(--color-ui-muted);
	}

	.folder-crumb :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-dulled);
	}

	.crumb-sep {
		color: var(--color-ui-dulled);
	}

	.crumb-seg {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.crumb-seg.last {
		color: var(--color-text-primary);
	}
</style>
