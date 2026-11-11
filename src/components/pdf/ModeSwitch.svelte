<script lang="ts">
	/**
	 * the Pages | Digest switch in a pdf's header.
	 *
	 * Pages is the pdf itself, and the digest is its annotations as one list.
	 */

	let {
		mode,
		onChange
	}: { mode: 'pages' | 'digest'; onChange: (next: 'pages' | 'digest') => void } = $props();
</script>

<span class="modes" role="tablist">
	<button
		class:on={mode === 'pages'}
		type="button"
		role="tab"
		aria-selected={mode === 'pages'}
		onclick={() => onChange('pages')}>Pages</button
	>
	<button
		class:on={mode === 'digest'}
		type="button"
		role="tab"
		aria-selected={mode === 'digest'}
		onclick={() => onChange('digest')}>Digest</button
	>
</span>

<style>
	/* the design's Pages | Digest switch, at the far end of the meta row */
	.modes {
		display: flex;
		gap: 2px;
		padding: 2px;
		border-radius: 7px;
		background: var(--chip-bg);
	}

	.modes button {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 9px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-muted);
		font: inherit;
		cursor: pointer;
	}

	.modes button.on {
		background: var(--chip-seg-active);
		color: var(--color-text-primary);
	}
</style>
