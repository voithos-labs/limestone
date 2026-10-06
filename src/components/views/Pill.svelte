<script lang="ts">
	import type { ViewField } from '$lib/models/View.svelte';
	import { tagClass } from '$lib/views/fieldValue';

	let { field, value }: { field: ViewField; value: string } = $props();
</script>

<span class="pill {tagClass(field, value)}">{value}</span>

<style>
	.pill {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		padding: 1px 8px;
		border-radius: 4px;
		font-size: 11px;
		line-height: 1.55;
		white-space: nowrap;
		background: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-bg-l, 90%));
		color: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-fg-l, 30%));
	}
</style>
