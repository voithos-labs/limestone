<script lang="ts">
	import type DocHistory from '$lib/models/DocHistory.svelte';
	import { History, X } from '@lucide/svelte';

	let {
		history,
		onRestore,
		onClose
	}: {
		history: DocHistory;
		onRestore: () => void;
		onClose: () => void;
	} = $props();

	const count = $derived(history.count);
	const max = $derived(Math.max(0, count - 1));
	const pct = $derived(max > 0 ? (history.index / max) * 100 : 100);
	const empty = $derived(count < 2);

	function formatWhen(ms: number): string {
		const d = new Date(ms);
		const sameYear = d.getFullYear() === new Date().getFullYear();
		const date = d.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			...(sameYear ? {} : { year: 'numeric' })
		});
		const time = d
			.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
			.toLowerCase()
			.replace(/[\s.]/g, '');
		return `${date} ${time}`;
	}

	const whenLabel = $derived(
		empty
			? 'No earlier versions yet'
			: history.atPresent || !history.selected
				? 'Current version'
				: formatWhen(history.selected.time)
	);

	// Every label the slider can show, so the slot is sized to the widest one and never shifts.
	const labels = $derived.by(() => {
		const all = new Set<string>([whenLabel, 'Current version']);
		for (const cp of history.checkpoints.slice(0, -1)) all.add(formatWhen(cp.time));
		return [...all];
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		onClose();
	}
</script>

{#snippet slider()}
	<input
		class="hist-slider"
		type="range"
		min="0"
		{max}
		step="1"
		value={history.index}
		disabled={empty}
		style="--pct: {pct}%"
		aria-label="Version"
		oninput={(e) => void history.select(Number(e.currentTarget.value))}
		onkeydown={onKeydown}
	/>
{/snippet}

{#snippet restore()}
	<button
		class="hist-btn primary"
		type="button"
		disabled={history.atPresent || history.loading}
		onclick={onRestore}
	>
		Restore
	</button>
{/snippet}

{#snippet close()}
	<button
		class="hist-btn icon"
		type="button"
		title={history.atPresent ? 'Close' : 'Cancel'}
		aria-label={history.atPresent ? 'Close' : 'Cancel'}
		onclick={onClose}
	>
		<X size={13} strokeWidth={1.75} />
	</button>
{/snippet}

<div class="doc-history">
	<span class="hist-icon"><History size={13} strokeWidth={1.75} /></span>
	{@render slider()}
	<span class="hist-when">
		{#each labels as label (label)}
			<span class="hist-when-item" class:active={label === whenLabel}>{label}</span>
		{/each}
	</span>
	{@render restore()}
	{@render close()}
</div>

<style>
	.doc-history {
		display: flex;
		align-items: center;
		gap: 10px;
		width: min(720px, 100%);
		padding: 7px 8px 7px 12px;
		border: 1px solid rgba(0, 0, 0, 0.12);
		border-radius: 8px;
		background: var(--color-accent);
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 12px;
		color: var(--color-accent-contrast);
	}

	.hist-icon {
		display: inline-flex;
		flex-shrink: 0;
		opacity: 0.75;
	}

	.hist-when {
		display: grid;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}

	.hist-when-item {
		grid-area: 1 / 1;
		visibility: hidden;
	}

	.hist-when-item.active {
		visibility: visible;
	}

	.hist-slider {
		-webkit-appearance: none;
		appearance: none;
		flex: 1;
		min-width: 80px;
		height: 20px;
		margin: 0;
		padding: 0;
		background: transparent;
		cursor: pointer;
	}

	.hist-slider::-webkit-slider-runnable-track {
		height: 2px;
		border-radius: 999px;
		background: linear-gradient(
			to right,
			var(--color-accent-contrast) 0 var(--pct),
			rgba(255, 255, 255, 0.3) var(--pct) 100%
		);
	}

	.hist-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 12px;
		height: 12px;
		margin-top: -5px;
		border-radius: 50%;
		border: none;
		background: var(--color-accent-contrast);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
	}

	.hist-slider:focus-visible {
		outline: none;
	}

	.hist-slider:focus-visible::-webkit-slider-thumb {
		box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.35);
	}

	.hist-slider:disabled {
		cursor: default;
		opacity: 0.45;
	}

	.hist-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		height: 22px;
		padding: 0 9px;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--color-accent-contrast);
		font-family: var(--font-ui);
		font-size: 12px;
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.hist-btn:hover {
		background: rgba(255, 255, 255, 0.14);
	}

	.hist-btn.icon {
		width: 22px;
		padding: 0;
		opacity: 0.85;
	}

	.hist-btn.primary {
		background: var(--color-accent-contrast);
		color: var(--color-accent);
	}

	.hist-btn.primary:hover {
		background: var(--color-accent-contrast);
		filter: brightness(0.95);
	}

	.hist-btn:disabled,
	.hist-btn:disabled:hover {
		background: rgba(255, 255, 255, 0.14);
		color: rgba(255, 255, 255, 0.55);
		filter: none;
		cursor: default;
	}
</style>
