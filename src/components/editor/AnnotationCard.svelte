<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { Pen, SquareDashed } from '@lucide/svelte';
	import { imeOwnsKey, type InlineWidgetComponentProps } from '@voithos-labs/aragonite/plugin';
	import { select } from '#lib/services/db.js';
	import MarkdownHandle from '#lib/models/MarkdownHandle.js';
	import { onSelfWrite, onSourceReconciled } from '#lib/models/Source.js';
	import { linkIndex } from '#lib/services/links.svelte.js';
	import {
		ANNOTATION_KEY,
		annotationComment,
		readAnnotation,
		runOn,
		type AnnotationFields
	} from '#lib/pdf/annotation.js';
	import { annotationRgb } from '../pdf/colors';
	import AnnotationCrop from '../pdf/AnnotationCrop.svelte';
	import PdfIcon from '../ui/PdfIcon.svelte';
	import {
		OPEN_ANNOTATION_EVENT,
		parseAnnotationTitle,
		type OpenAnnotationDetail
	} from './annotation-embeds';

	/** A citation of a PDF annotation, drawn as its quote or region with the shared comment. */
	let { source, isActivationClick, getPresentationMode }: InlineWidgetComponentProps = $props();

	interface Found {
		id: string;
		sourceId: string;
		relPath: string;
		fields: AnnotationFields;
		comment: string;
		pdfTitle: string | null;
	}

	const CROP_MAX_HEIGHT = 320;

	// Read once: the widget remounts on any source change.
	// svelte-ignore state_referenced_locally
	const target = source.slice(3, -2).split('|')[0].trim();
	const named = parseAnnotationTitle(target);

	let el: HTMLElement | null = $state(null);
	let found = $state.raw<Found | null>(null);
	let missing = $state(false);
	let reread = $state(0);

	const fields = $derived(found?.fields);
	const pdfTitle = $derived(found?.pdfTitle ?? named?.pdfTitle ?? target);
	const page = $derived(fields?.page ?? named?.page);
	const suffix = $derived(fields?.suffix ? runOn(fields.suffix) : '');
	const reading = $derived(getPresentationMode() === 'reading');

	$effect(() => {
		void linkIndex.version;
		void reread;
		const node = el;
		if (!node) return;
		const here = node.closest('[data-source-id]')?.getAttribute('data-source-id') ?? '';
		let live = true;
		resolve(here)
			.then((hit) => {
				if (!live) return;
				found = hit;
				missing = hit === null;
			})
			.catch(() => {
				// a read caught mid-write keeps what was shown
				if (live && !found) missing = true;
			});
		return () => {
			live = false;
		};
	});

	$effect(() => {
		const offReconciled = onSourceReconciled(() => reread++);
		const offWrite = onSelfWrite((sourceId, relPath) => {
			const was = found;
			if (was ? sourceId === was.sourceId && relPath === was.relPath : namesTarget(relPath)) {
				reread++;
			}
		});
		return () => {
			offReconciled();
			offWrite();
		};
	});

	async function resolve(here: string): Promise<Found | null> {
		const [row] = await select<{ id: string; source_id: string; rel_path: string }>(
			`SELECT id, source_id, rel_path FROM documents
			 WHERE lower(title) = lower(?1) AND deleted_at IS NULL
			   AND json_extract(properties, '$.${ANNOTATION_KEY}.pdf') IS NOT NULL
			 ORDER BY source_id = ?2 DESC LIMIT 1`,
			[target, here]
		);
		if (!row) return null;
		const raw = await invoke<string>('read_document', {
			sourceId: row.source_id,
			relPath: row.rel_path
		});
		const { frontmatter, body } = MarkdownHandle.deserialize(raw);
		const read = frontmatter && readAnnotation(frontmatter);
		if (!read) return null;
		const [pdf] = await select<{ title: string }>(
			'SELECT title FROM documents WHERE id = ?1 AND deleted_at IS NULL',
			[read.pdf]
		);
		return {
			id: row.id,
			sourceId: row.source_id,
			relPath: row.rel_path,
			fields: read,
			comment: annotationComment(body),
			pdfTitle: pdf?.title ?? null
		};
	}

	function namesTarget(relPath: string): boolean {
		const name = relPath.slice(relPath.lastIndexOf('/') + 1).replace(/\.md$/i, '');
		return name.toLowerCase() === target.toLowerCase();
	}

	function open(): void {
		if (!found || !el) return;
		const detail: OpenAnnotationDetail = { pdf: found.fields.pdf, id: found.id };
		el.dispatchEvent(new CustomEvent(OPEN_ANNOTATION_EVENT, { bubbles: true, detail }));
	}

	function onClick(e: MouseEvent): void {
		if (!isActivationClick(e)) return;
		e.preventDefault();
		open();
	}

	function onKeydown(e: KeyboardEvent): void {
		if (imeOwnsKey(e)) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			e.stopPropagation();
			open();
		}
	}
</script>

{#if missing}
	<span bind:this={el} class="unresolved" title="No annotation note has this title">{source}</span>
{:else}
	<span
		bind:this={el}
		class="card"
		role="link"
		aria-label="{pdfTitle}, page {page}"
		tabindex={reading ? 0 : undefined}
		style:--ann={fields ? annotationRgb(fields) : undefined}
		onclick={onClick}
		onkeydown={onKeydown}
	>
		<span class="head">
			{#if fields?.kind === 'ink'}
				<Pen size={12} strokeWidth={1.75} />
			{:else if fields?.kind === 'region'}
				<SquareDashed size={12} strokeWidth={1.75} />
			{:else}
				<PdfIcon size={12} />
			{/if}
			<span class="pdf">{pdfTitle}</span><span>· p. {page}</span>
		</span>
		{#if fields?.kind === 'highlight' && fields.quote}
			<span class="quote"><span class="mark">{fields.quote}</span>{suffix}</span>
		{:else if fields && fields.kind !== 'highlight'}
			<AnnotationCrop annotation={fields} maxHeight={CROP_MAX_HEIGHT} />
		{/if}
		{#if found?.comment}
			<span class="rule"></span>
			<span class="comment">{found.comment}</span>
		{/if}
	</span>
{/if}

<style>
	.card {
		display: inline-flex;
		flex-direction: column;
		gap: 10px;
		box-sizing: border-box;
		width: 100%;
		padding: 12px 14px;
		border-radius: 8px;
		background: var(--chip-bg);
		font-family: var(--font-ui);
		vertical-align: top;
		cursor: pointer;
	}

	.card:hover {
		background: var(--chip-bg-hover);
	}

	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		font-size: 0.75em;
		line-height: 1.5;
		color: var(--color-ui-muted);
	}

	.head :global(svg) {
		flex-shrink: 0;
	}

	.pdf {
		overflow: hidden;
		font-weight: 500;
		color: var(--color-text-secondary);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.quote {
		display: block;
		font-family: var(--font-editor);
		font-size: 0.9375em;
		line-height: 1.55;
		color: var(--color-text-primary);
		text-wrap: pretty;
	}

	.mark {
		padding: 1px 0;
		border-radius: 2px;
		background: rgb(var(--ann) / 0.28);
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}

	.rule {
		display: block;
		height: 1px;
		background: var(--color-border);
	}

	.comment {
		display: block;
		font-size: 0.84375em;
		line-height: 1.5;
		color: var(--color-text-secondary);
		white-space: pre-wrap;
		text-wrap: pretty;
	}

	.unresolved {
		color: var(--color-ui-dulled);
		font-family: var(--font-mono);
		font-size: 0.85em;
	}
</style>
