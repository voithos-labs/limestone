<script lang="ts">
	import type View from '$lib/models/View.svelte';
	import type { FilterNode, MemberRow, ViewFace } from '$lib/models/View.svelte';
	import { onSourceReconciled } from '$lib/models/Source';
	import { FaceRows } from '$lib/views/FaceRows.svelte';
	import { PreviewCache, type Preview } from '$lib/views/previews';
	import { rawStatefulValue } from '$lib/views/fieldValue';
	import { highlightTitle } from '$lib/util/highlight';
	import RowChips from '../RowChips.svelte';
	import RowEditors from '../RowEditors.svelte';
	import NoteCard from '../NoteCard.svelte';
	import { Check, EllipsisVertical, ArrowUpRight, Plus } from '@lucide/svelte';
	import { onMount, tick } from 'svelte';

	let {
		view,
		face,
		onOpenRow,
		createSignal = 0,
		scope = null
	}: {
		view: View;
		face: ViewFace;
		onOpenRow?: (rowId: string) => void;
		createSignal?: number;
		scope?: FilterNode | null;
	} = $props();

	const rows = new FaceRows(
		() => view,
		() => face,
		() => scope
	);
	let editors: RowEditors = $state()!;

	// browse: click a row to open, empties hidden. edit: click a value to change it, an explicit
	// Open button, empties shown as placeholders so they can be set
	const editMode = $derived(face.config.edit_in_place === true);
	const layout = $derived(face.config.layout === 'grid' ? 'grid' : 'list');
	const checkField = $derived(rows.checkField);
	const lanes = $derived(rows.lanes);

	// cards carry a preview; rows don't
	const previewCache = new PreviewCache();
	let previews: Record<string, Preview> = $state({});
	$effect(() => {
		if (layout !== 'grid') return;
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
		};
	});

	// ── Rename in place ────────────────────────────────────────────────────────
	let renamingId: string | null = $state(null);
	let renameDraft = $state('');

	function startRename(e: MouseEvent, row: MemberRow) {
		if (!editMode) return;
		e.stopPropagation();
		renamingId = row.id;
		renameDraft = row.title;
	}

	function commitRename() {
		const id = renamingId;
		renamingId = null;
		if (id) rows.rename(id, renameDraft);
	}

	function onRenameKey(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Enter') {
			e.preventDefault();
			(e.currentTarget as HTMLInputElement).blur();
		} else if (e.key === 'Escape') {
			renamingId = null;
		}
	}

	function renameFocus(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	// ── Keyboard: arrows move, Enter opens, Space toggles the checkbox ──────────
	let listEl: HTMLDivElement | null = $state(null);
	let focusIdx = $state(-1);

	function focusRow(i: number) {
		const els = Array.from(listEl?.querySelectorAll<HTMLElement>('.row[data-id]') ?? []);
		if (els.length === 0) return;
		focusIdx = Math.max(0, Math.min(els.length - 1, i));
		els[focusIdx].focus();
	}

	function onListKey(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || renamingId) return;
		const row = rows.rows[focusIdx];
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			focusRow(focusIdx + 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			focusRow(focusIdx - 1);
		} else if (e.key === 'Enter' && row) {
			e.preventDefault();
			onOpenRow?.(row.id);
		} else if (e.key === ' ' && row && checkField) {
			e.preventDefault();
			rows.toggle(row, checkField);
		}
	}

	// ── Create: an inline row at the bottom, Enter to add ───────────────────────
	let newTitle = $state('');
	let newEl: HTMLInputElement | null = $state(null);
	let creating = false;

	async function createNote(title: string, open: boolean) {
		if (creating) return;
		creating = true;
		try {
			const id = await rows.create(title);
			if (!id) return;
			newTitle = '';
			if (open) onOpenRow?.(id);
			else {
				await tick();
				newEl?.focus();
			}
		} finally {
			creating = false;
		}
	}

	// warn, never block: a title that already exists gets saved as "<name> 2"
	let titleTaken = $state(false);
	let takenTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const title = newTitle.trim();
		if (takenTimer) clearTimeout(takenTimer);
		if (!title) {
			titleTaken = false;
			return;
		}
		takenTimer = setTimeout(async () => {
			const taken = await rows.titleTaken(title);
			if (newTitle.trim() === title) titleTaken = taken;
		}, 150);
	});

	function onNewKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (newTitle.trim()) createNote(newTitle, false);
		} else if (e.key === 'Escape') {
			newTitle = '';
			(e.currentTarget as HTMLInputElement).blur();
		}
	}

	// the bar's "+" still works: it creates and opens, like it always did
	let lastCreateSignal = -1;
	$effect(() => {
		const sig = createSignal;
		if (lastCreateSignal === -1) {
			lastCreateSignal = sig;
			return;
		}
		if (sig !== lastCreateSignal) {
			lastCreateSignal = sig;
			createNote('', true);
		}
	});
</script>

{#if rows.error}
	<p class="error">{rows.error}</p>
{/if}

{#if layout === 'grid'}
	<div class="grid" role="list">
		{#each rows.rows as row (row.id)}
			<NoteCard
				{row}
				{rows}
				{editors}
				{checkField}
				inline={lanes.inline}
				meta={lanes.meta}
				{editMode}
				preview={previews[row.id]}
				onOpen={onOpenRow}
			/>
		{/each}
		{#if !rows.loading}
			<button class="new-card" type="button" onclick={() => createNote('', true)}>
				<Plus size={16} strokeWidth={2} />
				<span>{checkField ? 'New todo' : 'New note'}</span>
			</button>
		{/if}
	</div>
	{#if !rows.loading && rows.rows.length === 0 && rows.query}
		<div class="empty">No matches</div>
	{:else if !rows.loading && rows.total > rows.rows.length}
		<button class="more" type="button" disabled={rows.loadingMore} onclick={() => rows.loadMore()}>
			{rows.loadingMore ? 'Loading…' : `Show more · ${rows.total - rows.rows.length} left`}
		</button>
	{/if}
{:else}
	<div class="list-face" bind:this={listEl} role="list" tabindex="-1" onkeydown={onListKey}>
		{#each rows.rows as row, i (row.id)}
			{@const done = checkField ? rawStatefulValue(row, checkField) === true : false}
			<div
				class="row"
				class:done
				class:editable={editMode}
				role="listitem"
				data-id={row.id}
				tabindex={i === focusIdx ? 0 : -1}
				onclick={() => {
					if (!editMode) onOpenRow?.(row.id);
				}}
				onfocus={() => (focusIdx = i)}
				oncontextmenu={(e) => editors.menu(e, row.id)}
			>
				{#if checkField}
					<button
						class="check"
						class:done
						type="button"
						tabindex="-1"
						role="checkbox"
						aria-checked={done}
						aria-label={done ? 'Mark not done' : 'Mark done'}
						onclick={(e) => {
							e.stopPropagation();
							rows.toggle(row, checkField);
						}}
					>
						<span class="box"><Check size={12} strokeWidth={3} /></span>
					</button>
				{/if}
				{#if renamingId === row.id}
					<span class="name rename-wrap" role="presentation" onclick={(e) => e.stopPropagation()}>
						<span class="rename-ghost">{renameDraft || ' '}</span>
						<input
							class="rename"
							bind:value={renameDraft}
							use:renameFocus
							onblur={commitRename}
							onkeydown={onRenameKey}
							spellcheck="false"
						/>
					</span>
				{:else}
					<span
						class="name"
						class:editable={editMode}
						role="presentation"
						onclick={(e) => startRename(e, row)}
					>
						{@html highlightTitle(
							row.title || 'untitled',
							rows.searchHits[row.id]?.match_indices ?? []
						)}
					</span>
				{/if}
				<span class="inline">
					<RowChips
						{row}
						fields={lanes.inline}
						{rows}
						{editMode}
						onEdit={(r, f, a) => editors.edit(r, f, a)}
						onTags={(r, a) => editors.tags(r, a)}
					/>
				</span>
				<span class="spacer"></span>
				<span class="values">
					<RowChips
						{row}
						fields={lanes.meta}
						{rows}
						{editMode}
						onEdit={(r, f, a) => editors.edit(r, f, a)}
						onTags={(r, a) => editors.tags(r, a)}
					/>
				</span>
				{#if editMode}
					<button
						class="row-btn"
						type="button"
						tabindex="-1"
						aria-label="Open"
						title="Open"
						onclick={(e) => {
							e.stopPropagation();
							onOpenRow?.(row.id);
						}}
					>
						<ArrowUpRight size={14} strokeWidth={1.75} />
					</button>
				{:else}
					<button
						class="row-btn"
						type="button"
						tabindex="-1"
						aria-label="More"
						onclick={(e) => editors.menu(e, row.id)}
					>
						<EllipsisVertical size={14} strokeWidth={1.75} />
					</button>
				{/if}
			</div>
		{/each}

		{#if !rows.loading}
			<label class="row new">
				<span class="new-mark">
					{#if checkField}<span class="dashed"></span>{:else}<Plus
							size={16}
							strokeWidth={1.75}
						/>{/if}
				</span>
				<input
					class="new-input"
					class:taken={titleTaken}
					type="text"
					placeholder={checkField ? 'New todo, Enter to add' : 'New note, Enter to add'}
					bind:value={newTitle}
					bind:this={newEl}
					onkeydown={onNewKey}
				/>
			</label>
		{/if}

		{#if !rows.loading && rows.rows.length === 0 && rows.query}
			<div class="empty">No matches</div>
		{:else if !rows.loading && rows.total > rows.rows.length}
			<button
				class="more"
				type="button"
				disabled={rows.loadingMore}
				onclick={() => rows.loadMore()}
			>
				{rows.loadingMore ? 'Loading…' : `Show more · ${rows.total - rows.rows.length} left`}
			</button>
		{/if}
	</div>
{/if}

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

	.list-face {
		margin: 0 24px;
		font-family: var(--font-ui);
		font-size: 13px;
		outline: none;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 16px;
		margin: 0 24px;
		font-family: var(--font-ui);
	}

	/* a card-shaped create button that sits last */
	.new-card {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: 120px;
		border: 1px dashed var(--color-border);
		border-radius: 10px;
		background: transparent;
		font: inherit;
		font-family: var(--font-ui);
		font-size: 13px;
		color: var(--color-ui-muted);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.new-card:hover {
		background: var(--row-hover-bg, rgba(127, 127, 127, 0.06));
		color: var(--color-text-primary);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 46px;
		margin: 0 -10px;
		padding: 0 10px;
		border-radius: 8px;
		cursor: pointer;
		transition: background-color 80ms ease;
	}

	.row.editable {
		cursor: default;
	}

	.row:hover,
	.row:focus {
		background: var(--row-hover-bg, rgba(127, 127, 127, 0.06));
		outline: none;
	}

	.row:focus-visible {
		box-shadow: inset 2px 0 0 var(--color-accent);
	}

	.check,
	.new-mark {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		color: var(--color-ui-muted);
	}

	.check {
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
	}

	/* a real checkbox: hollow until done, then filled with the accent */
	.box {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border: 1.5px solid var(--color-ui-muted);
		border-radius: 5px;
		color: transparent;
		transition:
			background-color 100ms ease,
			border-color 100ms ease,
			color 100ms ease;
	}

	.check:hover .box {
		border-color: var(--color-text-secondary);
	}

	.check.done .box {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: #fff;
	}

	.row.done .name {
		color: var(--color-ui-muted);
		text-decoration: line-through;
		text-decoration-color: var(--color-border);
	}

	.name {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: 15px;
		letter-spacing: -0.005em;
		color: var(--color-text-primary);
	}

	.name.editable {
		cursor: text;
	}

	.name :global(mark) {
		background: var(--search-mark-bg, rgba(255, 200, 0, 0.35));
		color: inherit;
		border-radius: 2px;
	}

	/* the input is stacked on a ghost of its own text, so it is exactly as wide as what it says
	   and nothing after it moves while you type */
	.name.rename-wrap {
		display: inline-grid;
		grid-template-columns: max-content;
		overflow: visible;
		cursor: text;
	}

	.rename-ghost,
	.rename {
		grid-area: 1 / 1;
		font: inherit;
		font-size: 15px;
		letter-spacing: -0.005em;
		white-space: pre;
	}

	.rename-ghost {
		visibility: hidden;
	}

	.rename {
		width: 0;
		min-width: 100%;
		box-sizing: border-box;
		border: 0;
		padding: 0;
		background: transparent;
		color: var(--color-text-primary);
		outline: none;
	}

	/* what the note is: pills right after the title, clipped before the title is */
	.inline {
		flex: 0 1 auto;
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
	}

	.spacer {
		flex: 1 1 0;
		min-width: 12px;
	}

	/* when and how much: content-sized, packed right */
	.values {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		max-width: 50%;
		overflow: hidden;
		white-space: nowrap;
	}

	.row-btn {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
		opacity: 0;
		transition:
			opacity 80ms ease,
			background-color 80ms ease;
	}

	.row:hover .row-btn,
	.row:focus .row-btn,
	.row:focus-within .row-btn {
		opacity: 1;
	}

	.row-btn:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	/* the inline add row: a dashed mark and a bare input that reads as the next row */
	.row.new {
		cursor: text;
	}

	.row.new:hover {
		background: transparent;
	}

	.new-mark {
		opacity: 0.6;
	}

	.row.new:focus-within .new-mark {
		opacity: 1;
	}

	.dashed {
		width: 14px;
		height: 14px;
		border: 1.5px dashed currentColor;
		border-radius: 3px;
	}

	.new-input {
		flex: 1 1 auto;
		min-width: 0;
		height: 100%;
		border: 0;
		background: transparent;
		font: inherit;
		font-size: 15px;
		color: var(--color-text-primary);
		outline: none;
	}

	.new-input::placeholder {
		color: var(--color-ui-muted);
	}

	.new-input.taken {
		text-decoration: underline;
		text-decoration-color: var(--error-fg);
		text-underline-offset: 3px;
	}

	.empty {
		margin: 0 24px;
		padding: 28px 14px;
		text-align: center;
		font-family: var(--font-ui);
		color: var(--color-ui-muted);
	}

	.more {
		display: block;
		width: calc(100% - 48px);
		margin: 0 24px;
		padding: 10px;
		font-family: var(--font-ui);
		border: 0;
		background: transparent;
		font: inherit;
		font-size: 12px;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.more:hover:not(:disabled) {
		color: var(--color-text-primary);
	}
</style>
