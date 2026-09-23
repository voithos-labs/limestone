<script lang="ts">
	import { Check, SquareArrowOutUpRight } from '@lucide/svelte';
	import type { MemberRow, ViewField } from '$lib/models/View.svelte';
	import type { FaceRows } from '$lib/views/FaceRows.svelte';
	import type { Preview } from '$lib/views/previews';
	import { rawStatefulValue } from '$lib/views/fieldValue';
	import { highlightTitle, highlightSnippet } from '$lib/util/highlight';
	import RowChips from './RowChips.svelte';
	import type RowEditors from './RowEditors.svelte';

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
		onOpen,
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
		onOpen?: (rowId: string, newTab?: boolean) => void;
		onFocus?: () => void;
	} = $props();

	const member = $derived(checkField ? rows.memberOf(row, checkField) : false);
	const done = $derived(member && checkField ? rawStatefulValue(row, checkField) === true : false);
	const hit = $derived(rows.searchHits[row.id]);
	const snippet = $derived(hit?.snippet?.trim() ? highlightSnippet(hit.snippet) : '');

	// ── Rename in place ────────────────────────────────────────────────────────
	let renaming = $state(false);
	let draft = $state('');

	function startRename(e: MouseEvent) {
		if (!editMode) return;
		e.stopPropagation();
		renaming = true;
		draft = row.title;
	}

	function commitRename() {
		renaming = false;
		rows.rename(row.id, draft);
	}

	function onRenameKey(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Enter') {
			e.preventDefault();
			(e.currentTarget as HTMLInputElement).blur();
		} else if (e.key === 'Escape') renaming = false;
	}

	function renameFocus(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	let imgOk = $state(true);
	$effect(() => {
		void preview?.image;
		imgOk = true;
	});
</script>

<div
	class="card"
	class:done
	class:editable={editMode}
	role="listitem"
	data-id={row.id}
	tabindex="-1"
	onclick={(e) => {
		if (!editMode) onOpen?.(row.id, e.ctrlKey || e.metaKey);
	}}
	onauxclick={(e) => {
		if (e.button === 1) onOpen?.(row.id, true);
	}}
	oncontextmenu={(e) => editors.menu(e, row.id)}
	onfocus={onFocus}
>
	<div class="head">
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
				<span class="box"><Check size={11} strokeWidth={3} /></span>
			</button>
		{:else if checkField}
			<span class="check inert" title="Not a todo"><span class="box"></span></span>
		{/if}
		{#if renaming}
			<span class="name rename-wrap" role="presentation" onclick={(e) => e.stopPropagation()}>
				<span class="rename-ghost">{draft || ' '}</span>
				<input
					class="rename"
					bind:value={draft}
					use:renameFocus
					onblur={commitRename}
					onkeydown={onRenameKey}
					spellcheck="false"
				/>
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
			aria-label="Open in new tab"
			title="Open in new tab"
			onclick={(e) => {
				e.stopPropagation();
				onOpen?.(row.id, true);
			}}
		>
			<SquareArrowOutUpRight size={14} strokeWidth={1.75} />
		</button>
	</div>

	<div class="body">
		{#if preview?.image && imgOk}
			<img class="image" src={preview.image} alt="" onerror={() => (imgOk = false)} />
		{:else if snippet}
			<p class="text">{@html snippet}</p>
		{:else if preview?.text}
			<p class="text">{preview.text}</p>
		{:else}
			<p class="text empty">Empty note</p>
		{/if}
	</div>

	{#if inline.length || meta.length}
		<div class="foot">
			<span class="inline">
				<RowChips
					{row}
					fields={inline}
					{rows}
					{editMode}
					compact
					onEdit={(r, f, a) => editors.edit(r, f, a)}
					onTags={(r, a) => editors.tags(r, a)}
				/>
			</span>
			<span class="spacer"></span>
			<span class="values">
				<RowChips
					{row}
					fields={meta}
					{rows}
					{editMode}
					compact
					onEdit={(r, f, a) => editors.edit(r, f, a)}
					onTags={(r, a) => editors.tags(r, a)}
				/>
			</span>
		</div>
	{/if}
</div>

<style>
	/* a flat tile: one faint fill, no border, a touch darker on hover */
	.card {
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

	.card.editable {
		cursor: default;
	}

	.card:hover,
	.card:focus-within {
		background: var(--chip-bg-hover);
	}

	.card:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 1.5px var(--color-accent);
	}

	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 22px;
	}

	.check {
		flex: 0 0 auto;
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

	.name {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: 14px;
		letter-spacing: -0.005em;
		color: var(--color-text-primary);
	}

	.name.editable {
		cursor: text;
	}

	.name :global(mark),
	.text :global(mark) {
		background: var(--search-mark-bg, rgba(255, 200, 0, 0.35));
		color: inherit;
		border-radius: 2px;
	}

	.name.rename-wrap {
		display: inline-grid;
		grid-template-columns: max-content;
		max-width: 100%;
		overflow: visible;
		cursor: text;
	}

	.rename-ghost,
	.rename {
		grid-area: 1 / 1;
		font: inherit;
		font-size: 14px;
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

	.card-btn {
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

	.card:hover .card-btn,
	.card:focus-within .card-btn {
		opacity: 1;
	}

	.card-btn:hover {
		background: var(--chip-bg-hover);
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

	/* a card has no title to give way, so the foot wraps instead of clipping: pills flow onto
	   more lines and the right-hand values land at the end of the last one */
	.foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		row-gap: 6px;
		column-gap: 8px;
		min-height: 22px;
	}

	.inline {
		flex: 1 1 auto;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.inline:empty {
		display: none;
	}

	.spacer {
		display: none;
	}

	.values {
		flex: 0 1 auto;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		min-width: 0;
		max-width: 100%;
		margin-left: auto;
	}
</style>
