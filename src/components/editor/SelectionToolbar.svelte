<script lang="ts">
	/**
	 * A formatting bar that exists only while a live-mode selection does. Live paints no syntax, so
	 * this is where bold and friends become clickable. Every button asks the editor to run a command
	 * it already owns; nothing here fakes a keystroke.
	 */
	import { normalizeSelection, SELECTION_END, TOOLBAR_COMMANDS } from '@voithos-labs/aragonite';
	import type { EditorInstance, EditorSelection } from '@voithos-labs/aragonite';
	import { Bold, Code, Italic, Link, Strikethrough } from '@lucide/svelte';

	let { instance }: { instance: EditorInstance | undefined } = $props();

	// The ids ride the editor's own list, so a rename upstream arrives through the import instead
	// of leaving a stale string behind a button that still looks like it works.
	const BUTTONS = [
		{ label: 'Bold', Icon: Bold, command: TOOLBAR_COMMANDS.toggleStrong },
		{ label: 'Italic', Icon: Italic, command: TOOLBAR_COMMANDS.toggleEmphasis },
		{ label: 'Strikethrough', Icon: Strikethrough, command: TOOLBAR_COMMANDS.toggleStrikethrough },
		{ label: 'Code', Icon: Code, command: TOOLBAR_COMMANDS.toggleCode },
		{ label: 'Link', Icon: Link, command: TOOLBAR_COMMANDS.editLink }
	];

	interface Bar {
		x: number;
		y: number;
		/** Per button: whether the command would run here, and whether it already reads as on. */
		states: { enabled: boolean; pressed: boolean }[];
	}

	let bar = $state<Bar | null>(null);

	$effect(() => {
		if (!instance) return;
		return instance.getEvents().on('selectionChange', (s) => (bar = place(s)));
	});

	/** Where the bar sits for this selection and what its buttons can do, or null to show none. */
	function place(selection: EditorSelection | null): Bar | null {
		if (!instance || !selection) return null;
		const { start, end } = normalizeSelection(selection);
		// A selection inside one table addresses cells, not text, and its endpoints carry no flag
		// saying so; the block's kind is the only thing that can.
		if (instance.getBlockKindAt(start.path) === 'table') return null;
		const sameBlock = start.path.join('.') === end.path.join('.');
		if (sameBlock && start.offset === end.offset) return null;
		const rects = instance
			.getRects()
			.rangeRects(start.path, start.offset, sameBlock ? end.offset : SELECTION_END);
		if (!rects.length) return null;
		const editor = instance;
		return {
			x: rects[0].left,
			y: Math.max(4, rects[0].top - 38),
			states: BUTTONS.map(({ command }) => ({
				enabled: editor.canRunCommand(command),
				pressed: editor.isCommandActive(command)
			}))
		};
	}
</script>

{#if bar}
	<div class="selection-toolbar" style:left="{bar.x}px" style:top="{bar.y}px">
		{#each BUTTONS as { label, Icon, command }, i (label)}
			<!-- Mousedown is swallowed so the press never takes the selection the command needs. -->
			<button
				type="button"
				aria-label={label}
				aria-pressed={bar.states[i].pressed}
				disabled={!bar.states[i].enabled}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => instance?.runCommand(command)}
			>
				<Icon size={14} />
			</button>
		{/each}
	</div>
{/if}

<style>
	.selection-toolbar {
		position: fixed;
		z-index: 100;
		display: flex;
		gap: 2px;
		padding: 3px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-surface, 8px);
		background: var(--color-surface);
	}

	.selection-toolbar button {
		display: inline-flex;
		align-items: center;
		padding: 4px 6px;
		border: none;
		border-radius: var(--radius-ui, 4px);
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.selection-toolbar button:hover:not(:disabled) {
		background: var(--menu-item-hover);
		color: var(--color-text-primary);
	}

	.selection-toolbar button[aria-pressed='true'] {
		background: var(--color-border);
		color: var(--color-text-primary);
	}

	.selection-toolbar button:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
