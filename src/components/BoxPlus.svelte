<script lang="ts">
	import { Box, Plus } from '@lucide/svelte';

	let { size = 14, strokeWidth = 1.75 }: { size?: number; strokeWidth?: number } = $props();
</script>

<span class="box-plus" style="width: {size}px; height: {size}px">
	<Box {size} {strokeWidth} />
	<span class="plus"><Plus size={Math.round(size * 0.6)} strokeWidth={3.5} /></span>
</span>

<style>
	.box-plus {
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
