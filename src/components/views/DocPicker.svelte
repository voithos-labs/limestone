<script lang="ts">
	import type { DocPicker } from '$lib/views/docPicker.svelte';
	import SearchResultRow from '../SearchResultRow.svelte';
	import { Plus } from '@lucide/svelte';

	let {
		picker,
		query = ''
	}: {
		picker: DocPicker;
		query?: string;
	} = $props();

	// ~10 rows of results, then it scrolls (fewer when hits carry snippets)
	const MAX_H = 420; // >:)

	let panelEl: HTMLDivElement | null = $state(null);
	let pos: { top: number; left: number; width: number } = $state({ top: 0, left: 0, width: 0 });

	// The bar this hangs off scrolls horizontally, so the panel is fixed and re-placed
	// rather than laid out inside it (the bar clips its own overflow).
	function place() {
		const a = picker.anchor?.getBoundingClientRect();
		if (!a) return;
		pos = { top: a.bottom + 6, left: a.left, width: a.width };
	}

	function onDocPointerDown(e: PointerEvent) {
		if (panelEl?.contains(e.target as Node)) return;
		if (picker.anchor?.contains(e.target as Node)) return;
		picker.open = false;
	}

	$effect(() => {
		if (!picker.open) return;
		place();
		window.addEventListener('resize', place);
		window.addEventListener('scroll', place, true);
		document.addEventListener('pointerdown', onDocPointerDown);
		return () => {
			window.removeEventListener('resize', place);
			window.removeEventListener('scroll', place, true);
			document.removeEventListener('pointerdown', onDocPointerDown);
		};
	});

	const newTitle = $derived(query.trim());
</script>

{#if picker.open}
	<div
		class="doc-picker"
		bind:this={panelEl}
		style:top="{pos.top}px"
		style:left="{pos.left}px"
		style:width="{pos.width}px"
		style:max-height="min({MAX_H}px, calc(100vh - {pos.top + 12}px))"
		role="listbox"
		tabindex="-1"
	>
		{#each picker.results as result (result.id)}
			<SearchResultRow
				{result}
				active={result.id === picker.activeId}
				onSelect={() => picker.pick(result.id)}
			/>
		{:else}
			<p class="empty">{newTitle ? 'No matches' : 'Nothing here yet'}</p>
		{/each}

		{#if picker.create}
			<button class="new-doc" type="button" onclick={() => picker.create?.(newTitle || undefined)}>
				<Plus size={14} strokeWidth={2} />
				<span>{newTitle ? `New document "${newTitle}"` : 'New document'}</span>
			</button>
		{/if}
	</div>
{/if}

<style>
	.doc-picker {
		position: fixed;
		z-index: 1000;
		display: flex;
		flex-direction: column;
		/* no bottom padding: the create row is a flush footer */
		padding: 8px 8px 0;
		overflow-y: auto;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: 0 10px 22px rgba(0, 0, 0, 0.16);
		scrollbar-width: none;
	}

	.doc-picker::-webkit-scrollbar {
		display: none;
	}

	.empty {
		margin: 0;
		padding: 10px 14px;
		color: var(--color-ui-muted);
		font-size: 13px;
	}

	/* stays reachable once the list scrolls */
	.new-doc {
		position: sticky;
		bottom: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		box-sizing: border-box;
		padding: 0 14px;
		border: none;
		border-top: 1px solid var(--color-border);
		border-radius: 0 0 7px 7px;
		margin: 4px -8px 0;
		background: var(--color-bg);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 14px;
		text-align: left;
		cursor: pointer;
	}

	/* the chip token is translucent, so composite it: a see-through footer shows the
       scrolled list running underneath it */
	.new-doc:hover {
		color: var(--color-text-primary);
		background: linear-gradient(var(--chip-bg-hover), var(--chip-bg-hover)), var(--color-bg);
	}
</style>
