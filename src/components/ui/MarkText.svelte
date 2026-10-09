<script lang="ts">
	import { toastParts } from '#lib/overlays.svelte.js';
	import { FolderInput, Folder, Box, Hash, TextAlignStart } from '@lucide/svelte';

	let { text }: { text: string } = $props();

	const ICONS = {
		source: FolderInput,
		project: Box,
		folder: Folder,
		tag: Hash,
		note: TextAlignStart
	};
</script>

{#each toastParts(text) as part, i (i)}
	{#if part.kind}
		{@const Icon = ICONS[part.kind]}
		<span class="chip"
			><Icon size={11} strokeWidth={2} /><span class="chip-text">{part.text}</span></span
		>
	{:else}
		{part.text}
	{/if}
{/each}

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 220px;
		padding: 0 6px;
		border-radius: 5px;
		background: var(--chip-bg);
		vertical-align: middle;
		font-weight: 500;
		line-height: 1.35;
		white-space: nowrap;
	}

	.chip :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.chip-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
