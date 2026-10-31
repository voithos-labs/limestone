<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { Ellipsis, GripVertical, Link, Pencil, Quote } from '@lucide/svelte';
	import type { Annotation } from '#lib/pdf/annotation.js';
	import { citationEmbed } from '#lib/pdf/citation.js';
	import { ANNOTATION_RGB } from './colors.js';

	let {
		notes,
		anchorY,
		activeId = null,
		editingId = null,
		onActivate,
		onEdit,
		onSave,
		onCite,
		onLink,
		onMore
	}: {
		/** The annotations that get a note in the margin. */
		notes: Annotation[];
		/** The height of an annotation's passage in the rail's own coordinates. */
		anchorY: (a: Annotation) => number;
		activeId?: string | null;
		editingId?: string | null;
		onActivate: (a: Annotation) => void;
		onEdit: (a: Annotation | null) => void;
		onSave: (a: Annotation, comment: string) => void;
		onCite: (a: Annotation) => void;
		onLink: (a: Annotation) => void;
		onMore: (a: Annotation, anchor: HTMLElement) => void;
	} = $props();

	const GAP = 10;

	let heights: Record<string, number> = $state({});
	let draft = $state('');

	// Each note sits level with its passage, pushed down just enough to clear the one above.
	const tops = $derived.by(() => {
		const out = new Map<string, number>();
		let floor = -Infinity;
		for (const a of [...notes].sort((p, q) => anchorY(p) - anchorY(q))) {
			const top = Math.max(anchorY(a), floor);
			out.set(a.id, top);
			floor = top + (heights[a.id] ?? 0) + GAP;
		}
		return out;
	});

	// Only a change of which note is edited starts a draft; a reload while typing mustn't reset it.
	$effect(() => {
		const id = editingId;
		if (!id) return;
		draft = untrack(() => notes.find((n) => n.id === id)?.comment ?? '');
		void tick().then(() => {
			document.querySelector<HTMLTextAreaElement>(`[data-note="${id}"] textarea`)?.focus();
		});
	});

	function commit(a: Annotation) {
		if (editingId !== a.id) return;
		onEdit(null);
		if (draft.trim() !== a.comment) onSave(a, draft);
	}

	// Escape leaves the note like a click away does, keeping what was typed.
	function onKey(e: KeyboardEvent, a: Annotation) {
		if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
			e.preventDefault();
			e.stopPropagation();
			commit(a);
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

<div class="side-notes">
	{#each notes as a (a.id)}
		{@const editing = a.id === editingId}
		<div
			class="note"
			class:active={a.id === activeId || editing}
			data-note={a.id}
			style:top="{tops.get(a.id) ?? 0}px"
			style:--ann={ANNOTATION_RGB[a.color]}
			bind:offsetHeight={heights[a.id]}
		>
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
				onclick={() => (editing ? null : onActivate(a))}
				ondblclick={() => onEdit(a)}
				onkeydown={(e) => {
					if (e.target === e.currentTarget && e.key === 'Enter') onEdit(a);
				}}
			>
				<span class="bar"></span>
				<div class="body">
					{#if a.kind === 'ink'}
						<span class="kind"><Pencil size={11} strokeWidth={2} />Ink</span>
					{/if}
					{#if editing}
						<textarea
							rows="1"
							placeholder="Add a comment…"
							bind:value={draft}
							use:grow
							onblur={() => commit(a)}
							onkeydown={(e) => onKey(e, a)}></textarea>
					{:else if a.comment}
						<span class="comment">{a.comment}</span>
					{:else}
						<span class="comment empty">Add a comment…</span>
					{/if}
				</div>
			</div>
			{#if !editing}
				<div class="tools">
					<button type="button" title="Copy citation" onclick={() => onCite(a)}>
						<Quote size={13} strokeWidth={1.75} />
					</button>
					<button type="button" title="Copy link" onclick={() => onLink(a)}>
						<Link size={13} strokeWidth={1.75} />
					</button>
					<button
						type="button"
						title="More"
						onclick={(e) => onMore(a, e.currentTarget as HTMLElement)}
					>
						<Ellipsis size={13} strokeWidth={1.75} />
					</button>
				</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	.side-notes {
		position: relative;
	}

	.note {
		position: absolute;
		left: 0;
		right: 0;
		font-family: var(--font-ui);
	}

	.card {
		display: flex;
		gap: 10px;
		margin-left: -10px;
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
		caret-color: var(--color-accent);
	}

	textarea::placeholder {
		color: var(--color-ui-dulled);
	}

	.grip {
		position: absolute;
		top: 10px;
		left: -28px;
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
