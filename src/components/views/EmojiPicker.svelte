<script lang="ts">
	import { untrack } from 'svelte';
	import groups from 'unicode-emoji-json/data-by-group.json';
	import { Search } from '@lucide/svelte';

	let {
		open = $bindable(false),
		anchor,
		onPick
	}: {
		open: boolean;
		anchor: HTMLElement | null;
		onPick: (emoji: string) => void;
	} = $props();

	interface Emoji {
		emoji: string;
		name: string;
		slug: string;
	}

	interface Group {
		name: string;
		emojis: Emoji[];
	}

	const GROUPS = groups as Group[];
	const ALL: Emoji[] = GROUPS.flatMap((g) => g.emojis);

	let popEl: HTMLDivElement | null = $state(null);
	let searchEl: HTMLInputElement | null = $state(null);
	let pos: { top: number; left: number } = $state({ top: 0, left: 0 });
	let query = $state('');

	const results = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return null;
		return ALL.filter((e) => e.name.includes(q) || e.slug.includes(q)).slice(0, 180);
	});

	function pick(emoji: string) {
		onPick(emoji);
		open = false;
	}

	function position() {
		if (!anchor || !popEl) return;
		const a = anchor.getBoundingClientRect();
		const m = popEl.getBoundingClientRect();
		const margin = 4;
		let top = a.bottom + margin;
		let left = a.left;
		if (top + m.height > window.innerHeight - 8) top = Math.max(8, a.top - m.height - margin);
		if (left + m.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - m.width);
		pos = { top, left };
	}

	function onDocPointerDown(e: PointerEvent) {
		if (!open) return;
		if (popEl?.contains(e.target as Node)) return;
		if (anchor?.contains(e.target as Node)) return;
		open = false;
	}

	function onKey(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			e.preventDefault();
			open = false;
		}
	}

	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			wasOpen = true;
			untrack(() => {
				query = '';
			});
			queueMicrotask(() => {
				position();
				searchEl?.focus();
			});
			window.addEventListener('resize', position);
			window.addEventListener('scroll', position, true);
			document.addEventListener('pointerdown', onDocPointerDown);
			document.addEventListener('keydown', onKey);
			return () => {
				window.removeEventListener('resize', position);
				window.removeEventListener('scroll', position, true);
				document.removeEventListener('pointerdown', onDocPointerDown);
				document.removeEventListener('keydown', onKey);
			};
		}
		if (!open) wasOpen = false;
	});
</script>

{#if open}
	<div
		class="ep"
		bind:this={popEl}
		style:top="{pos.top}px"
		style:left="{pos.left}px"
		role="menu"
		tabindex="-1"
	>
		<div class="ep-search">
			<Search size={14} strokeWidth={1.75} />
			<input
				class="ep-input"
				type="text"
				bind:this={searchEl}
				bind:value={query}
				placeholder="Search emoji…"
			/>
		</div>

		<div class="ep-scroll">
			{#if results}
				{#if results.length}
					<div class="ep-grid">
						{#each results as e (e.slug)}
							<button class="ep-cell" type="button" title={e.name} onclick={() => pick(e.emoji)}
								>{e.emoji}</button
							>
						{/each}
					</div>
				{:else}
					<p class="ep-empty">No emoji</p>
				{/if}
			{:else}
				{#each GROUPS as g (g.name)}
					<div class="ep-group">{g.name}</div>
					<div class="ep-grid">
						{#each g.emojis as e (e.slug)}
							<button class="ep-cell" type="button" title={e.name} onclick={() => pick(e.emoji)}
								>{e.emoji}</button
							>
						{/each}
					</div>
				{/each}
			{/if}
		</div>
	</div>
{/if}

<style>
	.ep {
		position: fixed;
		z-index: 1000;
		width: 320px;
		background: var(--color-bg-opaque, var(--color-bg));
		border: 1px solid var(--color-border);
		border-radius: 10px;
		box-shadow: var(--menu-shadow);
		padding: 8px;
		font-family: var(--font-ui);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.ep-search {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		margin-bottom: 6px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		color: var(--color-ui-muted);
		flex-shrink: 0;
	}

	.ep-input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 13px;
	}

	.ep-input::placeholder {
		color: var(--color-ui-muted);
	}

	.ep-scroll {
		max-height: 320px;
		overflow-y: auto;
		overflow-x: hidden;
		scrollbar-width: thin;
		scrollbar-color: var(--menu-scrollbar-thumb) transparent;
	}

	.ep-scroll::-webkit-scrollbar {
		width: 6px;
	}

	.ep-scroll::-webkit-scrollbar-thumb {
		background: var(--menu-scrollbar-thumb);
		border-radius: 3px;
	}

	.ep-group {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.03em;
		color: var(--color-ui-muted);
		padding: 8px 4px 4px;
	}

	.ep-grid {
		display: grid;
		grid-template-columns: repeat(8, minmax(0, 1fr));
		gap: 2px;
	}

	.ep-cell {
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		min-width: 0;
		overflow: hidden;
		border: none;
		border-radius: 6px;
		background: transparent;
		font-size: 20px;
		line-height: 1;
		cursor: pointer;
	}

	.ep-cell:hover {
		background: var(--menu-item-hover);
	}

	.ep-empty {
		padding: 12px 8px;
		color: var(--color-ui-muted);
		font-size: 13px;
	}
</style>
