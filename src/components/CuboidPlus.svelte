<script lang="ts">
	import { Cuboid, Plus } from '@lucide/svelte';

	let { size = 14, strokeWidth = 1.75 }: { size?: number; strokeWidth?: number } = $props();
</script>

<span class="cuboid-plus" style="width: {size}px; height: {size}px">
	<Cuboid {size} {strokeWidth} />
	<span class="plus"><Plus size={Math.round(size * 0.6)} strokeWidth={3.5} /></span>
</span>

<style>
	.cuboid-plus {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.plus {
		position: absolute;
		right: -3px;
		bottom: -3px;
		display: inline-flex;
	}
</style>
