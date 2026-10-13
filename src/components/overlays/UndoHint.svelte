<script lang="ts">
	import { undoHint } from '#lib/overlays.svelte.js';
	import type { SettingsState } from '#lib/models/Settings.svelte.js';
	import { keyTokens } from '#lib/shortcuts.js';

	let { settings }: { settings: SettingsState } = $props();

	const hint = $derived(
		settings.get<boolean>('general.action_hints') === false || !undoHint.visible
			? null
			: undoHint.current
	);
	const tokens = keyTokens('mod+z');
	const keys = /^\W$/.test(tokens[0]) ? tokens.join('') : tokens.join('+');

	function onKeydown(e: KeyboardEvent) {
		if (!undoHint.current) return;
		if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'z') return;
		const a = document.activeElement as HTMLElement | null;
		if (a && (a.matches('input, textarea, select') || a.isContentEditable || a.closest('.editor')))
			return;
		e.preventDefault();
		e.stopPropagation();
		undoHint.fire();
	}
</script>

<svelte:window onkeydowncapture={onKeydown} />

{#if hint}
	<div class="undo-hint">
		<span class="undo-label">{hint.label}</span>
		<button class="undo-btn" type="button" onclick={() => undoHint.fire()}>
			Undo <kbd>{keys}</kbd>
		</button>
	</div>
{/if}

<style>
	.undo-hint {
		position: absolute;
		bottom: 24px;
		right: 66px;
		z-index: 5;
		display: flex;
		align-items: center;
		height: 34px;
		padding: 0 6px 0 14px;
		border-radius: 17px;
		background: var(--chip-bg);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 12.5px;
		box-shadow: var(--menu-shadow);
		white-space: nowrap;
	}

	.undo-label {
		padding-right: 10px;
	}

	.undo-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		padding: 0 10px;
		border: none;
		border-radius: 12px;
		background: var(--chip-bg);
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 12.5px;
		font-weight: 600;
		cursor: pointer;
	}

	.undo-btn:hover {
		background: var(--chip-bg-hover);
	}

	.undo-btn kbd {
		font-family: var(--font-ui);
		font-size: 11px;
		font-weight: 500;
		color: var(--color-ui-muted);
	}
</style>
