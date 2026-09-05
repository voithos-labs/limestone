<script lang="ts">
	/**
	 * A quiet + beside the mode toggle: pick a structure and it lands at the caret. Live mode only,
	 * where the markers are hidden and there is nothing on screen to copy the syntax from.
	 */
	import type { EditorInstance } from '@voithos-labs/aragonite';
	import { contextMenu, type CtxEntry } from '$lib/contextMenu.svelte';
	import { Plus } from '@lucide/svelte';

	let { instance }: { instance: EditorInstance | undefined } = $props();

	const SNIPPETS: readonly { label: string; md: string }[] = [
		{ label: 'Table', md: '| Column | Column |\n| --- | --- |\n|  |  |\n' },
		{ label: 'Code block', md: '```\n\n```\n' },
		{ label: 'Callout', md: ':::note\n\n:::\n' },
		{ label: 'Details', md: '<details>\n<summary>Summary</summary>\n\n</details>\n' },
		{ label: 'Math block', md: '$$\n\n$$\n' },
		{ label: 'Diagram', md: '```mermaid\n\n```\n' },
		{ label: 'Divider', md: '---\n' }
	];

	function openMenu(e: MouseEvent) {
		if (!instance) return;
		// The menu takes focus off the document, so remember the caret and put it back before
		// inserting — the editor declines an insert with no caret to insert at.
		const caret = instance.getSelection();
		const items: CtxEntry[] = SNIPPETS.map(({ label, md }) => ({
			label,
			action: async () => {
				if (caret) await instance.setSelection(caret);
				instance.insertMarkdown(md);
			}
		}));
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		contextMenu.show(rect.left, rect.bottom + 4, items);
	}
</script>

<button
	type="button"
	class="insert-menu-button"
	aria-label="Insert"
	onmousedown={(e) => e.preventDefault()}
	onclick={openMenu}
>
	<Plus size={14} />
</button>

<style>
	.insert-menu-button {
		display: inline-flex;
		align-items: center;
		padding: 3px 6px;
		border: none;
		border-radius: var(--radius-ui, 4px);
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.insert-menu-button:hover {
		color: var(--color-text-primary);
	}
</style>
