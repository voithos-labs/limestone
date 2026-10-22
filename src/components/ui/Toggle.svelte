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
		width: 32px;
		height: 18px;
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
		background: var(--chip-bg-hover);
		border-radius: 999px;
		transition: background-color 120ms ease;
	}

	.toggle:hover .toggle-slider {
		background: var(--chip-seg-active);
	}

	.toggle-slider::before {
		content: '';
		position: absolute;
		left: 3px;
		top: 3px;
		width: 12px;
		height: 12px;
		background: var(--color-bg);
		border-radius: 50%;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
		transition: transform 120ms ease;
	}

	.toggle input:checked + .toggle-slider,
	.toggle:hover input:checked + .toggle-slider {
		background: var(--color-accent);
	}

	.toggle input:checked + .toggle-slider::before {
		transform: translateX(14px);
	}

	.toggle input:focus-visible + .toggle-slider {
		box-shadow:
			0 0 0 2px var(--color-bg),
			0 0 0 3.5px var(--focus-ring);
	}
</style>
