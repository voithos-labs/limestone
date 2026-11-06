<script lang="ts" module>
	/** Loose ink on one page of an earlier edition, left there because the page changed. */
	export interface InkLeft {
		edition: string;
		page: number;
		strokes: number;
	}
</script>

<script lang="ts">
	import { ANNOTATION_RGB, annotationRgb } from './colors.js';
	import type { Annotation, AnnotationKind } from '#lib/pdf/annotation.js';
	import { editionDate } from '#lib/pdf/edition.js';
	import type { Unplaced } from '#lib/pdf/migrate.js';

	/** The header chip counting marks not placed on the edition on screen, and their list. */
	let {
		sourceId,
		annotations,
		ink = [],
		reasons,
		canCarry,
		carrying = false,
		onCarry,
		onPlace,
		onBringInk,
		onOpenEdition
	}: {
		/** The PDF's source, which keeps its editions. */
		sourceId: string;
		/** Made on other editions. */
		annotations: Annotation[];
		ink?: InkLeft[];
		/** Why each one tried in this opening stayed unplaced. */
		reasons: Map<string, Unplaced>;
		/** Whether anything listed hasn't been tried yet; a failed try fails again. */
		canCarry: boolean;
		carrying?: boolean;
		onCarry: () => void;
		/** Waits for a new spot on the pages; left out where there are no pages to place on. */
		onPlace?: (a: Annotation) => void;
		/** Moves ink as it is onto its page of the edition on screen. */
		onBringInk: (left: InkLeft) => void;
		onOpenEdition: (edition: string) => void;
	} = $props();

	const REASONS: Record<Unplaced, string> = {
		changed: 'text changed',
		unpreserved: 'its edition was not kept'
	};
	const KINDS: Record<AnnotationKind, string> = {
		highlight: 'Highlight',
		region: 'Region',
		ink: 'Ink'
	};

	let open = $state(false);
	let root: HTMLElement | undefined = $state();
	const count = $derived(annotations.length + ink.length);

	// a quote starting in lowercase begins mid-sentence
	function quoted(quote: string): string {
		return `“${/^\p{Ll}/u.test(quote) ? '…' : ''}${quote}”`;
	}

	function act(run: () => void) {
		open = false;
		run();
	}

	function onWindowPointer(e: PointerEvent) {
		if (open && !root?.contains(e.target as Node)) open = false;
	}

	function onWindowKey(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			e.preventDefault();
			open = false;
		}
	}
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onWindowKey} />

{#snippet openEdition(edition: string)}
	<button class="open" type="button" onclick={() => act(() => onOpenEdition(edition))}>
		{#await editionDate(sourceId, edition) then day}
			Open {day ?? 'earlier'} edition
		{/await}
	</button>
{/snippet}

<span class="not-placed" bind:this={root}>
	<button
		class="chip"
		type="button"
		aria-expanded={open}
		style:--amber={ANNOTATION_RGB.amber}
		onclick={() => (open = !open)}
	>
		<span class="ring"></span>{count} not placed in this edition
	</button>
	{#if open}
		<div class="popover">
			<div class="head">
				Not placed in this edition<span class="count">{count}</span>
				{#if canCarry}
					<button class="carry" type="button" disabled={carrying} onclick={onCarry}>
						{carrying ? 'Carrying over…' : 'Carry over'}
					</button>
				{/if}
			</div>
			{#each annotations as a (a.id)}
				{@const reason = reasons.get(a.id)}
				<div class="card" style:--ann={annotationRgb(a)}>
					<div class="was">
						<span class="dot"></span>was p. {a.page}{reason ? ` · ${REASONS[reason]}` : ''}
					</div>
					<div class="what">
						{a.kind === 'highlight' && a.quote ? quoted(a.quote) : KINDS[a.kind]}
					</div>
					<div class="actions">
						{#if onPlace}
							<button class="place" type="button" onclick={() => act(() => onPlace(a))}>
								Place again
							</button>
						{/if}
						{#if a.edition && reason !== 'unpreserved'}
							{@render openEdition(a.edition)}
						{/if}
					</div>
				</div>
			{/each}
			{#each ink as left (`${left.edition}:${left.page}`)}
				<div class="card" style:--ann={ANNOTATION_RGB.amber}>
					<div class="was"><span class="dot"></span>was p. {left.page} · page changed</div>
					<div class="what">
						Loose ink · {left.strokes}
						{left.strokes === 1 ? 'stroke' : 'strokes'}
					</div>
					<div class="actions">
						<button class="place" type="button" onclick={() => act(() => onBringInk(left))}>
							Bring over
						</button>
						{@render openEdition(left.edition)}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</span>

<style>
	.not-placed {
		position: relative;
		display: inline-flex;
	}

	/* the design's amber chip; its text darkens the amber in light themes and is the amber itself
	   in dark ones */
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 24px;
		padding: 0 8px;
		border: 0;
		border-radius: 6px;
		background: rgb(var(--amber) / 0.16);
		color: rgb(122 90 18);
		font: inherit;
		cursor: pointer;
	}

	.chip:hover,
	.chip[aria-expanded='true'] {
		background: rgb(var(--amber) / 0.26);
	}

	:global(:root[data-theme-type='dark']) .chip {
		color: rgb(var(--amber));
	}

	.ring {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1.5px currentColor;
	}

	.popover {
		position: absolute;
		top: calc(100% + 8px);
		left: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		gap: 6px;
		box-sizing: border-box;
		width: 320px;
		max-height: min(440px, 60vh);
		padding: 6px;
		overflow-y: auto;
		scrollbar-width: none;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
		cursor: default;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 24px;
		padding: 2px 2px 2px 6px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		white-space: nowrap;
		color: var(--color-ui-muted);
	}

	.count {
		font-weight: 500;
		color: var(--color-ui-dulled);
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 9px 12px 10px;
		border-radius: 8px;
		background: var(--chip-bg);
	}

	.was {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 11.5px;
		color: var(--color-ui-muted);
	}

	.dot {
		flex-shrink: 0;
		width: 8px;
		height: 8px;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1.5px rgb(var(--ann));
	}

	.what {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--color-ui-dulled);
	}

	.actions {
		display: flex;
		gap: 6px;
	}

	.carry,
	.place,
	.open {
		display: inline-flex;
		align-items: center;
		height: 24px;
		padding: 0 9px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--color-ui-muted);
		font: inherit;
		font-size: 12px;
		font-weight: 400;
		letter-spacing: normal;
		text-transform: none;
		white-space: nowrap;
		cursor: pointer;
	}

	.carry {
		margin-left: auto;
	}

	.carry,
	.place {
		background: var(--chip-seg-active);
		color: var(--color-text-primary);
	}

	.carry:disabled {
		color: var(--color-ui-muted);
		cursor: default;
	}

	.open:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}
</style>
