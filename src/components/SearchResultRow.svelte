<script lang="ts">
	import type { SearchResult } from '$lib/types/SearchResult';
	import { sourceName, type Source } from '$lib/models/Source';
	import { highlightTitle, highlightSnippet } from '$lib/util/highlight';
	import { Folder, Notebook, Hash, TextAlignStart, Box, Check } from '@lucide/svelte';

	let {
		result,
		source = null,
		active = false,
		onSelect
	}: {
		result: SearchResult;
		source?: Source | null;
		active?: boolean;
		onSelect: () => void;
	} = $props();

	function parentPath(relPath: string | null): string | null {
		if (!relPath) return null;
		const dir = relPath.split('/').slice(0, -1).join('/');
		return dir || null;
	}
</script>

<button class="result" class:row={source} class:active type="button" onclick={onSelect}>
	<span class="result-main">
		<span class="result-line">
			{#if result.kind === 'view'}
				{#if result.emoji}
					<span class="result-emoji">{result.emoji}</span>
				{:else}
					<Box size={14} />
				{/if}
			{:else if result.kind === 'source'}
				<Notebook size={14} />
			{:else if result.kind === 'group'}
				{#if result.group_type === 'folder'}
					<Folder size={14} />
				{:else}
					<Hash size={14} />
				{/if}
			{:else}
				<TextAlignStart size={14} />
			{/if}
			<span class="result-title">{@html highlightTitle(result.title, result.match_indices)}</span>
			{#if result.kind === 'document' && parentPath(result.rel_path)}
				<span class="result-path">{parentPath(result.rel_path)}</span>
			{/if}
		</span>
		{#if result.snippet}
			<span class="result-snippet">{@html highlightSnippet(result.snippet)}</span>
		{/if}
	</span>
	{#if source}
		<span class="src-chip"><Notebook size={11} />{sourceName(source)}</span>
	{/if}
	{#if active}
		<span class="result-check"><Check size={13} strokeWidth={2} /></span>
	{/if}
</button>

<style>
	.result {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		padding: 10px 14px;
		border: none;
		border-radius: var(--radius-ui);
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 14px;
		cursor: pointer;
		text-align: left;
	}

	.result.row,
	.result.active {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.result-main {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		min-width: 0;
	}

	.result:hover {
		background: rgba(255, 255, 255, 0.04);
	}

	/* the menu this replaced marked the current entry with an accent check */
	.result-check {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--color-accent);
	}

	.result.active .result-line :global(svg) {
		color: var(--color-accent);
	}

	.result-line {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--color-ui-muted);
		min-width: 0;
		max-width: 100%;
	}

	.result-emoji {
		font-size: 14px;
		line-height: 1;
		width: 14px;
		text-align: center;
		flex-shrink: 0;
	}

	.result-title {
		font-weight: 500;
		color: var(--color-text-primary);
		white-space: nowrap;
	}

	.result-path {
		font-size: 12px;
		color: var(--color-ui-muted);
		min-width: 0;
		flex-shrink: 4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.result-snippet {
		font-size: 12px;
		color: var(--color-text-secondary);
		padding-left: 22px;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		box-sizing: border-box;
	}

	.src-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-radius: 6px;
		background: var(--chip-bg);
		color: var(--color-text-secondary);
		font-size: 12px;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.src-chip :global(svg) {
		color: var(--color-ui-muted);
	}

	.result :global(mark) {
		background: color-mix(in srgb, var(--color-accent) 45%, transparent);
		color: inherit;
	}
</style>
