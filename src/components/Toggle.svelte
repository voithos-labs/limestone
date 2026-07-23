<script lang="ts">
	let { checked = $bindable(false) }: { checked?: boolean } = $props();
</script>

<label class="toggle">
	<input type="checkbox" bind:checked />
	<span class="toggle-slider"></span>
</label>

<style>
	.toggle {
		position: relative;
		display: inline-block;
		flex-shrink: 0;
		width: 36px;
		height: 20px;
		cursor: pointer;
	}

	.toggle input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle-slider {
		position: absolute;
		inset: 0;
		background: var(--color-ui-muted);
		border-radius: 10px;
		transition: background 150ms ease;
	}

	.toggle-slider::before {
		content: '';
		position: absolute;
		left: 2px;
		top: 2px;
		width: 16px;
		height: 16px;
		background: var(--color-surface);
		border-radius: 50%;
		transition: transform 150ms ease;
	}

	.toggle input:checked + .toggle-slider {
		background: var(--color-accent);
	}

	.toggle input:checked + .toggle-slider::before {
		transform: translateX(16px);
	}
</style>
