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
	const COLS = 8;
	const ROW_H = 37;
	const HEAD_H = 28;
	const VIEW_H = 320;
	const OVERSCAN = ROW_H * 4;

	interface Row {
		top: number;
		height: number;
		label: string | null;
		start: number;
		emojis: Emoji[];
	}

	function layout(sections: { name: string | null; emojis: Emoji[] }[]) {
		const rows: Row[] = [];
		let top = 0;
		let start = 0;
		for (const s of sections) {
			if (s.name !== null) {
				rows.push({ top, height: HEAD_H, label: s.name, start, emojis: [] });
				top += HEAD_H;
			}
			for (let i = 0; i < s.emojis.length; i += COLS) {
				const emojis = s.emojis.slice(i, i + COLS);
				rows.push({ top, height: ROW_H, label: null, start, emojis });
				top += ROW_H;
				start += emojis.length;
			}
		}
		return { rows, height: top };
	}

	const GROUP_GRID = layout(GROUPS);

	let popEl: HTMLDivElement | null = $state(null);
	let searchEl: HTMLInputElement | null = $state(null);
	let scrollEl: HTMLDivElement | null = $state(null);
	let scrollTop = $state(0);
	let pos: { top: number; left: number } = $state({ top: 0, left: 0 });
	let query = $state('');
	let activeIndex = $state(-1);

	const results = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return null;
		return ALL.filter((e) => e.name.toLowerCase().includes(q) || e.slug.includes(q));
	});

	const nav = $derived(results ?? ALL);
	const grid = $derived(results ? layout([{ name: null, emojis: results }]) : GROUP_GRID);
	const visible = $derived(
		grid.rows.filter(
			(r) => r.top + r.height > scrollTop - OVERSCAN && r.top < scrollTop + VIEW_H + OVERSCAN
		)
	);

	$effect(() => {
		query;
		activeIndex = results && results.length > 0 ? 0 : -1;
		scrollTop = 0;
		if (scrollEl) scrollEl.scrollTop = 0;
	});

	function scrollActiveIntoView() {
		const row = grid.rows.find(
			(r) => activeIndex >= r.start && activeIndex < r.start + r.emojis.length
		);
		if (!row || !scrollEl) return;
		const bottom = row.top + row.height - scrollEl.clientHeight;
		if (row.top < scrollEl.scrollTop) scrollEl.scrollTop = row.top;
		else if (bottom > scrollEl.scrollTop) scrollEl.scrollTop = bottom;
	}

	function move(delta: number) {
		if (nav.length === 0) return;
		activeIndex = activeIndex < 0 ? 0 : Math.max(0, Math.min(nav.length - 1, activeIndex + delta));
		scrollActiveIntoView();
	}

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
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			open = false;
		} else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
			move(1);
			e.preventDefault();
		} else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
			move(-1);
			e.preventDefault();
		} else if (e.key === 'ArrowDown') {
			move(COLS);
			e.preventDefault();
		} else if (e.key === 'ArrowUp') {
			move(-COLS);
			e.preventDefault();
		} else if (e.key === 'Enter') {
			const em = nav[activeIndex];
			if (em) pick(em.emoji);
			e.preventDefault();
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

		<div
			class="ep-scroll"
			bind:this={scrollEl}
			style:max-height="{VIEW_H}px"
			onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
		>
			{#if grid.rows.length}
				<div class="ep-rows" style:height="{grid.height}px">
					{#each visible as row (row.top)}
						{#if row.label !== null}
							<div class="ep-group" style:top="{row.top}px" style:height="{row.height}px">
								{row.label}
							</div>
						{:else}
							<div class="ep-grid" style:top="{row.top}px" style:height="{row.height}px">
								{#each row.emojis as e, j (e.slug)}
									<button
										class="ep-cell"
										class:active={row.start + j === activeIndex}
										type="button"
										tabindex="-1"
										title={e.name}
										onmouseenter={() => (activeIndex = row.start + j)}
										onclick={() => pick(e.emoji)}>{e.emoji}</button
									>
								{/each}
							</div>
						{/if}
					{/each}
				</div>
			{:else}
				<p class="ep-empty">No emoji</p>
			{/if}
		</div>
	</div>
{/if}

<style>
	.ep {
		position: fixed;
		z-index: 1000;
		width: 320px;
		background: var(--color-bg);
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

	.ep-rows {
		position: relative;
	}

	.ep-group,
	.ep-grid {
		position: absolute;
		left: 0;
		right: 0;
	}

	.ep-group {
		font-size: 11px;
		font-weight: 600;
		line-height: 16px;
		letter-spacing: 0.03em;
		color: var(--color-ui-muted);
		padding: 8px 4px 4px;
	}

	.ep-grid {
		display: grid;
		grid-template-columns: repeat(8, minmax(0, 1fr));
		column-gap: 2px;
		padding-bottom: 2px;
	}

	.ep-cell {
		display: flex;
		align-items: center;
		justify-content: center;
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

	.ep-cell.active {
		background: var(--menu-item-hover);
	}

	.ep-empty {
		padding: 12px 8px;
		color: var(--color-ui-muted);
		font-size: 13px;
	}
</style>
