<script lang="ts">
	import type { ViewField, MemberRow } from '$lib/models/View.svelte';
	import type { Source } from '$lib/models/Source';
	import {
		rawStatefulValue,
		rawArrayValue,
		statefulValue,
		valueFor,
		fieldLabel
	} from '$lib/views/fieldValue';
	import { getFieldIcon } from '$lib/views/filterDisplay';
	import { SNIPPET_MARK_START, SNIPPET_MARK_END } from '$lib/services/search';
	import CellValue from './CellValue.svelte';

	let {
		row,
		fields = [],
		viewSlug,
		sources = [],
		tags = [],
		preview = '',
		image = '',
		matchIndices = [],
		snippet = '',
		onOpen
	}: {
		row: MemberRow;
		fields?: ViewField[];
		viewSlug: string;
		sources?: Source[];
		tags?: string[];
		preview?: string;
		image?: string;
		matchIndices?: number[];
		snippet?: string;
		onOpen?: () => void;
	} = $props();

	function escapeHtml(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	// Title highlight
	function highlightTitle(title: string, indices: number[]): string {
		if (indices.length === 0) return escapeHtml(title);
		const set = new Set(indices);
		return [...title]
			.map((ch, i) => (set.has(i) ? `<mark>${escapeHtml(ch)}</mark>` : escapeHtml(ch)))
			.join('');
	}

	// Construct FTS markers
	function renderSnippet(raw: string): string {
		return escapeHtml(raw)
			.replaceAll(SNIPPET_MARK_START, '<mark>')
			.replaceAll(SNIPPET_MARK_END, '</mark>')
			.replace(/<\/mark>(\s+)<mark>/g, '$1');
	}

	const titleHtml = $derived(highlightTitle(row.title || 'untitled', matchIndices));
	const previewHtml = $derived(snippet.trim() ? renderSnippet(snippet) : '');

	let imgOk = $state(true);
	let imgLoaded = $state(false);

	$effect(() => {
		void image;
		imgOk = true;
		imgLoaded = false;
	});

	const PILL_TYPES = new Set(['tags', 'select', 'multiselect']);

	function hasValue(f: ViewField): boolean {
		switch (f.type) {
			case 'tags':
				return tags.length > 0;
			case 'select':
				return statefulValue(row, viewSlug, f.name) !== '';
			case 'multiselect':
				return rawArrayValue(row, viewSlug, f.name).length > 0;
			case 'boolean':
				return rawStatefulValue(row, viewSlug, f.name) === true;
			case 'source':
				return false;
			default: {
				const v = valueFor(f, row, viewSlug);
				return v !== '' && v !== '—';
			}
		}
	}

	const shown = $derived(fields.filter((f) => f.type !== 'title' && hasValue(f)));
</script>

<button class="face-card" type="button" onclick={() => onOpen?.()}>
	<span class="fc-title">{@html titleHtml}</span>
	{#if previewHtml}
		<!-- prettier-ignore -->
		<span class="fc-preview">{@html previewHtml}</span>
	{:else if preview}
		<span class="fc-preview">{preview}</span>
	{/if}
	{#if shown.length}
		<span class="fc-fields">
			{#each shown as f (f.id)}
				{#if PILL_TYPES.has(f.type)}
					<span class="fc-pills"><CellValue field={f} {row} {viewSlug} {sources} {tags} /></span>
				{:else if f.type === 'boolean'}
					<span class="fc-line">
						<CellValue field={f} {row} {viewSlug} {sources} />
						<span class="fc-bool-label">{fieldLabel(f)}</span>
					</span>
				{:else if f.type === 'folder'}
					<span class="fc-line"><CellValue field={f} {row} {viewSlug} {sources} /></span>
				{:else}
					{@const Icon = getFieldIcon(f.type)}
					<span class="fc-line">
						<span class="fc-icon"><Icon size={12} strokeWidth={1.75} /></span>
						<span class="fc-val"><CellValue field={f} {row} {viewSlug} {sources} /></span>
					</span>
				{/if}
			{/each}
		</span>
	{/if}
	{#if image && imgOk}
		<span class="fc-image">
			<img
				src={image}
				alt=""
				class:loaded={imgLoaded}
				loading="lazy"
				onload={() => (imgLoaded = true)}
				onerror={() => (imgOk = false)}
			/>
		</span>
	{/if}
</button>

<style>
	.face-card {
		--row-h: 18px;
		display: block;
		width: 100%;
		padding: 11px 14px 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: transparent;
		font: inherit;
		font-family: var(--font-ui);
		text-align: left;
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.face-card:hover {
		background: var(--row-hover-bg, rgba(127, 127, 127, 0.06));
	}

	.fc-title {
		display: block;
		font-size: 13px;
		font-weight: 600;
		line-height: 1.45;
		color: var(--color-text-primary);
		overflow-wrap: anywhere;
	}

	.face-card :global(mark) {
		background: color-mix(in srgb, var(--color-accent) 45%, transparent);
		color: inherit;
	}

	.fc-preview {
		display: block;
		margin-top: 5px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--color-ui-muted);
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.fc-fields {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		margin-top: 10px;
	}

	.fc-pills {
		display: block;
		max-width: 100%;
	}

	.fc-pills :global(.pills) {
		flex-wrap: wrap;
		overflow: visible;
	}

	.fc-line {
		display: flex;
		align-items: center;
		gap: 5px;
		max-width: 100%;
		min-width: 0;
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.fc-line :global(.crumb-seg.last) {
		color: inherit;
	}

	.fc-icon {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		color: var(--color-ui-dulled);
	}

	.fc-val {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.fc-bool-label {
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	/* Fixed box: the card's height is known before the image decodes, so a late
       load can't shift the masonry layout. */
	.fc-image {
		display: block;
		height: 116px;
		margin-top: 10px;
		border-radius: 8px;
		overflow: hidden;
		background: var(--chip-bg);
	}

	.fc-image img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.fc-image img.loaded {
		opacity: 1;
	}
</style>
