<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronDown } from '@lucide/svelte';
	import { ctxMenu, type CtxEntry } from '$lib/contextMenu.svelte';

	let {
		title,
		count,
		collapsed = false,
		onToggle,
		menu = () => null,
		lead,
		tools,
		trail
	}: {
		title: string;
		count: string | number;
		collapsed?: boolean;
		onToggle: () => void;
		menu?: () => CtxEntry[] | null;
		lead?: Snippet;
		tools?: Snippet;
		trail?: Snippet;
	} = $props();
</script>

<header class="section-head" use:ctxMenu={menu}>
	{@render lead?.()}
	<button class="head" type="button" onclick={onToggle}>
		<span class="title">{title}</span>
		<span class="count">{count}</span>
		<span class="caret" class:collapsed>
			<ChevronDown size={12} strokeWidth={2} />
		</span>
	</button>
	{@render tools?.()}
	<span class="rule"></span>
	{@render trail?.()}
</header>

<style>
	.section-head {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-bottom: 4px;
	}

	.head {
		display: inline-flex;
		align-items: baseline;
		gap: 8px;
		padding: 0;
		border: none;
		background: transparent;
		font: inherit;
		cursor: pointer;
	}

	.title {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.count {
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.caret {
		display: inline-flex;
		align-self: center;
		color: var(--color-ui-muted);
		opacity: 0;
		transition:
			opacity 80ms ease,
			transform 120ms ease;
	}

	.section-head:hover .caret,
	.caret.collapsed {
		opacity: 1;
	}

	.caret.collapsed {
		transform: rotate(-90deg);
	}

	.rule {
		flex: 1;
		height: 1px;
		margin: 0 14px 0 10px;
		background: var(--chip-divider);
	}
</style>
