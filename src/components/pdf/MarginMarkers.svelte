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
	import { untrack } from 'svelte';
	import { stackTops } from '#lib/pdf/margin.js';
	import { MessageSquare } from '@lucide/svelte';
	import SideNote, { type NoteActions } from './SideNote.svelte';

	/* -------------------------------------------------------------------------- */
	/*                                   Props                                    */
	/* -------------------------------------------------------------------------- */

	let {
		notes,
		anchorY,
		belowY,
		leftX,
		viewBottom,
		activeId = null,
		editingId = null,
		citedBy = new Map(),
		hoverMark = null,
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
		leftX: (a: Annotation) => number;
		viewBottom: () => number;
		activeId?: string | null;
		editingId?: string | null;
		/** The notes citing each annotation, by annotation id. */
		citedBy?: Map<string, Citing[]>;
		hoverMark?: string | null;
		/** The width pages are drawn at. */
		pageWidth: number;
		/** The pane's left and right edges in the pages column's coordinates. */
		pane: { left: number; right: number };
		dark?: boolean;
		onClose: () => void;
	} = $props();

	/* -------------------------------------------------------------------------- */
	/*                               The open card                                */
	/* -------------------------------------------------------------------------- */

	const MARKER = 18;
	const MARKER_GAP = 4;
	const MARKER_INSET = 18;
	const MARKER_RISE = 2;

	const tops = $derived(
		stackTops(
			notes.filter((a) => a.comment),
			(a) => anchorY(a) - MARKER_RISE,
			() => MARKER,
			MARKER_GAP
		)
	);
	const markerLeft = $derived(pageWidth - MARKER_INSET - MARKER);

	function toggle(a: Annotation) {
		clearTimeout(hoverTimer);
		hoverId = null;
		if (a.id === pinned?.id) onClose();
		else actions.onActivate(a);
	}

	const SURFACE_WIDTH = 312;
	const SURFACE_DROP = 8;
	const PANE_EDGE = 12;

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
	let surfaceHeight = $state(0);

	const surfaceLeft = (a: Annotation) => {
		const lo = Math.max(pane.left, 0) + PANE_EDGE;
		const hi = Math.min(pageWidth, pane.right) - PANE_EDGE - surfaceWidth;
		return Math.max(lo, Math.min(leftX(a), hi));
	};
	const above = $derived(
		!!open && belowY(open) + SURFACE_DROP + surfaceHeight > untrack(viewBottom)
	);
	const surfaceTop = (a: Annotation) =>
		above ? anchorY(a) - SURFACE_DROP - surfaceHeight : belowY(a) + SURFACE_DROP;
</script>

<div class="margin-markers" class:dark>
	{#each tops as [a, top] (a.id)}
		<button
			class="marker"
			class:on={a.id === open?.id}
			type="button"
			style:left="{markerLeft}px"
			style:top="{top}px"
			onclick={() => toggle(a)}
		>
			<MessageSquare size={10} strokeWidth={2} />
		</button>
	{/each}
	<!-- keyed, so each annotation gets a card and a draft of its own, as in the margin -->
	{#each open ? [open] : [] as a (a.id)}
		<div
			class="surface"
			role="presentation"
			onpointerenter={(e) => hover(e, a.id)}
			onpointerleave={unhover}
			in:fly={{ y: 4, duration: 120 }}
			out:fade={{ duration: 80 }}
			bind:offsetHeight={surfaceHeight}
			style:left="{surfaceLeft(a)}px"
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
	.marker {
		position: absolute;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: linear-gradient(var(--chip-bg), var(--chip-bg)), var(--color-surface);
		color: var(--color-text-primary);
		cursor: pointer;
		transition: background 120ms ease;
	}

	.marker:hover,
	.marker.on {
		background: linear-gradient(var(--chip-bg-hover), var(--chip-bg-hover)), var(--color-surface);
	}

	.surface {
		position: absolute;
		z-index: 4;
		box-sizing: border-box;
		border-radius: 8px;
		background: var(--color-surface);
		box-shadow: var(--menu-shadow);
	}
</style>
