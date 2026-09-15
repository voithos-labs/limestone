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
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.hist-icon {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--color-ui-dulled);
	}

	.hist-when {
		display: grid;
		flex-shrink: 0;
		color: var(--color-text-primary);
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
			var(--color-accent) 0 var(--pct),
			var(--color-border) var(--pct) 100%
		);
	}

	.hist-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 12px;
		height: 12px;
		margin-top: -5px;
		border-radius: 50%;
		border: 1.5px solid var(--color-accent);
		background: var(--color-bg);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
	}

	.hist-slider:focus-visible {
		outline: none;
	}

	.hist-slider:focus-visible::-webkit-slider-thumb {
		box-shadow: 0 0 0 3px var(--accent-a22);
	}

	.hist-slider:disabled {
		cursor: default;
		opacity: 0.45;
	}

	/* Same metrics as the header chips, so the card's controls read as the app's own. */
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
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 12px;
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.hist-btn:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.hist-btn.icon {
		width: 22px;
		padding: 0;
	}

	.hist-btn.primary {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
	}

	.hist-btn.primary:hover {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		filter: brightness(1.08);
	}

	.hist-btn:disabled,
	.hist-btn:disabled:hover {
		background: var(--chip-bg);
		color: var(--color-ui-dulled);
		filter: none;
		cursor: default;
	}
</style>
