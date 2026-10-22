<script module lang="ts">
	import { SvelteSet } from 'svelte/reactivity';

	const failedImages = new SvelteSet<string>();
</script>

<script lang="ts">
	import { Check, PanelRight } from '@lucide/svelte';
	import { openHow } from '#lib/views/FaceRows.svelte.js';
	import { startMove, endMove } from '#lib/views/move.svelte.js';
	import type { MemberRow, ViewField } from '#lib/models/View.svelte.js';
	import type { FaceRows } from '#lib/views/FaceRows.svelte.js';
	import type { Preview } from '#lib/views/FaceRows.svelte.js';
	import { isStatusField } from '#lib/models/View.svelte.js';
	import { checkDone, statusOf, statusKind, statusColor } from '#lib/views/fieldValue.js';
	import StatusIcon from './StatusIcon.svelte';
	import { leave } from '#lib/views/FaceRows.svelte.js';
	import { highlightTitle, highlightSnippet } from '#lib/util/dom.js';
	import RowChips from './RowChips.svelte';
	import PdfIcon from '../ui/PdfIcon.svelte';
	import type RowEditors from './editors/RowEditors.svelte';
	import { nameGuard } from '#lib/util/paths.js';
	import { selectionIn, restoreSelection } from '#lib/util/dom.js';

	// A note as a card: the list row folded onto three lines. Same lanes, same chips, same two
	// modes, so a grid and a board read like the list they sit next to
	let {
		row,
		rows,
		editors,
		checkField = null,
		inline = [],
		meta = [],
		editMode = false,
		preview,
		body = 'fixed',
		onOpen,
		moveable = false,
		onFocus
	}: {
		row: MemberRow;
		rows: FaceRows;
		editors: RowEditors;
		checkField?: ViewField | null;
		inline?: ViewField[];
		meta?: ViewField[];
		editMode?: boolean;
		preview?: Preview;
		body?: 'fixed' | 'flow' | 'brief' | 'none'; // grid: a fixed window; masonry: as tall as it is; board: a couple of lines, only when there are some
		onOpen?: (rowId: string, newTab?: boolean | 'side') => void;
		moveable?: boolean;
		onFocus?: () => void;
	} = $props();

	// a card stacks its fields in the face's display order, whichever lane a row would put them in
	const fields = $derived.by(() => {
		const ids = new Set([...inline, ...meta].map((f) => f.id));
		return rows.shown.filter((f) => ids.has(f.id));
	});
	const member = $derived(checkField ? rows.memberOf(row, checkField) : false);
	const done = $derived(member && checkField ? checkDone(row, checkField) : false);
	const hit = $derived(rows.searchHits[row.id]);
	const snippet = $derived(hit?.snippet?.trim() ? highlightSnippet(hit.snippet) : '');

	// ── Rename in place ────────────────────────────────────────────────────────
	let renaming = $state(false);
	let draft = $state('');
	let renameRange: [number, number] | null = null;

	function startRename(e: MouseEvent) {
		if (!editMode) return;
		e.stopPropagation();
		renameRange = selectionIn(e.currentTarget as HTMLElement, row.title);
		renaming = true;
		draft = row.title;
	}

	let renameTaken = $state(false);
	let renameToken = 0;
	$effect(() => {
		const draftNow = draft;
		const target = renaming ? row : null;
		const token = ++renameToken;
		renameTaken = false;
		if (!target || !draftNow.trim()) return;
		const timer = setTimeout(async () => {
			const taken = await rows.renameTaken(target, draftNow);
			if (token === renameToken) renameTaken = taken;
		}, 150);
		return () => clearTimeout(timer);
	});

	function commitRename() {
		renaming = false;
		if (!renameTaken) rows.rename(row.id, draft);
	}

	function onRenameKey(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Enter') {
			e.preventDefault();
			(e.currentTarget as HTMLTextAreaElement).blur();
		} else if (e.key === 'Escape') renaming = false;
	}

	function renameFocus(node: HTMLTextAreaElement) {
		restoreSelection(node, renameRange);
	}

	const imgOk = $derived(!!preview?.image && !failedImages.has(preview.image));
</script>

<div
	class="card"
	class:done
	class:editable={editMode}
	role="listitem"
	data-id={row.id}
	data-leaving={rows.leaving.has(row.id) ? '' : undefined}
	tabindex="-1"
	draggable={moveable}
	out:leave={{ mode: body === 'none' ? 'row' : 'card' }}
	ondragstart={(e) => startMove(e, { kind: 'doc', id: row.id })}
	ondragend={endMove}
	onclick={(e) => onOpen?.(row.id, openHow(e))}
	onauxclick={(e) => {
		if (e.button === 1) onOpen?.(row.id, true);
	}}
	oncontextmenu={(e) => editors.menu(e, row.id)}
	onfocus={onFocus}
>
	<div class="head">
		{#if checkField && isStatusField(checkField)}
			{@const sv = statusOf(row, checkField)}
			<button
				class="check status"
				type="button"
				tabindex="-1"
				aria-label="Change status"
				title={sv}
				onclick={(e) => {
					e.stopPropagation();
					if (rows.writable(row)) editors.edit(row, checkField, e.currentTarget as HTMLElement);
				}}
			>
				<StatusIcon
					kind={statusKind(checkField, sv)}
					color={statusColor(checkField, sv)}
					size={16}
				/>
			</button>
		{:else if checkField && member && rows.writable(row)}
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
				<span class="box"><Check size={11} strokeWidth={3} /></span>
			</button>
		{:else if checkField}
			<span
				class="check inert"
				title={member ? "This folder doesn't store metadata in its files" : 'Not a todo'}
				><span class="box"></span></span
			>
		{/if}
		{#if renaming}
			<span class="name rename-wrap" role="presentation" onclick={(e) => e.stopPropagation()}>
				<span class="rename-ghost">{draft || ' '}</span>
				<textarea
					class="rename"
					class:invalid={renameTaken}
					title={renameTaken ? 'A note with this name is already in this folder.' : undefined}
					rows="1"
					bind:value={draft}
					use:renameFocus
					use:nameGuard
					onblur={commitRename}
					onkeydown={onRenameKey}
					spellcheck="false"></textarea>
			</span>
		{:else}
			<span class="name" class:editable={editMode} role="presentation" onclick={startRename}>
				{@html highlightTitle(row.title || 'untitled', hit?.match_indices ?? [])}
			</span>
		{/if}
		<button
			class="card-btn"
			type="button"
			tabindex="-1"
			aria-label="Open to the side"
			title="Open to the side"
			onclick={(e) => {
				e.stopPropagation();
				onOpen?.(row.id, 'side');
			}}
		>
			<PanelRight size={14} strokeWidth={1.75} />
		</button>
	</div>

	{#if body === 'fixed' || (body !== 'none' && (snippet || preview?.text || (preview?.image && imgOk)))}
		<div class="body" class:flow={body === 'flow'} class:brief={body === 'brief'}>
			{#if preview?.image && imgOk}
				<img
					class="image"
					src={preview.image}
					alt=""
					draggable="false"
					onerror={() => preview?.image && failedImages.add(preview.image)}
				/>
			{:else if snippet}
				<p class="text">{@html snippet}</p>
			{:else if preview?.text}
				<p class="text">{preview.text}</p>
			{:else if row.document_type === 'md'}
				<p class="text empty">Empty note</p>
			{/if}
		</div>
	{/if}

	{#if editMode && fields.length}
		<div class="empties">
			<RowChips
				{row}
				{fields}
				{rows}
				{editMode}
				compact
				pick="empty"
				onEdit={(r, f, a) => editors.edit(r, f, a)}
				onTags={(r, a) => editors.tags(r, a)}
			/>
		</div>
	{/if}

	{#if fields.length || row.document_type === 'pdf'}
		<div class="foot-row">
			<div class="foot">
				<RowChips
					{row}
					{fields}
					{rows}
					{editMode}
					compact
					pick="filled"
					onEdit={(r, f, a) => editors.edit(r, f, a)}
					onTags={(r, a) => editors.tags(r, a)}
				/>
			</div>
			{#if row.document_type === 'pdf'}
				<span class="doc-type" title="PDF"><PdfIcon size={16} /></span>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* a flat tile: one faint fill, no border, a touch darker on hover */
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px 14px 12px;
		border-radius: 10px;
		background: var(--chip-bg);
		font-family: var(--font-ui);
		font-size: 13px;
		cursor: pointer;
		transition: background-color 80ms ease;
	}

	.card:hover,
	.card:focus-within {
		background: var(--chip-bg-hover);
	}

	.card:focus-visible {
		outline: none;
		background: var(--chip-bg-hover);
	}

	.head {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		min-height: 22px;
	}

	.check {
		flex: 0 0 auto;
		margin-top: 2px;
		display: inline-flex;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.box {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border: 1.5px solid var(--color-ui-muted);
		border-radius: 4px;
		color: transparent;
		transition:
			background-color 100ms ease,
			border-color 100ms ease,
			color 100ms ease;
	}

	.check:hover .box {
		border-color: var(--color-text-secondary);
	}

	.check.inert {
		cursor: default;
	}

	.check.status {
		cursor: pointer;
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

	.card.done .name {
		color: var(--color-ui-muted);
		text-decoration: line-through;
		text-decoration-color: var(--color-border);
	}

	/* the title is only as wide as its text, so a click beside it opens the note instead of
	   starting a rename */
	.name {
		flex: 0 1 auto;
		min-width: 0;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		overflow: hidden;
		overflow-wrap: anywhere;
		font-size: 14px;
		line-height: 20px;
		letter-spacing: -0.005em;
		color: var(--color-text-primary);
	}

	/* the same slack the list gives its titles: a hit area that runs a little past the text */
	.name.editable {
		padding: 6px 12px 6px 0;
		margin: -6px -12px -6px 0;
		cursor: text;
	}

	.name :global(mark),
	.text :global(mark) {
		background: var(--search-mark-bg, rgba(255, 200, 0, 0.35));
		color: inherit;
		border-radius: 2px;
	}

	/* the same box as the editable title, so the swap to an input doesn't move the text */
	.name.rename-wrap {
		display: inline-grid;
		grid-template-columns: minmax(0, max-content);
		max-width: 100%;
		padding: 6px 12px 6px 0;
		margin: -6px -12px -6px 0;
		cursor: text;
	}

	.rename-ghost,
	.rename {
		grid-area: 1 / 1;
		font: inherit;
		font-size: 14px;
		line-height: 20px;
		letter-spacing: -0.005em;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.rename-ghost {
		visibility: hidden;
		overflow: hidden;
	}

	.rename.invalid {
		text-decoration: underline;
		text-decoration-color: var(--error-fg);
		text-underline-offset: 3px;
	}

	.rename {
		width: 0;
		min-width: 100%;
		height: 100%;
		box-sizing: border-box;
		border: 0;
		padding: 0;
		background: transparent;
		color: var(--color-text-primary);
		outline: none;
		resize: none;
		overflow: hidden;
	}

	.card-btn {
		flex: 0 0 auto;
		margin-left: auto;
		margin-top: 0;
		margin-right: -4px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
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

	.card:hover .card-btn,
	.card:focus-within .card-btn {
		opacity: 1;
	}

	.card-btn:hover {
		color: var(--color-text-primary);
	}

	/* the preview: a fixed-height window so cards line up, image or a few lines of prose */
	.body {
		height: 60px;
		overflow: hidden;
		border-radius: 6px;
	}

	.image {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
		user-select: none;
	}

	/* masonry: the window opens up to what the note has, an image at its own shape */
	.body.flow {
		height: auto;
	}

	.body.flow .image {
		height: auto;
		max-height: 240px;
	}

	.body.flow .text {
		-webkit-line-clamp: 6;
		line-clamp: 6;
	}

	/* board: a glance at the prose, the image kept short so the column still reads as a list */
	.body.brief {
		height: auto;
	}

	.body.brief .image {
		height: auto;
		max-height: 120px;
	}

	.body.brief .text {
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.text {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--color-ui-muted);
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		word-break: break-word;
	}

	.text.empty {
		color: var(--color-ui-muted);
		font-style: italic;
	}

	/* one field per line, read top to bottom; the fields still unset share one wrapping row
	   under the preview, so the card gives up a single line for them, not one each */
	.foot-row {
		display: flex;
		align-items: flex-end;
		gap: 6px;
		min-width: 0;
	}

	.foot-row:has(> .foot:empty):not(:has(> .doc-type)) {
		display: none;
	}

	.doc-type {
		display: flex;
		flex-shrink: 0;
		margin-left: auto;
		color: var(--color-ui-muted);
	}

	.foot {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 5px;
		min-width: 0;
		max-width: 100%;
	}

	.empties {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 5px 6px;
		max-width: 100%;
	}

	.foot:empty,
	.empties:empty {
		display: none;
	}

	.foot :global(.value.date:not(.chip)) {
		min-width: 0;
		justify-content: flex-start;
	}
</style>
