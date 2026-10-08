<script lang="ts">
	import type { InlineWidgetComponentProps } from '@voithos-labs/aragonite/plugin';
	import { parseWikiTarget } from '#lib/services/links.svelte.js';
	import { linkIndex, resolveWikiLink } from '#lib/services/links.svelte.js';
	import { ACTIVATE_EVENT, type ActivateDetail } from './wikilinks';

	let { source }: InlineWidgetComponentProps = $props();

	// svelte-ignore state_referenced_locally
	const { target, fragment, alias } = parseWikiTarget(source.slice(2, -2));
	const label = alias ?? (fragment ? (target ? `${target} > ${fragment}` : fragment) : target);

	let el: HTMLElement | null = $state(null);
	let unresolved = $state(false);

	$effect(() => {
		linkIndex.version;
		const sourceId = el?.closest('[data-source-id]')?.getAttribute('data-source-id');
		if (!sourceId || !target) return;
		let live = true;
		resolveWikiLink(sourceId, target).then((hit) => {
			if (live) unresolved = hit === null;
		});
		return () => {
			live = false;
		};
	});

	// Any click follows the link (the registration's plainClickActivates): Shift opens it beside,
	// Ctrl/Cmd in a new tab
	function onClick(e: MouseEvent): void {
		// A drag that began and ended on the link is a selection, not a click on it
		if (!(window.getSelection()?.isCollapsed ?? true)) return;
		e.preventDefault();
		const detail: ActivateDetail = {
			kind: 'wikilink',
			target,
			fragment,
			side: e.shiftKey,
			newTab: e.ctrlKey || e.metaKey
		};
		el?.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { bubbles: true, detail }));
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<span bind:this={el} class="wikilink" class:unresolved onclick={onClick}>{label}</span>

<style>
	.wikilink {
		color: var(--color-accent);
		text-decoration: underline;
		text-decoration-color: var(--accent-a30);
		text-underline-offset: 0.15em;
		cursor: pointer;
	}

	.wikilink.unresolved {
		color: var(--md-unresolved-color);
		text-decoration-style: dashed;
	}
</style>
