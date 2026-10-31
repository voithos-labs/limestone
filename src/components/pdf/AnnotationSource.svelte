<script lang="ts">
	import { ArrowUpRight } from '@lucide/svelte';
	import { select } from '#lib/services/db.js';
	import type EditorState from '#lib/models/EditorState.svelte.js';
	import { reportError } from '#lib/overlays.svelte.js';
	import { readAnnotation } from '#lib/pdf/annotation.js';
	import { openAtAnnotation } from '#lib/pdf/citation.js';
	import PdfIcon from '../ui/PdfIcon.svelte';

	/** In an annotation note's header: the PDF and page it marks, opening the PDF there. */
	let {
		noteId,
		properties,
		editor
	}: { noteId: string; properties: Record<string, unknown>; editor?: EditorState } = $props();

	const annotation = $derived(readAnnotation(properties));
	let pdfTitle: string | null = $state(null);

	$effect(() => {
		const pdf = annotation?.pdf;
		pdfTitle = null;
		if (!pdf) return;
		let cancelled = false;
		select<{ title: string }>('SELECT title FROM documents WHERE id = ?1', [pdf])
			.then(([row]) => {
				if (!cancelled) pdfTitle = row?.title ?? null;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	function open() {
		if (!annotation || !editor) return;
		openAtAnnotation(editor, { pdf: annotation.pdf, id: noteId }).catch((e) =>
			reportError(e, "The PDF couldn't be opened.")
		);
	}
</script>

{#if annotation && pdfTitle}
	<span class="sep"></span>
	<button class="source" type="button" title="Open {pdfTitle} at this passage" onclick={open}>
		<PdfIcon size={12} />
		<span class="name">{pdfTitle}</span>
		<span class="page">· p. {annotation.page}</span>
		<ArrowUpRight size={12} />
	</button>
{/if}

<style>
	.sep {
		flex-shrink: 0;
		width: 1px;
		height: 16px;
		margin: 0 4px;
		background: var(--color-border);
	}

	.source {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		max-width: 100%;
		height: 24px;
		padding: 0 8px;
		border: 0;
		border-radius: 6px;
		background: var(--chip-bg);
		color: var(--color-text-secondary);
		font: inherit;
		cursor: pointer;
	}

	.source:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.page {
		color: var(--color-ui-muted);
		flex-shrink: 0;
	}
</style>
