<script lang="ts">
	import {
		isWidgetActivationClick,
		type InlineWidgetComponentProps
	} from '@voithos-labs/aragonite/plugin';
	import { ACTIVATE_EVENT, type ActivateDetail } from './wikilinks-plugin';

	let { source, getPresentationMode }: InlineWidgetComponentProps = $props();

	let el: HTMLElement | null = $state(null);

	function onClick(e: MouseEvent): void {
		const mode = getPresentationMode?.() ?? 'source';
		if (!isWidgetActivationClick(e.ctrlKey || e.metaKey, mode)) return;
		e.preventDefault();
		const detail: ActivateDetail = { kind: 'tag', target: source.slice(1) };
		el?.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { bubbles: true, detail }));
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<span bind:this={el} class="body-tag" onclick={onClick}>{source}</span>

<style>
	.body-tag {
		padding: 0.05em 0.45em;
		border-radius: 999px;
		background: var(--accent-a14);
		color: var(--color-accent);
		cursor: pointer;
	}
</style>
