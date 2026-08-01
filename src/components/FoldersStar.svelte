<script lang="ts">
	import { Notebook, Star } from '@lucide/svelte';

	let { size = 14, strokeWidth = 1.75 }: { size?: number; strokeWidth?: number } = $props();
</script>

<span class="folders-star" style="width: {size}px; height: {size}px">
	<Notebook {size} {strokeWidth} />
	<span class="star"
		><Star size={Math.round(size * 0.6)} strokeWidth={0} fill="currentColor" /></span
	>
</span>

<style>
	.folders-star {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.star {
		position: absolute;
		right: -3px;
		bottom: -3px;
		display: inline-flex;
	}
</style>
