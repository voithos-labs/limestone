<script lang="ts">
	import { ArrowUpRight, Link, MessageSquare, TextAlignStart } from '@lucide/svelte';
	import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
	import { leadIn, runOn, type Annotation } from '#lib/pdf/annotation.js';
	import type { Citing } from '#lib/pdf/citation.js';
	import AnnotationCrop from './AnnotationCrop.svelte';
	import { annotationRgb } from './colors.js';

	/** A PDF's annotations read down as one list by page, each showing the notes that cite it. */
	let {
		annotations,
		citedBy,
		doc = null,
		onGoTo,
		onOpenNote
	}: {
		/** Already sorted by page, then by position on the page. */
		annotations: Annotation[];
		/** The notes citing each annotation, by annotation id. */
		citedBy: Map<string, Citing[]>;
		/** The open PDF these annotations were made on, for drawing their crops. */
		doc?: PDFDocumentProxy | null;
		onGoTo: (a: Annotation) => void;
		onOpenNote: (id: string) => void;
	} = $props();

	const CROP_MAX_HEIGHT = 240;

	let openId: string | null = $state(null);
	let dismissed = false;

	const pages = $derived.by(() => {
		const out: { page: number; items: Annotation[] }[] = [];
		for (const a of annotations) {
			const last = out.at(-1);
			if (last?.page === a.page) last.items.push(a);
			else out.push({ page: a.page, items: [a] });
		}
		return out;
	});

	function folder(relPath: string): string {
		return relPath.split('/').filter(Boolean).slice(0, -1).join(' / ');
	}

	function citedLabel(n: number): string {
		return `Cited in ${n} note${n === 1 ? '' : 's'}`;
	}

	function onRowClick(e: MouseEvent, a: Annotation) {
		if ((e.target as Element).closest('[data-actions]')) return;
		// the click that closed a popover only closes it
		if (dismissed) return;
		goTo(a);
	}

	function goTo(a: Annotation) {
		openId = null;
		onGoTo(a);
	}

	function onRowKey(e: KeyboardEvent, a: Annotation) {
		if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
		e.preventDefault();
		goTo(a);
	}

	function onWindowPointer(e: PointerEvent) {
		dismissed = false;
		if (!openId) return;
		const inside = (e.target as Element).closest?.('[data-actions]');
		if (inside?.getAttribute('data-actions') === openId) return;
		openId = null;
		dismissed = true;
	}

	function onWindowKey(e: KeyboardEvent) {
		if (openId && e.key === 'Escape') {
			e.preventDefault();
			openId = null;
		}
	}
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onWindowKey} />

<div class="digest">
	{#each pages as group (group.page)}
		<div class="page-head"><span>Page {group.page}</span><span class="line"></span></div>
		{#each group.items as a (a.id)}
			{@const cites = citedBy.get(a.id) ?? []}
			<div
				class="row"
				class:open={openId === a.id}
				role="button"
				tabindex="0"
				title="Open page {a.page}"
				style:--ann={annotationRgb(a)}
				onclick={(e) => onRowClick(e, a)}
				onkeydown={(e) => onRowKey(e, a)}
			>
				{#if a.kind === 'highlight' && a.quote}
					{@const before = a.prefix ? leadIn(a.prefix) : ''}
					{@const after = a.suffix ? runOn(a.suffix) : ''}
					<p class="passage">{before}<span class="mark">{a.quote}</span>{after}</p>
				{:else}
					<div class="shot">
						<AnnotationCrop annotation={a} maxHeight={CROP_MAX_HEIGHT} {doc} />
					</div>
				{/if}
				{#if a.comment}
					<div class="comment">
						<MessageSquare size={13} strokeWidth={1.75} />
						<span>{a.comment}</span>
					</div>
				{/if}
				<div class="actions" data-actions={a.id}>
					<button type="button" class="action" onclick={() => goTo(a)}>
						Go to p. {a.page}<ArrowUpRight size={11} strokeWidth={2} />
					</button>
					{#if cites.length}
						<button
							type="button"
							class="action cited"
							class:on={openId === a.id}
							aria-expanded={openId === a.id}
							onclick={() => (openId = openId === a.id ? null : a.id)}
						>
							<Link size={11} strokeWidth={2} />{citedLabel(cites.length)}
						</button>
					{/if}
					{#if openId === a.id}
						<div class="popover">
							<div class="popover-head">Cited in</div>
							{#each cites as c (c.id)}
								<button
									type="button"
									class="cite"
									title={c.line || c.title}
									onclick={() => {
										openId = null;
										onOpenNote(c.id);
									}}
								>
									<span class="cite-name">
										<TextAlignStart size={12} strokeWidth={1.75} />
										<span class="cite-title">{c.title}</span>
										{#if folder(c.relPath)}
											<span class="cite-folder">{folder(c.relPath)}</span>
										{/if}
									</span>
									{#if c.line}
										<span class="cite-line">{c.line}</span>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/each}
	{:else}
		<p class="empty">Nothing marked yet. Highlights, regions and ink show up here.</p>
	{/each}
</div>

<style>
	.digest {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-width: 760px;
		margin: 0 auto;
		padding: 22px 12px 40px;
		font-family: var(--font-ui);
	}

	.page-head {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 12px 6px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-ui-muted);
	}

	.page-head .line {
		flex: 1;
		height: 1px;
		background: var(--color-border);
	}

	.row {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 12px 12px;
		border-radius: 8px;
		outline: none;
		cursor: pointer;
	}

	.row:hover,
	.row.open,
	.row:focus-visible {
		background: var(--chip-bg);
	}

	.passage {
		margin: 0;
		padding-right: 150px;
		font-family: var(--font-editor, serif);
		font-size: 16px;
		line-height: 1.65;
		color: var(--color-ui-dulled);
		text-wrap: pretty;
	}

	.mark {
		border-radius: 2px;
		background: rgb(var(--ann) / 0.38);
		color: var(--color-text-primary);
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}

	.shot {
		margin-right: 150px;
		--crop-ring: 1.5px;
		--crop-radius: 4px;
	}

	.comment {
		display: flex;
		gap: 8px;
		padding-left: 18px;
		padding-right: 150px;
		font-size: 13.5px;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.comment :global(svg) {
		flex-shrink: 0;
		margin-top: 3px;
		color: var(--color-ui-muted);
	}

	.comment span {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.actions {
		position: absolute;
		top: 10px;
		right: 10px;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
		opacity: 0;
		transition: opacity 120ms;
	}

	.row:hover .actions,
	.row.open .actions,
	.row:focus-within .actions {
		opacity: 1;
	}

	.action {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 24px;
		padding: 0 8px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-muted);
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}

	.action.cited {
		gap: 5px;
	}

	.action:hover {
		background: var(--chip-bg-hover);
	}

	.action.on {
		background: var(--chip-seg-active);
		color: var(--color-text-primary);
	}

	.popover {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		z-index: 2;
		box-sizing: border-box;
		width: 330px;
		padding: 4px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
		cursor: default;
	}

	.popover-head {
		padding: 6px 10px 4px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-ui-muted);
	}

	.cite {
		display: flex;
		flex-direction: column;
		gap: 3px;
		width: 100%;
		padding: 7px 10px 8px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.cite:hover {
		background: var(--chip-bg-hover);
	}

	.cite-name {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--color-text-primary);
	}

	.cite-name :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.cite-title {
		font-weight: 500;
	}

	.cite-folder {
		font-size: 11.5px;
		color: var(--color-ui-muted);
	}

	.cite-line {
		padding-left: 18px;
		overflow: hidden;
		font-size: 12px;
		line-height: 1.45;
		color: var(--color-ui-dulled);
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.empty {
		margin: 0;
		padding: 14px 12px;
		font-size: 13.5px;
		color: var(--color-ui-dulled);
	}
</style>
