<script lang="ts">
	import cat from '#assets/art/cat.txt?raw';
	import GoneActions, { type GoneAction } from './GoneActions.svelte';

	let {
		headline,
		detail,
		art = cat,
		actions = [],
		note = null
	}: {
		headline: string;
		detail: string;
		art?: string;
		actions?: GoneAction[];
		note?: string | null;
	} = $props();
</script>

<div class="gone">
	<pre class="cat">{art}</pre>
	<p class="headline">{headline}</p>
	<p class="detail">
		{#each detail.split('`') as part, i (i)}{#if i % 2}<code>{part}</code>{:else}{part}{/if}{/each}
	</p>
	<div class="room"><GoneActions {actions} {note} /></div>
</div>

<style>
	.gone {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		margin: 0 24px;
		padding-bottom: 48px;
		text-align: center;
		color: var(--color-ui-dulled);
	}

	.cat {
		margin: 0 0 18px;
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.2;
		white-space: pre;
		text-align: left;
		user-select: none;
	}

	.headline {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.detail {
		max-width: 360px;
		margin: 0;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.45;
		color: var(--color-ui-dulled);
	}

	.detail code {
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--chip-bg);
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--color-text-secondary);
		overflow-wrap: anywhere;
	}

	.room {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		margin-top: 6px;
	}
</style>
