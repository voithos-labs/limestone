<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import Menu from './Menu.svelte';
	import type { MenuItem } from '$lib/views/menuTypes';

	let {
		items,
		onSelect,
		el = $bindable(null)
	}: {
		items: MenuItem[];
		onSelect: (value: string) => void;
		el?: HTMLButtonElement | null;
	} = $props();

	let open = $state(false);
	const only = $derived(items.length === 1 ? items[0] : null);

	function onclick() {
		if (only) onSelect(only.value);
		else open = !open;
	}
</script>

<button class="new-fab" type="button" title={only?.label ?? 'New'} bind:this={el} {onclick}>
	<Plus size={18} strokeWidth={2} />
</button>

<Menu
	bind:open
	anchor={el}
	{items}
	onSelect={(v) => {
		open = false;
		onSelect(v);
	}}
	minWidth={160}
/>

<style>
	.new-fab {
		position: absolute;
		bottom: 24px;
		right: calc(24px + max(0px, (100% - var(--page-max-width, 100%)) / 2));
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border: none;
		border-radius: 10px;
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		cursor: pointer;
		box-shadow: var(--menu-shadow);
	}

	.new-fab:hover {
		filter: brightness(1.08);
	}
</style>
