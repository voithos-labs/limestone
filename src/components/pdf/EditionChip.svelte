<script lang="ts">
	/**
	 * the header chip shown while you're reading an earlier edition of a pdf.
	 *
	 * It names the edition by its date, and clicking it goes back to the current file.
	 */

	import { Pin } from '@lucide/svelte';

	let {
		day,
		onBack
	}: {
		/** The day the edition dates from, or null when that isn't known. */
		day: string | null;
		onBack: () => void;
	} = $props();
</script>

<button class="edition-chip" type="button" onclick={onBack}>
	<Pin size={12} strokeWidth={1.75} />
	{#if day}<span class="day">{day} edition</span>{:else}Earlier edition{/if}
	· back to the current file
</button>

<style>
	.edition-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 24px;
		padding: 0 8px;
		border: 0;
		border-radius: 6px;
		background: var(--chip-bg);
		color: var(--color-text-secondary);
		font: inherit;
		cursor: pointer;
	}

	.edition-chip:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.edition-chip .day {
		font-family: var(--font-mono);
		font-size: 11px;
	}
</style>
