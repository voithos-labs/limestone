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
		type AnnotationFields,
		type PageRect
	} from '#lib/pdf/annotation.js';
	import { renderCrop, unionRect } from '#lib/pdf/crop.js';
	import { annotationRgb, INK_RGB } from '../pdf/colors';
	import { strokePath } from '#lib/pdf/ink.js';
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
	const crop = $derived(
		fields && fields.kind !== 'highlight' ? padded(unionRect(fields.rects), fields.kind) : null
	);
	const suffix = $derived(fields?.suffix ? joinSuffix(fields.suffix) : '');
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

	// ink sits right at its box's edge, so its crop gets a margin to keep the strokes whole
	function padded(rect: PageRect | null, kind: AnnotationFields['kind']): PageRect | null {
		if (!rect || kind !== 'ink') return rect;
		const m = 0.015;
		const x = Math.max(0, rect[0] - m);
		const y = Math.max(0, rect[1] - m);
		return [x, y, Math.min(1, rect[0] + rect[2] + m) - x, Math.min(1, rect[1] + rect[3] + m) - y];
	}

	// the suffix is the words after the quote, cut at a word, so it reads on from the highlight
	function joinSuffix(text: string): string {
		const lead = /^[,.;:!?)\]]/.test(text) ? '' : ' ';
		const tail = /[.!?]["')\]]?$/.test(text) ? '' : '…';
		return `${lead}${text}${tail}`;
	}

	function drawCrop(box: HTMLElement) {
		const canvas = box.querySelector('canvas')!;
		let controller: AbortController | null = null;
		let drawnWidth = 0;
		const draw = () => {
			const a = found;
			const rect = crop;
			const width = Math.floor(box.clientWidth);
			if (!a || !rect || width <= 0 || width === drawnWidth) return;
			drawnWidth = width;
			controller?.abort();
			const signal = (controller = new AbortController()).signal;
			renderCrop(canvas, {
				pdf: a.fields.pdf,
				page: a.fields.page,
				rect,
				width,
				maxHeight: CROP_MAX_HEIGHT,
				signal
			}).catch(() => {
				if (!signal.aborted) drawnWidth = 0;
			});
		};
		const ro = new ResizeObserver(draw);
		ro.observe(box);
		return () => {
			ro.disconnect();
			controller?.abort();
		};
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
		{:else if crop}
			{#key `${fields?.pdf} ${fields?.page} ${crop.join()}`}
				<span class="crop" {@attach drawCrop}>
					<canvas width="0" height="0"></canvas>
					{#if fields?.strokes?.length}
						<svg viewBox={crop.join(' ')} preserveAspectRatio="none" aria-hidden="true">
							{#each fields.strokes as s, i (i)}
								<path d={strokePath(s.points, 1)} stroke="rgb({INK_RGB[s.color]})" />
							{/each}
						</svg>
					{/if}
				</span>
			{/key}
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

	.crop {
		position: relative;
		display: block;
		align-self: flex-start;
		line-height: 0;
	}

	.crop canvas {
		max-width: 100%;
		border-radius: 5px;
	}

	.crop svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		fill: none;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.crop path {
		vector-effect: non-scaling-stroke;
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
