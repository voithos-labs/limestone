<script lang="ts">
	/**
	 * what aragonite draws for a [[wikilink]] in a note.
	 *
	 * It shows the link's alias, or the note and heading it points to, with a dashed underline when
	 * no note has that name and a dotted one when the note was deleted. Clicking it opens the note,
	 * shift-click beside and ctrl-click in a new tab, by sending ACTIVATE_EVENT up the page for
	 * follow-link.ts to catch.
	 */

	import { type InlineWidgetComponentProps } from '@voithos-labs/aragonite/plugin';
	import { parseWikiTarget } from '#lib/services/links.svelte.js';
	import { linkIndex, resolveWikiLink } from '#lib/services/links.svelte.js';
	import { ACTIVATE_EVENT, type ActivateDetail } from './wikilinks';

	let { source, isActivationClick }: InlineWidgetComponentProps = $props();

	// svelte-ignore state_referenced_locally
	const { target, fragment, alias } = parseWikiTarget(source.slice(2, -2));
	const label = alias ?? (fragment ? (target ? `${target} > ${fragment}` : fragment) : target);

	let el: HTMLElement | null = $state(null);
	let unresolved = $state(false);
	let deleted = $state(false);

	$effect(() => {
		linkIndex.version;
		const sourceId = el?.closest('[data-source-id]')?.getAttribute('data-source-id');
		if (!sourceId || !target) return;
		let live = true;
		resolveWikiLink(sourceId, target).then((hit) => {
			if (!live) return;
			unresolved = hit === null;
			deleted = !!hit?.deleted;
		});
		return () => {
			live = false;
		};
	});

	function onClick(e: MouseEvent): void {
		if (!isActivationClick(e)) return;
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
<span bind:this={el} class="wikilink" class:unresolved class:deleted onclick={onClick}>{label}</span
>

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

	.wikilink.deleted {
		opacity: 0.6;
		text-decoration-style: dotted;
	}
</style>
