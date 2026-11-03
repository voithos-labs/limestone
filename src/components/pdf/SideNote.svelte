<script lang="ts" module>
	import type { Annotation } from '#lib/pdf/annotation.js';

	/** What a note's card asks of the viewer. */
	export interface NoteActions {
		onOpenNote: (id: string) => void;
		onActivate: (a: Annotation) => void;
		onEdit: (a: Annotation | null) => void;
		onSave: (a: Annotation, comment: string) => void;
		onCite: (a: Annotation) => void;
		onLink: (a: Annotation) => void;
		onMore: (a: Annotation, anchor: HTMLElement) => void;
	}

	/** How far the card's text sits below its top, so a host can level the text with a passage. */
	export const TEXT_INSET = 10;
</script>

<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { ArrowUpRight, Ellipsis, GripVertical, Link, Pencil, Quote } from '@lucide/svelte';
	import { citationEmbed, type Citing } from '#lib/pdf/citation.js';
	import { annotationRgb } from './colors.js';

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
	let field: HTMLTextAreaElement | undefined = $state();

	// Only starting to edit begins a draft; a reload while typing mustn't reset it.
	$effect(() => {
		if (!editing) return;
		draft = untrack(() => a.comment);
		void tick().then(() => field?.focus());
	});

	function commit() {
		if (!editing) return;
		actions.onEdit(null);
		if (draft.trim() !== a.comment) actions.onSave(a, draft);
	}

	// Escape leaves the note like a click away does, keeping what was typed.
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
			e.preventDefault();
			e.stopPropagation();
			commit();
			onDone?.();
		}
	}

	function grow(node: HTMLTextAreaElement) {
		const fit = () => {
			node.style.height = 'auto';
			node.style.height = `${node.scrollHeight}px`;
		};
		fit();
		node.addEventListener('input', fit);
		return { destroy: () => node.removeEventListener('input', fit) };
	}
</script>

<div class="note" class:active={active || editing} style:--ann={annotationRgb(a)}>
	<span
		class="grip"
		title="Drag into a note"
		draggable="true"
		role="presentation"
		ondragstart={(e) => e.dataTransfer?.setData('text/plain', citationEmbed(a.title))}
	>
		<GripVertical size={14} />
	</span>
	<div
		class="card"
		role="button"
		tabindex="0"
		onclick={() => (editing ? null : actions.onActivate(a))}
		ondblclick={() => actions.onEdit(a)}
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
			{#if editing}
				<textarea
					rows="1"
					placeholder="Add a comment…"
					bind:value={draft}
					bind:this={field}
					use:grow
					onblur={commit}
					onkeydown={onKey}></textarea>
			{:else if a.comment}
				<span class="comment">{a.comment}</span>
			{:else}
				<span class="comment empty">Add a comment…</span>
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
							<ArrowUpRight size={10} strokeWidth={2} />{c.title}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
	{#if !editing}
		<div class="tools">
			<button type="button" title="Copy citation" onclick={() => actions.onCite(a)}>
				<Quote size={13} strokeWidth={1.75} />
			</button>
			<button type="button" title="Copy link" onclick={() => actions.onLink(a)}>
				<Link size={13} strokeWidth={1.75} />
			</button>
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
	.note {
		position: relative;
		font-family: var(--font-ui);
	}

	.card {
		display: flex;
		gap: 10px;
		padding: 10px 12px 10px 10px;
		border-radius: 8px;
		outline: none;
		cursor: pointer;
	}

	.note:hover .card,
	.note.active .card {
		background: var(--chip-bg);
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

	.comment {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.comment.empty {
		color: var(--color-ui-dulled);
	}

	.kind {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--color-ui-muted);
	}

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
		max-width: 100%;
		height: 20px;
		padding: 0 7px;
		border: 0;
		border-radius: 999px;
		background: var(--chip-bg);
		color: var(--color-text-secondary);
		font: inherit;
		font-size: 11px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
	}

	.cite:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	textarea {
		width: 100%;
		padding: 0;
		border: none;
		outline: none;
		resize: none;
		overflow: hidden;
		background: transparent;
		color: var(--color-text-primary);
		font: inherit;
	}

	textarea::placeholder {
		color: var(--color-ui-dulled);
	}

	.grip {
		position: absolute;
		top: 10px;
		left: -18px;
		display: flex;
		width: 16px;
		color: var(--color-ui-muted);
		cursor: grab;
		opacity: 0;
	}

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

	.note:hover .grip,
	.note:hover .tools {
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

	.tools button:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}
</style>
