<script lang="ts">
	/**
	 * sidenotes while the margin isn't showing.
	 *
	 * Hovering an annotation's passage floats its card next to it, and clicking the passage keeps
	 * the card open.
	 */

	/* -------------------------------------------------------------------------- */
	/*                                  Imports                                   */
	/* -------------------------------------------------------------------------- */

	import { fade, fly } from 'svelte/transition';
	import type { Annotation } from '#lib/pdf/annotation.js';
	import type { Citing } from '#lib/pdf/citation.js';
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
		hoverMark = null,
		pageWidth,
		pane,
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
		hoverMark?: string | null;
		/** The width pages are drawn at. */
		pageWidth: number;
		/** The pane's left and right edges in the pages column's coordinates. */
		pane: { left: number; right: number };
		onClose: () => void;
	} = $props();

	/* -------------------------------------------------------------------------- */
	/*                               The open card                                */
	/* -------------------------------------------------------------------------- */

	const SURFACE_WIDTH = 312;
	const SURFACE_GAP = 20;
	const SURFACE_DROP = 8;
	const PANE_EDGE = 12;
	// the surface's border and padding, above the note's own inset
	const SURFACE_INSET = 5;

	const HOVER_ENTER_MS = 300;
	const HOVER_LEAVE_MS = 250;

	let hoverId: string | null = $state(null);
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;

	function enter(id: string) {
		clearTimeout(hoverTimer);
		if (hoverId !== id) hoverTimer = setTimeout(() => (hoverId = id), HOVER_ENTER_MS);
	}

	function leave() {
		clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => (hoverId = null), HOVER_LEAVE_MS);
	}

	let over = false;

	function hover(e: PointerEvent, id: string) {
		if (e.pointerType !== 'mouse') return;
		over = true;
		enter(id);
	}

	function unhover(e: PointerEvent) {
		if (e.pointerType !== 'mouse') return;
		over = false;
		leave();
	}

	$effect(() => {
		if (hoverMark) enter(hoverMark);
		else if (!over) leave();
	});

	$effect(() => () => clearTimeout(hoverTimer));

	const pinned = $derived(notes.find((a) => a.id === (editingId ?? activeId)) ?? null);
	const hovered = $derived(notes.find((a) => a.id === hoverId) ?? null);
	const open = $derived(editingId ? pinned : (hovered ?? pinned));
	const surfaceWidth = $derived(Math.min(SURFACE_WIDTH, pane.right - pane.left - PANE_EDGE * 2));
	const beside = $derived(pageWidth + SURFACE_GAP + surfaceWidth <= pane.right - PANE_EDGE);
	// beside the page when there's room, else under the passage, so the card doesn't cover the
	// words it's about
	const surfaceLeft = $derived(
		beside
			? pageWidth + SURFACE_GAP
			: Math.max(pane.left + PANE_EDGE, pageWidth - SURFACE_GAP - surfaceWidth)
	);
	const surfaceTop = (a: Annotation) =>
		beside ? anchorY(a) - TEXT_INSET - SURFACE_INSET : belowY(a) + SURFACE_DROP;
</script>

<div class="margin-markers">
	<!-- keyed, so each annotation gets a card and a draft of its own, as in the margin -->
	{#each open ? [open] : [] as a (a.id)}
		<div
			class="surface"
			role="presentation"
			onpointerenter={(e) => hover(e, a.id)}
			onpointerleave={unhover}
			in:fly={{ y: 4, duration: 120 }}
			out:fade={{ duration: 80 }}
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
