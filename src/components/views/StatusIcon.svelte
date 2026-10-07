<script lang="ts">
	import { Check } from '@lucide/svelte';
	import type { StatusKind } from '$lib/views/todoStatus';

	let { kind, color, size = 16 }: { kind: StatusKind; color: number; size?: number } = $props();
</script>

<span
	class="status tag-c{color} {kind}"
	style:width="{size}px"
	style:height="{size}px"
	style:border-width="{size >= 16 ? 1.5 : 1.25}px"
>
	{#if kind === 'done'}
		<Check size={Math.round(size * 0.62)} strokeWidth={3} />
	{:else if kind === 'doing'}
		<span class="half"></span>
	{/if}
</span>

<style>
	/* a ring in the option's colour: empty, half full, or filled with a check */
	.status {
		--c: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-fg-l, 30%));
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		box-sizing: border-box;
		border: 1.5px solid var(--c);
		border-radius: 50%;
		color: #fff;
	}

	.status.todo {
		--c: var(--color-ui-muted);
	}

	.status.done {
		background: var(--c);
	}

	.half {
		width: calc(100% - 4px);
		height: calc(100% - 4px);
		border-radius: 50%;
		background: conic-gradient(var(--c) 0 50%, transparent 50% 100%);
	}
</style>
