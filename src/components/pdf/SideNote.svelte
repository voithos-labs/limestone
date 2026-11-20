<script lang="ts" module>
	/**
	 * one annotation's card in the margin.
	 *
	 * It shows the color, the comment (edited in place) and the notes that cite it, with tools for
	 * recoloring it and a menu of the rest. The whole card drags into a note as a citation.
	 */

	import type { Annotation, AnnotationColor } from '#lib/pdf/annotation.js';

	/** What a note's card asks of the viewer. */
	export interface NoteActions {
		onOpenNote: (id: string) => void;
		onOpenBeside: (a: Annotation) => void;
		onActivate: (a: Annotation) => void;
		onEdit: (a: Annotation | null) => void;
		onSave: (a: Annotation, comment: string) => void;
		onColor: (a: Annotation, color: AnnotationColor) => void;
		linkOf: (a: Annotation) => string;
		onMore: (a: Annotation, anchor: HTMLElement) => void;
	}

	/** How far the card's text sits below its top, so a host can level the text with a passage. */
	export const TEXT_INSET = 10;
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { ArrowUpRight, Ellipsis, PanelRight, Pencil } from '@lucide/svelte';
	import { dragCitation, type Citing } from '#lib/pdf/citation.js';
	import { ANNOTATION_COLORS } from '#lib/pdf/annotation.js';
	import { ANNOTATION_RGB, annotationRgb } from './colors.js';
	import Comment from './Comment.svelte';

	let {
		annotation: a,
		active = false,
		editing = false,
		cites = [],
		onDone,
		...actions
	}: NoteActions & {
		annotation: Annotation;
		active?: boolean;
		editing?: boolean;
		/** The notes citing the annotation. */
		cites?: Citing[];
		/** Called once Escape or Ctrl+Enter has left the comment, after it's saved. */
		onDone?: () => void;
	} = $props();

	let draft = $state('');
	let coloring = $state(false);
	// where a click started the edit, so the caret lands where the reader pointed
	let startAt: { x: number; y: number } | null = $state(null);

	// Whatever ends the edit (Escape, a click away, the viewer picking something else) keeps what
	// was typed.
	let kept: string | null = null;

	function keep() {
		const text = draft.trim();
		if (text === kept || text === untrack(() => a.comment)) return;
		kept = text;
		actions.onSave(
			untrack(() => a),
			draft
		);
	}

	$effect(() => {
		if (!editing) return;
		draft = untrack(() => a.comment);
		kept = null;
		return () => {
			keep();
			// an edit started from the menu or the keyboard puts the caret at the end
			startAt = null;
		};
	});

	function finish() {
		if (!editing) return;
		keep();
		actions.onEdit(null);
		onDone?.();
	}
</script>

<div
	class="note"
	role="presentation"
	class:active={active || editing}
	style:--ann={annotationRgb(a)}
	onpointerleave={() => (coloring = false)}
>
	<!-- dropped into a note, the card is its citation; while editing, a drag selects text -->
	<div
		class="card"
		role="button"
		tabindex="0"
		draggable={!editing && !!a.relPath}
		ondragstart={(e) => dragCitation(e, actions.linkOf(a))}
		oncontextmenu={(e) => {
			if (editing) return;
			e.preventDefault();
			actions.onMore(a, e.currentTarget as HTMLElement);
		}}
		onclick={(e) => {
			if (editing) return;
			if ((e.target as Element).closest('a')) return actions.onActivate(a);
			startAt = { x: e.clientX, y: e.clientY };
			actions.onEdit(a);
		}}
		onkeydown={(e) => {
			if (e.target === e.currentTarget && e.key === 'Enter') actions.onEdit(a);
		}}
	>
		<span class="bar"></span>
		<div class="body">
			{#if a.kind === 'ink'}
				<span class="kind"
					><Pencil size={11} strokeWidth={2} />Ink{editing && !a.comment ? ' · new' : ''}</span
				>
			{/if}
			{#if editing || a.comment}
				<Comment
					text={a.comment}
					{editing}
					at={startAt}
					onInput={(text) => (draft = text)}
					onDone={finish}
				/>
			{:else}
				<span class="empty">Add an annotation…</span>
			{/if}
			{#if cites.length}
				<div class="cites">
					{#each cites as c (c.id)}
						<button
							class="cite"
							type="button"
							title={c.line || c.title}
							onclick={(e) => {
								e.stopPropagation();
								actions.onOpenNote(c.id);
							}}
						>
							<ArrowUpRight size={10} strokeWidth={2} /><span class="cite-title">{c.title}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
	{#if !editing}
		<div class="tools" class:open={coloring}>
			<span class="pop-slot">
				{#if coloring}
					<div class="pop">
						{#each ANNOTATION_COLORS as c (c)}
							<button
								class:on={c === (a.strokes?.[0]?.color ?? a.color)}
								type="button"
								title={c}
								onclick={() => {
									coloring = false;
									actions.onColor(a, c);
								}}
							>
								<span class="dot" class:accent={c === 'accent'} style:--ann={ANNOTATION_RGB[c]}
								></span>
							</button>
						{/each}
					</div>
				{/if}
				<button
					class:on={coloring}
					type="button"
					title="Color"
					onclick={() => (coloring = !coloring)}
				>
					<span class="dot"></span>
				</button>
			</span>
			{#if a.relPath}
				<button type="button" title="Open to the side" onclick={() => actions.onOpenBeside(a)}>
					<PanelRight size={13} strokeWidth={1.75} />
				</button>
			{/if}
			<button
				type="button"
				title="More"
				onclick={(e) => actions.onMore(a, e.currentTarget as HTMLElement)}
			>
				<Ellipsis size={13} strokeWidth={1.75} />
			</button>
		</div>
	{/if}
</div>

<style>
	/* -------------------------------- The card -------------------------------- */

	.note {
		position: relative;
		font-family: var(--font-ui);
	}

	.card {
		display: flex;
		gap: 10px;
		padding: 10px 12px 10px 10px;
		border-radius: 8px;
		background: var(--chip-bg);
		outline: none;
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.note:hover .card,
	.note.active .card {
		background: var(--chip-bg-hover);
	}

	.bar {
		flex-shrink: 0;
		align-self: stretch;
		width: 3px;
		border-radius: 2px;
		background: rgb(var(--ann));
	}

	.body {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--color-text-secondary);
		text-wrap: pretty;
	}

	.note:hover .body,
	.note.active .body {
		color: var(--color-text-primary);
	}

	.empty {
		color: var(--color-ui-dulled);
	}

	.kind {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--color-ui-muted);
	}

	/* ---------------------------- The citing notes ---------------------------- */

	.cites {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 2px;
	}

	.cite {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		max-width: 100%;
		height: 20px;
		padding: 0 7px;
		border: 0;
		border-radius: 999px;
		background: var(--chip-bg);
		color: var(--color-text-secondary);
		font: inherit;
		font-size: 11px;
		cursor: pointer;
	}

	.cite :global(svg) {
		flex-shrink: 0;
	}

	/* a long note title ends in an ellipsis inside the chip rather than running off it */
	.cite-title {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.cite:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	/* -------------------------- Tools over the card --------------------------- */

	.tools {
		position: absolute;
		top: -14px;
		right: 8px;
		display: flex;
		gap: 1px;
		padding: 2px;
		border: 1px solid var(--color-border);
		border-radius: 7px;
		background: var(--color-bg);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		color: var(--color-ui-muted);
		opacity: 0;
		pointer-events: none;
	}

	.note:hover .tools,
	.note.active .tools,
	.tools.open {
		opacity: 1;
		pointer-events: auto;
	}

	.tools button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 22px;
		padding: 0;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.dot {
		position: relative;
		width: 11px;
		height: 11px;
		border-radius: 999px;
		background: rgb(var(--ann));
	}

	.dot.accent::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--color-bg);
		translate: -50% -50%;
	}

	.pop-slot {
		position: relative;
		display: flex;
	}

	.pop {
		position: absolute;
		top: calc(100% + 8px);
		left: 50%;
		z-index: 3;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--color-border);
		border-radius: 7px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
		translate: -50% 0;
	}

	.tools button.on,
	.tools button:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}
</style>
