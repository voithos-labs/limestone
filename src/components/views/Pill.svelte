<script lang="ts">
	import type { ViewField } from '#lib/models/View.svelte.js';
	import { isStatusField } from '#lib/models/View.svelte.js';
	import { tagClass } from '#lib/views/fieldValue.js';
	import { statusColor, statusKind } from '#lib/views/fieldValue.js';
	import StatusIcon from './StatusIcon.svelte';

	let {
		field,
		value,
		filled = false
	}: { field: ViewField; value: string; filled?: boolean } = $props();
</script>

{#if isStatusField(field)}
	{@const kind = statusKind(field, value)}
	<span class="status-pill tag-c{statusColor(field, value)} {kind}" class:filled>
		<StatusIcon {kind} color={statusColor(field, value)} size={filled ? 11 : 14} />
		<span>{value}</span>
	</span>
{:else}
	<span class="pill {tagClass(field, value)}">{value}</span>
{/if}

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

	.status-pill {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		gap: 6px;
		font-size: 12px;
		white-space: nowrap;
		color: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-fg-l, 30%));
	}

	.status-pill.todo {
		color: var(--color-text-secondary);
	}

	.status-pill.filled {
		gap: 4px;
		padding: 1px 8px 1px 6px;
		border-radius: 4px;
		font-size: 11px;
		line-height: 1.55;
		background: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-bg-l, 90%));
	}

	.status-pill.filled.todo {
		background: var(--chip-bg);
	}
</style>
