<script lang="ts">
	/**
	 * an annotation's comment, which is just its note's body.
	 *
	 * It's shown and edited with the same markdown editor notes use, so links and formatting work
	 * the same. Comments far from the view stay plain text, since a pdf can hold hundreds of them
	 * and each editor costs a little.
	 */

	/* -------------------------------------------------------------------------- */
	/*                                  Imports                                   */
	/* -------------------------------------------------------------------------- */

	import { tick, untrack } from 'svelte';
	import { Editor } from '@voithos-labs/aragonite/svelte';
	import type { EditorInstance } from '@voithos-labs/aragonite';
	import '@voithos-labs/aragonite/styles/editor-theme.css';
	import { currentThemeType } from '#lib/services/theme.svelte.js';
	import { registerDocumentEditor } from '#lib/shortcuts.js';
	import { scrollParent } from '#lib/util/dom.js';
	import type { EditorPluginEntry } from '@voithos-labs/aragonite';
	import { EDITOR_PLUGINS } from '../editor/editor-plugins';

	/* -------------------------------------------------------------------------- */
	/*                                   Props                                    */
	/* -------------------------------------------------------------------------- */

	let {
		text,
		editing = false,
		at = null,
		placeholder = 'Add a comment…',
		plugins = EDITOR_PLUGINS,
		onInput,
		onDone
	}: {
		text: string;
		editing?: boolean;
		/** Where the reader double-clicked to start editing, so the caret lands there. */
		at?: { x: number; y: number } | null;
		placeholder?: string;
		plugins?: readonly EditorPluginEntry[];
		/** Each change while editing, as the comment's whole text. */
		onInput?: (text: string) => void;
		/** Escape, Ctrl+Enter or a click outside the comment ends the edit. */
		onDone?: () => void;
	} = $props();

	/* -------------------------------------------------------------------------- */
	/*                               Near the view                                */
	/* -------------------------------------------------------------------------- */

	// how far outside the scroller's view a comment is read as Markdown
	const NEAR = '800px 0px';

	let el: HTMLElement | undefined = $state();
	// comments far from the view stay plain text, since each editor costs a few milliseconds and a
	// PDF can hold hundreds of comments
	let near = $state(false);

	$effect(() => {
		const node = el;
		if (!node) return;
		const io = new IntersectionObserver(([entry]) => (near = entry.isIntersecting), {
			root: scrollParent(node),
			rootMargin: NEAR
		});
		io.observe(node);
		return () => io.disconnect();
	});

	/* -------------------------------------------------------------------------- */
	/*                                  Editing                                   */
	/* -------------------------------------------------------------------------- */

	let instance: EditorInstance | undefined = $state();
	// a reload while typing mustn't replace what's being typed
	const source = $derived(editing ? untrack(() => text) : text);

	$effect(() => {
		const inst = instance;
		if (!editing || !inst) return;
		const off = inst.getEvents().on('edit', () => onInput?.(inst.getSource()));
		// the app's own shortcuts stand down for the chords the editor takes, as in a note
		const unregister = registerDocumentEditor(inst);
		void tick().then(() => placeCaret(inst));
		return () => {
			off();
			unregister();
		};
	});

	function placeCaret(inst: EditorInstance) {
		const box = el?.getBoundingClientRect();
		const point = untrack(() => at) ?? (box && { x: box.right - 2, y: box.bottom - 4 });
		if (point) inst.placeCaretAtPoint(point.x, point.y);
	}

	function onKeydown(e: KeyboardEvent) {
		// the editor's own uses of these keys, closing its menus, come first
		if (!editing || e.defaultPrevented) return;
		if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
			e.preventDefault();
			e.stopPropagation();
			onDone?.();
		}
	}

	function onWindowPointer(e: PointerEvent) {
		if (editing && !el?.contains(e.target as Node)) onDone?.();
	}
</script>

<svelte:window onpointerdowncapture={onWindowPointer} />

<div class="comment" bind:this={el} role="presentation" onkeydown={onKeydown}>
	{#if editing || near}
		<Editor
			bind:this={instance}
			{source}
			presentationMode={editing ? 'live' : 'reading'}
			scrollMode="host"
			theme={currentThemeType()}
			linkClick="plain"
			blockDragHandles={false}
			selectionToolbar={false}
			placeholder={editing ? placeholder : undefined}
			{plugins}
		/>
	{:else}
		<span class="plain">{text}</span>
	{/if}
</div>

<style>
	/* The comment wears its host's face, size and color, as the text it replaces did. */
	.comment {
		--font-editor: var(--font-ui);
		--editor-font-size: 1em;
		--color-text-primary: currentColor;
		min-width: 0;
		/* a note's text runs pre-wrap, which inside a citation card would turn the editor's
		   markup whitespace into blank lines */
		white-space: normal;
		overflow-wrap: anywhere;
	}

	/* a page's row for adding a line under the last block; in a comment, Enter does that */
	.comment :global(.editor-tail) {
		display: none;
	}

	.plain {
		white-space: pre-wrap;
	}
</style>
