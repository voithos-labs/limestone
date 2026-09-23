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
	import { Check, SquareArrowOutUpRight, Plus, ChevronDown } from '@lucide/svelte';
	import { onMount, tick } from 'svelte';
	import { startMove, endMove } from '$lib/views/dragMove';

	let {
		view,
		face,
		onOpenRow,
		createSignal = 0,
		scope = null,
		onTotal,
		autoFocus = true,
		onReorder,
		moveable = false
	}: {
		view: View;
		face: ViewFace;
		onOpenRow?: (rowId: string, newTab?: boolean) => void;
		createSignal?: number;
		scope?: FilterNode | null;
		onTotal?: (n: number) => void; // how many rows the current search and scope leave
		autoFocus?: boolean; // the first row takes focus once loaded, if nothing else has it
		onReorder?: (ids: string[]) => void; // rows drag into an order; the face keeps it unless told otherwise
		moveable?: boolean; // rows drag out as documents to drop on a folder (no in-list reorder then)
	} = $props();

	const rows = new FaceRows(
		() => view,
		() => face,
		() => scope
	);
	let editors: RowEditors = $state()!;

	$effect(() => {
		if (!rows.loading) onTotal?.(rows.total);
	});

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

	// ── Keyboard ───────────────────────────────────────────────────────────────
	// Arrows move between items (rows: up/down; cards: all four, a row at a time vertically),
	// Home/End jump, Enter opens, Space ticks the checkbox, Escape lets go. Any open menu or
	// popover owns the keyboard instead, as does any text field. With nothing focused, the first
	// list on the page takes the first arrow press and focuses its first (or last) item
	let listEl: HTMLDivElement | null = $state(null);
	let focusIdx = $state(-1);

	const ITEM = '[data-id].row, [data-id].card';

	function items(): HTMLElement[] {
		return Array.from(listEl?.querySelectorAll<HTMLElement>(ITEM) ?? []);
	}

	// the first row is selected on arrival, so the list reads as a place with a cursor in it
	let focusedOnce = false;
	$effect(() => {
		if (!autoFocus || rows.loading || focusedOnce || rows.rows.length === 0) return;
		focusedOnce = true;
		const a = document.activeElement as HTMLElement | null;
		const free = !a || a === document.body || !!a.closest('.view-body');
		if (!free || a?.closest('input, textarea, [contenteditable], .editor')) return;
		tick().then(() => focusItem(0));
	});

	// ── Reorder: drag a row (no handle) and the others make room; the row's own click is
	// swallowed once a drag happened so a drop never opens the note ────────────────────
	const DRAG_PX = 4;
	let reorderArm: { id: string; from: number; x: number; y: number } | null = null;
	let drag: { id: string; from: number; to: number; dy: number; h: number } | null = $state(null);
	let rowTops: number[] = [];
	let swallowClick = false;

	function armReorder(e: PointerEvent, id: string, i: number) {
		if (moveable || e.button !== 0 || layout === 'grid') return;
		const t = e.target as HTMLElement;
		if (t.closest('button, input, a, .value, .rename-wrap')) return;
		reorderArm = { id, from: i, x: e.clientX, y: e.clientY };
		window.addEventListener('pointermove', onReorderMove);
		window.addEventListener('pointerup', onReorderUp);
		window.addEventListener('keydown', onReorderKey, true);
	}

	function onReorderMove(e: PointerEvent) {
		const arm = reorderArm;
		if (!arm) return;
		if (!drag) {
			if (Math.hypot(e.clientX - arm.x, e.clientY - arm.y) < DRAG_PX) return;
			const els = items();
			rowTops = els.map((el) => el.getBoundingClientRect().top);
			const h = els[arm.from]?.getBoundingClientRect().height ?? 46;
			drag = { id: arm.id, from: arm.from, to: arm.from, dy: 0, h };
			(document.activeElement as HTMLElement | null)?.blur();
		}
		const d = drag;
		const dy = e.clientY - arm.y;
		// the dragged row's centre against the others' midpoints, the same rule as the tabs
		const centre = rowTops[d.from] + d.h / 2 + dy;
		let to = 0;
		for (let i = 0; i < rowTops.length; i++) {
			if (i === d.from) continue;
			if (centre > rowTops[i] + d.h / 2) to = i < d.from ? i + 1 : i;
		}
		if (d.from > 0 && centre <= rowTops[0] + d.h / 2) to = 0;
		drag = { ...d, dy, to: Math.max(0, Math.min(rowTops.length - 1, to)) };
	}

	function onReorderUp() {
		const d = drag;
		if (d) {
			swallowClick = true;
			if (d.to !== d.from) {
				const ids = rows.rows.map((r) => r.id);
				ids.splice(d.to, 0, ids.splice(d.from, 1)[0]);
				rows.reorder(ids);
				if (onReorder) onReorder(ids);
				else face.config.order = ids;
			}
		}
		endReorder();
	}

	function onReorderKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && drag) {
			e.stopPropagation();
			endReorder();
		}
	}

	function endReorder() {
		reorderArm = null;
		drag = null;
		window.removeEventListener('pointermove', onReorderMove);
		window.removeEventListener('pointerup', onReorderUp);
		window.removeEventListener('keydown', onReorderKey, true);
	}

	function rowShift(i: number): string | null {
		const d = drag;
		if (!d) return null;
		if (i === d.from) return `translateY(${d.dy}px)`;
		if (d.from < i && i <= d.to) return `translateY(${-d.h}px)`;
		if (d.to <= i && i < d.from) return `translateY(${d.h}px)`;
		return null;
	}

	function onListClickCapture(e: MouseEvent) {
		if (!swallowClick) return;
		swallowClick = false;
		e.stopPropagation();
		e.preventDefault();
	}

	// the cursor arriving takes over from the keyboard cursor: the focused row lets go so
	// the hover highlight is the only one
	function onListPointerMove() {
		if (drag) return;
		const a = document.activeElement as HTMLElement | null;
		if (a && listEl?.contains(a) && a.matches('.row, .card')) a.blur();
	}

	function focusItem(i: number) {
		const els = items();
		if (els.length === 0) return;
		focusIdx = Math.max(0, Math.min(els.length - 1, i));
		els[focusIdx].focus({ preventScroll: true });
		els[focusIdx].scrollIntoView({ block: 'nearest' });
	}

	// how many cards share the first card's row: that's the vertical stride
	function perRow(): number {
		const els = items();
		if (els.length < 2) return 1;
		const top = els[0].offsetTop;
		let n = 1;
		while (n < els.length && els[n].offsetTop === top) n++;
		return n;
	}

	function keyboardBusy(): boolean {
		const a = document.activeElement as HTMLElement | null;
		if (a && (a.matches('input, textarea, select') || a.isContentEditable)) return true;
		return !!document.querySelector('.menu, .pop, .overlay, .ctx-menu, [role="dialog"]');
	}

	function onListKey(e: KeyboardEvent) {
		if (keyboardBusy() || renamingId) return;
		const row = rows.rows[focusIdx];
		const grid = layout === 'grid';
		const stride = grid ? perRow() : 1;
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				focusItem(focusIdx + stride);
				break;
			case 'ArrowUp':
				e.preventDefault();
				focusItem(focusIdx - stride);
				break;
			case 'ArrowRight':
				if (!grid) return;
				e.preventDefault();
				focusItem(focusIdx + 1);
				break;
			case 'ArrowLeft':
				if (!grid) return;
				e.preventDefault();
				focusItem(focusIdx - 1);
				break;
			case 'Home':
				e.preventDefault();
				focusItem(0);
				break;
			case 'End':
				e.preventDefault();
				focusItem(items().length - 1);
				break;
			case 'Enter':
				if (!row) return;
				e.preventDefault();
				onOpenRow?.(row.id);
				break;
			case ' ':
				if (!row || !checkField) return;
				e.preventDefault();
				if (rows.memberOf(row, checkField)) rows.toggle(row, checkField);
				break;
			case 'Escape':
				(document.activeElement as HTMLElement | null)?.blur();
				focusIdx = -1;
				break;
		}
	}

	// the page's first list catches an arrow press when nothing that uses arrows has focus:
	// the body, a scroller, a container clicked into. Otherwise the browser scrolls the page
	function onDocKey(e: KeyboardEvent) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		if (e.defaultPrevented || keyboardBusy()) return;
		const a = document.activeElement as HTMLElement | null;
		if (a && a !== document.body && a !== document.documentElement) {
			if (a.matches('button, a, [role="button"], [role="menuitem"], [tabindex="0"]')) return;
			if (a.closest('.list-face, .grid')) return;
		}
		const first = document.querySelector<HTMLElement>(ITEM);
		if (!first || !listEl?.contains(first)) return;
		e.preventDefault();
		focusItem(e.key === 'ArrowDown' ? 0 : items().length - 1);
	}

	$effect(() => {
		document.addEventListener('keydown', onDocKey);
		return () => document.removeEventListener('keydown', onDocKey);
	});

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
	<div
		class="grid"
		role="list"
		bind:this={listEl}
		tabindex="-1"
		onkeydown={onListKey}
		onpointermove={onListPointerMove}
	>
		{#each rows.rows as row, i (row.id)}
			<NoteCard
				onFocus={() => (focusIdx = i)}
				{row}
				{rows}
				{editors}
				{checkField}
				inline={lanes.inline}
				meta={lanes.meta}
				{editMode}
				preview={previews[row.id]}
				onOpen={onOpenRow}
				{moveable}
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
			<ChevronDown size={14} strokeWidth={1.75} />
			<span>{rows.loadingMore ? 'Loading' : `${rows.total - rows.rows.length} more`}</span>
		</button>
	{/if}
{:else}
	<div
		class="list-face"
		class:reordering={!!drag}
		bind:this={listEl}
		role="list"
		tabindex="-1"
		onkeydown={onListKey}
		onpointermove={onListPointerMove}
		onclickcapture={onListClickCapture}
	>
		{#each rows.rows as row, i (row.id)}
			{@const member = checkField ? rows.memberOf(row, checkField) : false}
			{@const done = member && checkField ? rawStatefulValue(row, checkField) === true : false}
			<div
				class="row"
				class:done
				class:editable={editMode}
				class:lifted={drag?.id === row.id}
				style:transform={rowShift(i)}
				role="listitem"
				data-id={row.id}
				tabindex="-1"
				draggable={moveable}
				ondragstart={(e) => startMove(e, { kind: 'doc', id: row.id })}
				ondragend={endMove}
				onpointerdown={(e) => armReorder(e, row.id, i)}
				onclick={(e) => {
					if (!editMode) onOpenRow?.(row.id, e.ctrlKey || e.metaKey);
				}}
				onauxclick={(e) => {
					if (e.button === 1) onOpenRow?.(row.id, true);
				}}
				onfocus={() => (focusIdx = i)}
				oncontextmenu={(e) => editors.menu(e, row.id)}
			>
				{#if checkField && member}
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
				{:else if checkField}
					<span class="check inert" title="Not a todo"><span class="box"></span></span>
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
				<button
					class="row-btn"
					type="button"
					tabindex="-1"
					aria-label="Open in new tab"
					title="Open in new tab"
					onclick={(e) => {
						e.stopPropagation();
						onOpenRow?.(row.id, true);
					}}
				>
					<SquareArrowOutUpRight size={14} strokeWidth={1.75} />
				</button>
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
					placeholder={checkField ? 'New todo' : 'New note'}
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
				<ChevronDown size={14} strokeWidth={1.75} />
				<span>{rows.loadingMore ? 'Loading' : `${rows.total - rows.rows.length} more`}</span>
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
		outline: none;
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

	/* while a row is carried the others slide out of its way; the carried one rides above */
	.list-face.reordering .row {
		transition: transform 70ms ease-out;
	}

	.list-face.reordering,
	.list-face.reordering .row {
		cursor: grabbing;
		user-select: none;
	}

	.row.lifted {
		position: relative;
		z-index: 2;
		transition: none;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
	}

	.row:hover,
	.row:focus {
		background: var(--row-hover-bg, rgba(127, 127, 127, 0.06));
		outline: none;
	}

	.row:focus-visible {
		background: var(--chip-bg);
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
		box-sizing: border-box;
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

	/* a note outside the checkbox's unit keeps the slot, but the box is only a trace */
	.check.inert {
		cursor: default;
	}

	.check.inert .box {
		border-color: var(--color-border);
		opacity: 0.55;
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

	/* the row's end cap: full height, flush to the row's edge, dipped on hover */
	.row-btn {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		align-self: stretch;
		width: 40px;
		margin: 0 -10px 0 -4px;
		padding: 0;
		border: 0;
		border-radius: 0 8px 8px 0;
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

	/* the draft mark is the checkbox's ghost: same size, same corner, dashed */
	.dashed {
		box-sizing: border-box;
		width: 18px;
		height: 18px;
		border: 1.5px dashed var(--color-ui-muted);
		border-radius: 5px;
		opacity: 0.7;
	}

	.row.new:focus-within .dashed {
		opacity: 1;
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

	/* the tail of the list reads as one more quiet row: a chevron where the checkbox would
	   be, the count where the title would be */
	.more {
		display: flex;
		align-items: center;
		gap: 12px;
		width: calc(100% + 20px);
		height: 40px;
		margin: 0 -10px;
		padding: 0 10px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		font: inherit;
		font-family: var(--font-ui);
		font-size: 12.5px;
		color: var(--color-ui-dulled);
		cursor: pointer;
		transition:
			background-color 80ms ease,
			color 80ms ease;
	}

	.more :global(svg) {
		flex-shrink: 0;
		width: 18px;
	}

	.more:hover:not(:disabled) {
		background: var(--row-hover-bg, rgba(127, 127, 127, 0.06));
		color: var(--color-text-secondary);
	}

	.more:disabled {
		cursor: default;
	}
</style>
