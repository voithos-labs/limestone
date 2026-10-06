<script lang="ts">
	import type View from '$lib/models/View.svelte';
	import type { FilterNode, ViewFace } from '$lib/models/View.svelte';
	import { onSourceReconciled } from '$lib/models/Source';
	import { FaceRows } from '$lib/views/FaceRows.svelte';
	import { PreviewCache, type Preview } from '$lib/views/previews';
	import NoteCard from '../NoteCard.svelte';
	import RowEditors from '../RowEditors.svelte';
	import { onMount, untrack } from 'svelte';

	let {
		view,
		face,
		onOpenRow,
		createSignal = 0,
		scope = null,
		editable = true
	}: {
		view: View;
		face: ViewFace;
		onOpenRow?: (rowId: string, newTab?: boolean | 'side') => void;
		createSignal?: number;
		scope?: FilterNode | null;
		editable?: boolean;
	} = $props();

	const rows = new FaceRows(
		() => view,
		() => face,
		() => scope
	);
	let editors: RowEditors = $state()!;

	const checkField = $derived(rows.checkField);
	const lanes = $derived(rows.lanes);

	const previewCache = new PreviewCache();
	let previews: Record<string, Preview> = $state({});
	$effect(() => {
		const list = rows.rows;
		const sources = rows.sources;
		if (list.length === 0 || sources.length === 0) return;
		let live = true;
		previewCache.fetch(list, sources).then((p) => {
			if (live) previews = p;
		});
		return () => {
			live = false;
		};
	});

	// ── Loading ────────────────────────────────────────────────────────────────
	let reloadTimer: ReturnType<typeof setTimeout> | null = null;
	let lastSig: string | null = null;
	let lastFaceId: string | null = null;

	$effect(() => {
		const sig = rows.signature();
		const faceId = face.id;
		if (lastSig === null) {
			lastSig = sig;
			lastFaceId = faceId;
			return;
		}
		if (sig === lastSig) {
			lastFaceId = faceId;
			return;
		}
		const faceChanged = faceId !== lastFaceId;
		lastSig = sig;
		lastFaceId = faceId;
		if (reloadTimer) clearTimeout(reloadTimer);
		if (faceChanged) rows.load(true);
		else reloadTimer = setTimeout(() => rows.load(true), 100);
	});

	$effect(() => onSourceReconciled(() => rows.load(true)));

	onMount(() => {
		rows.load();
		rows.init();
		return () => {
			if (reloadTimer) clearTimeout(reloadTimer);
			if (settleTimer) clearTimeout(settleTimer);
		};
	});

	// ── Layout ─────────────────────────────────────────────────────────────────
	const GAP = 12;
	const COL_MIN = 220;
	let gridW = $state(0);
	let heights: Record<string, number> = $state({});
	let settledW = $state(0);
	let settleTimer: ReturnType<typeof setTimeout> | null = null;
	let animate = $state(false);

	// Only the container width is debounced: card widths are pinned to it, so a
	// window drag can't change any card's height, and positions never go stale.
	$effect(() => {
		const w = gridW;
		if (settleTimer) clearTimeout(settleTimer);
		if (w <= 0 || untrack(() => settledW) === 0) {
			settledW = w;
			return;
		}
		settleTimer = setTimeout(() => (settledW = w), 120);
	});

	const colCount = $derived(Math.max(1, Math.floor((settledW + GAP) / (COL_MIN + GAP))));

	// Cards are hidden until every one has reported a real height: a single card's
	// position depends on all the others, so a partial set means wrong positions.
	const measured = $derived(
		!rows.loading && rows.rows.length > 0 && rows.rows.every((r) => heights[r.id] !== undefined)
	);

	$effect(() => {
		if (!measured || untrack(() => animate)) return;
		requestAnimationFrame(() => requestAnimationFrame(() => (animate = true)));
	});

	const cardLayout = $derived.by(() => {
		const colW = (settledW - (colCount - 1) * GAP) / colCount;
		const tot = new Array(colCount).fill(0);
		const pos: Record<string, { x: number; y: number }> = {};
		for (const r of rows.rows) {
			let ci = 0;
			for (let i = 1; i < colCount; i++) if (tot[i] < tot[ci]) ci = i;
			pos[r.id] = { x: ci * (colW + GAP), y: tot[ci] };
			tot[ci] += (heights[r.id] ?? 0) + GAP;
		}
		return { colW, pos, height: Math.max(0, ...tot) };
	});

	// ── Create: the bar's "+" makes a note and opens it ────────────────────────
	let creating = false;
	async function createNote() {
		if (creating) return;
		creating = true;
		try {
			const id = await rows.create('');
			if (id) onOpenRow?.(id);
		} finally {
			creating = false;
		}
	}

	let lastCreateSignal = -1;
	$effect(() => {
		const sig = createSignal;
		if (lastCreateSignal === -1) {
			lastCreateSignal = sig;
			return;
		}
		if (sig !== lastCreateSignal) {
			lastCreateSignal = sig;
			createNote();
		}
	});
</script>

{#if rows.error}
	<p class="error">{rows.error}</p>
{/if}

<div class="masonry-face">
	<div
		class="lf-grid"
		class:measured
		role="list"
		bind:clientWidth={gridW}
		style:height="{measured ? cardLayout.height : 0}px"
	>
		{#if settledW > 0}
			{#each rows.rows as row, i (row.id)}
				{@const p = cardLayout.pos[row.id]}
				<div
					class="card-slot"
					class:animated={animate}
					style:width="{cardLayout.colW}px"
					style:transform="translate({p.x}px, {p.y}px)"
					style:--in-delay="{Math.min(i * 8, 90)}ms"
					bind:clientHeight={heights[row.id]}
				>
					<NoteCard
						{row}
						{rows}
						{editors}
						{checkField}
						inline={lanes.inline}
						meta={lanes.meta}
						editMode={editable}
						preview={previews[row.id]}
						body="flow"
						onOpen={onOpenRow}
					/>
				</div>
			{/each}
		{/if}
	</div>

	{#if rows.loading}
		<div class="lf-footer"></div>
	{:else if rows.rows.length === 0}
		<div class="lf-empty">{rows.query ? 'No matches' : 'No documents'}</div>
	{:else if rows.total > rows.rows.length}
		<button
			class="lf-footer more"
			type="button"
			disabled={rows.loadingMore}
			onclick={() => rows.loadMore()}
		>
			{rows.loadingMore ? 'Loading' : `${rows.total - rows.rows.length} more`}
		</button>
	{:else}
		<div class="lf-footer">
			{rows.rows.length}
			{rows.rows.length === 1 ? 'doc' : 'docs'}
		</div>
	{/if}
</div>

<RowEditors bind:this={editors} {view} {rows} onOpen={onOpenRow} />

<style>
	.error {
		margin: 0 24px 12px;
		padding: 8px 12px;
		font-size: 12px;
		color: var(--color-accent);
		background: var(--error-bg);
		border-radius: var(--radius-ui);
	}

	.masonry-face {
		margin: 0 24px;
		font-family: var(--font-ui);
	}

	.lf-grid {
		position: relative;
	}

	.card-slot {
		position: absolute;
		top: 0;
		left: 0;
	}

	.lf-grid:not(.measured) .card-slot {
		visibility: hidden;
	}

	/* Cards fade up once the grid settles */
	.lf-grid.measured .card-slot {
		animation: card-in 140ms ease both;
		animation-delay: var(--in-delay, 0ms);
	}

	@keyframes card-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.card-slot.animated {
		transition: transform 160ms ease;
	}

	.lf-empty {
		padding: 28px 14px;
		text-align: center;
		font-size: 13px;
		color: var(--color-ui-muted);
	}

	.lf-footer {
		display: block;
		width: 100%;
		padding: 14px 16px 16px;
		border: 0;
		background: transparent;
		font: inherit;
		font-family: var(--font-ui);
		font-size: 11px;
		color: var(--color-ui-muted);
		text-align: center;
	}

	.more {
		cursor: pointer;
	}

	.more:hover:not(:disabled) {
		color: var(--color-text-secondary);
	}

	.more:disabled {
		cursor: default;
	}
</style>
