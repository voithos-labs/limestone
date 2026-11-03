<script lang="ts">
	import type { AnnotationKind } from '#lib/pdf/annotation.js';

	/** What the pages wait for while an annotation is placed again, above the dock. */
	let { kind, onCancel }: { kind: AnnotationKind; onCancel: () => void } = $props();

	const HINTS: Record<AnnotationKind, string> = {
		highlight: 'Select the passage to place the highlight on',
		region: 'Drag a box to place the region',
		ink: 'Click where the top-left corner of the ink goes'
	};
</script>

<div class="hint">
	<span>{HINTS[kind]}</span>
	<button type="button" onclick={onCancel}>Cancel<kbd>Esc</kbd></button>
</div>

<style>
	.hint {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 4px 4px 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 12px;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 26px;
		padding: 0 8px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-muted);
		font: inherit;
		cursor: pointer;
	}

	button:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	kbd {
		padding: 0 4px;
		border-radius: 4px;
		background: var(--chip-bg);
		font: inherit;
		font-size: 11px;
	}
</style>
