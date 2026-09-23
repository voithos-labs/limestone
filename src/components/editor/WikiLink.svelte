<script lang="ts">
	import {
		isWidgetActivationClick,
		type InlineWidgetComponentProps
	} from '@voithos-labs/aragonite/plugin';
	import { parseWikiTarget } from '$lib/wikilinks';
	import { linkIndex, resolveWikiLink } from '$lib/services/links.svelte';
	import { ACTIVATE_EVENT, type ActivateDetail } from './wikilinks-plugin';

	let { source, getPresentationMode }: InlineWidgetComponentProps = $props();

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

	function onClick(e: MouseEvent): void {
		const mode = getPresentationMode?.() ?? 'source';
		if (!isWidgetActivationClick(e.ctrlKey || e.metaKey, mode)) return;
		e.preventDefault();
		const detail: ActivateDetail = { kind: 'wikilink', target, fragment };
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
