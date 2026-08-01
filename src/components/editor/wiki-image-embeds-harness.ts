/**
 * Runs the wiki image embeds plugin without the app around it. Nothing in the app imports this;
 * it lives under `src/` because that is the only tree the dev server serves modules from, and
 * `wiki-image-embeds.spec.ts` loads it through that server.
 */
import { mount } from 'svelte';
import { Editor, installPlugins, parse, type EditorInstance, type InlineNode } from 'aragonite';
import { computeInlineContent } from 'aragonite/plugin';
import { EDITOR_PLUGINS } from './editor-plugins';

/** 1x1 transparent PNG, so a resolved embed loads rather than reporting itself broken. */
const PIXEL =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** How the plugins parse the inline content of the document block at `index`. */
export function inlineNodesAt(source: string, index = 0): InlineNode[] {
	installPlugins(EDITOR_PLUGINS.map((entry) => ('plugin' in entry ? entry.plugin : entry)));
	const block = parse(source).children[index];
	return block ? computeInlineContent(block) : [];
}

/**
 * Mounts an editor whose `resolveImageUrl` answers every embed with a loadable pixel,
 * tagged by target so a spec can tell which image resolved from which path.
 */
export function mountHarnessEditor(source: string): void {
	const host = document.createElement('div');
	host.id = 'wiki-image-embeds-harness';
	document.body.appendChild(host);

	const editor = mount(Editor, {
		target: host,
		props: {
			source,
			plugins: EDITOR_PLUGINS,
			resolveImageUrl: (target: string) => `${PIXEL}#${target}`
		}
	}) as EditorInstance;

	Object.assign(window, { __wikiImageEmbedSource: () => editor.getSource() });
}
