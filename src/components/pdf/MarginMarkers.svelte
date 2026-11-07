<script lang="ts">
	/**
	 * sidenotes for a pane too narrow for the margin.
	 *
	 * Each annotation gets a small numbered marker beside its passage instead of a card, and
	 * clicking one floats its card next to the passage.
	 */

	/* -------------------------------------------------------------------------- */
	/*                                  Imports                                   */
	/* -------------------------------------------------------------------------- */

	import type { Annotation } from '#lib/pdf/annotation.js';
	import type { Citing } from '#lib/pdf/citation.js';
	import { stackTops } from '#lib/pdf/margin.js';
	import SideNote, { TEXT_INSET, type NoteActions } from './SideNote.svelte';

	/* -------------------------------------------------------------------------- */
	/*                                   Props                                    */
	/* -------------------------------------------------------------------------- */

	let {
		notes,
		anchorY,
		belowY,
		activeId = null,
		editingId = null,
		citedBy = new Map(),
		pageWidth,
		pane,
		dark = false,
		onClose,
		...actions
	}: NoteActions & {
		/** The annotations that get a note beside the pages. */
		notes: Annotation[];
		/** The top of an annotation's passage in the pages column. */
		anchorY: (a: Annotation) => number;
		/** The bottom of an annotation's passage on its own page. */
		belowY: (a: Annotation) => number;
		activeId?: string | null;
		editingId?: string | null;
		/** The notes citing each annotation, by annotation id. */
		citedBy?: Map<string, Citing[]>;
		/** The width pages are drawn at; markers sit in their right margin. */
		pageWidth: number;
		/** The pane's left and right edges in the pages column's coordinates. */
		pane: { left: number; right: number };
		/** Whether pages are shown with dark colors. */
		dark?: boolean;
		onClose: () => void;
	} = $props();

	/* -------------------------------------------------------------------------- */
	/*                                  Markers                                   */
	/* -------------------------------------------------------------------------- */

	const MARKER = 20;
	const MARKER_GAP = 4;
	// from the page's right edge to the marker's, as the design's markers sit
	const MARKER_INSET = 18;
	// lifts a marker so it centers on a line of body text
	const MARKER_RISE = 3;

	const tops = $derived(
		stackTops(
			notes,
			(a) => anchorY(a) - MARKER_RISE,
			() => MARKER,
			MARKER_GAP
		)
	);

	/* -------------------------------------------------------------------------- */
	/*                               The open card                                */
	/* -------------------------------------------------------------------------- */

	const SURFACE_WIDTH = 312;
	const SURFACE_GAP = 20;
	const PANE_EDGE = 12;
	// the surface's border and padding, above the note's own inset
	const SURFACE_INSET = 5;

	const open = $derived(notes.find((a) => a.id === (editingId ?? activeId)) ?? null);
	const surfaceWidth = $derived(Math.min(SURFACE_WIDTH, pane.right - pane.left - PANE_EDGE * 2));
	const beside = $derived(pageWidth + SURFACE_GAP + surfaceWidth <= pane.right - PANE_EDGE);
	// beside the page when there's room, else under the passage and clear of the markers, so the
	// card covers neither the words it's about nor the marker that closes it
	const markerLeft = $derived(pageWidth - MARKER_INSET - MARKER);
	const surfaceLeft = $derived(
		beside
			? pageWidth + SURFACE_GAP
			: Math.max(pane.left + PANE_EDGE, markerLeft - MARKER_GAP * 2 - surfaceWidth)
	);
	const surfaceTop = (a: Annotation) =>
		beside ? anchorY(a) - TEXT_INSET - SURFACE_INSET : belowY(a) + MARKER_GAP * 2;
</script>

<div class="margin-markers" class:dark>
	{#each tops as [a, top], i (a.id)}
		<button
			class="marker"
			class:on={a.id === open?.id}
			type="button"
			style:left="{markerLeft}px"
			style:top="{top}px"
			onclick={() => (a.id === open?.id ? onClose() : actions.onActivate(a))}>{i + 1}</button
		>
	{/each}
	<!-- keyed, so each annotation gets a card and a draft of its own, as in the margin -->
	{#each open ? [open] : [] as a (a.id)}
		<div
			class="surface"
			style:left="{surfaceLeft}px"
			style:top="{surfaceTop(a)}px"
			style:width="{surfaceWidth}px"
		>
			<SideNote
				annotation={a}
				active
				editing={a.id === editingId}
				cites={citedBy.get(a.id)}
				onDone={onClose}
				{...actions}
			/>
		</div>
	{/each}
</div>

<style>
	/* Markers sit on the page, so they take its colors rather than the app's. */
	.marker {
		position: absolute;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.06);
		color: rgb(74, 74, 69);
		font-family: var(--font-ui);
		font-size: 10px;
		font-weight: 600;
		cursor: pointer;
	}

	.marker:hover {
		background: rgba(0, 0, 0, 0.1);
	}

	.dark .marker {
		background: rgba(255, 255, 255, 0.08);
		color: rgb(168, 168, 163);
	}

	.dark .marker:hover {
		background: rgba(255, 255, 255, 0.14);
	}

	.marker.on,
	.dark .marker.on {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
	}

	.surface {
		position: absolute;
		z-index: 4;
		box-sizing: border-box;
		padding: 4px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
	}
</style>
