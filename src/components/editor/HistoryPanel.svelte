<script lang="ts">
	import type DocHistory from '$lib/models/DocHistory.svelte';

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

	const countLabel = $derived(
		count > 1
			? `${count - 1} earlier ${count === 2 ? 'version' : 'versions'}`
			: 'No earlier versions yet'
	);
	const whenLabel = $derived(
		history.atPresent || !history.selected ? 'Current version' : formatWhen(history.selected.time)
	);

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		onClose();
	}
</script>

<div class="doc-history">
	<div class="hist-head">
		<span class="hist-count">{countLabel}</span>
		<span class="hist-when" class:present={history.atPresent}>{whenLabel}</span>
	</div>
	<input
		class="hist-slider"
		type="range"
		min="0"
		{max}
		step="1"
		value={history.index}
		disabled={count < 2}
		style="--pct: {pct}%"
		aria-label="Version"
		oninput={(e) => void history.select(Number(e.currentTarget.value))}
		onkeydown={onKeydown}
	/>
	<div class="hist-actions">
		<button class="btn" type="button" onclick={onClose}>
			{history.atPresent ? 'Close' : 'Cancel'}
		</button>
		<button
			class="btn primary"
			type="button"
			disabled={history.atPresent || history.loading}
			onclick={onRestore}
		>
			Restore
		</button>
	</div>
</div>

<style>
	.doc-history {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 12px;
		font-family: var(--font-ui);
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.hist-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}

	.hist-when {
		color: var(--color-text-primary);
		font-variant-numeric: tabular-nums;
	}

	.hist-when.present {
		color: var(--color-ui-muted);
	}

	.hist-slider {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 16px;
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

	.hist-actions {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
	}

	.btn {
		padding: 4px 10px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 12px;
		cursor: pointer;
	}

	.btn:hover {
		color: var(--color-text-primary);
	}

	.btn.primary {
		border-color: transparent;
		background: var(--color-accent);
		color: var(--color-accent-contrast);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
