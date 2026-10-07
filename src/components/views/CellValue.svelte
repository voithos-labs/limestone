<script lang="ts">
	import { Square, Hash } from '@lucide/svelte';
	import type { ViewField, MemberRow } from '$lib/models/View.svelte';
	import { isBuiltinUnit, isStatusField } from '$lib/models/View.svelte';
	import { statusOf } from '$lib/views/fieldValue';
	import type { Source } from '$lib/models/Source';
	import {
		rawStatefulValue,
		statefulValue,
		rawArrayValue,
		valueFor,
		folderDir,
		sourceName
	} from '$lib/views/fieldValue';
	import FolderCrumb from './FolderCrumb.svelte';
	import Pill from './Pill.svelte';

	let {
		field,
		row,
		sources = [],
		tags = []
	}: {
		field: ViewField;
		row: MemberRow;
		sources?: Source[];
		tags?: string[];
	} = $props();
</script>

{#if field.type === 'boolean'}
	{@const on = rawStatefulValue(row, field) === true}
	<span class="bool" class:on>
		{#if on}<Square size={15} strokeWidth={2} fill="currentColor" />{:else}<Square
				size={15}
				strokeWidth={2}
			/>{/if}
	</span>
{:else if field.type === 'select'}
	{@const v = isStatusField(field) ? statusOf(row, field) : statefulValue(row, field)}
	{#if v}<Pill {field} value={v} />{:else}<span class="muted">—</span>{/if}
{:else if field.type === 'multiselect'}
	{@const arr = rawArrayValue(row, field)}
	{#if arr.length}
		<span class="pills">
			{#each arr as t (t)}<Pill {field} value={t} />{/each}
		</span>
	{:else}<span class="muted">—</span>{/if}
{:else if field.type === 'tags'}
	{#if tags.length}
		<span class="pills">
			{#each tags as t (t)}<span class="tag" class:builtin={isBuiltinUnit(`tag:${t}`)}
					><Hash size={11} />{t}</span
				>{/each}
		</span>
	{:else}<span class="muted">—</span>{/if}
{:else if field.type === 'folder'}
	<FolderCrumb dir={folderDir(row.rel_path)} rootLabel={sourceName(sources, row.source_id)} />
{:else}
	{valueFor(field, row)}
{/if}

<style>
	.muted {
		color: var(--color-ui-dulled);
	}

	.bool {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		height: var(--row-h);
		color: var(--color-ui-dulled);
		transition: color 120ms ease;
	}

	.bool.on {
		color: var(--color-accent);
	}

	.pills {
		display: inline-flex;
		gap: 4px;
		overflow: hidden;
		vertical-align: middle;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		gap: 3px;
		height: 18px;
		padding: 0 9px 0 6px;
		border-radius: 999px;
		background: var(--chip-bg);
		color: var(--color-ui-dulled);
		font-size: 11px;
		white-space: nowrap;
	}

	/* a built-in tag is the app's, not the user's: inverted, in the accent */
	.tag.builtin {
		background: var(--color-accent);
		color: #fff;
	}

	.tag.builtin :global(svg) {
		opacity: 0.85;
	}

	.tag :global(svg) {
		opacity: 0.7;
	}
</style>
