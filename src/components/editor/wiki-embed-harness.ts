/**
 * Drives the wiki-embed plugin before Task 4 gives the app an editor: it parses with the
 * plugins installed, and mounts a bare editor when a scenario needs rendered DOM. Nothing
 * in the app imports it — `wiki-embed.spec.ts` pulls it in over the dev server, which
 * serves modules from `src/` alone. That fs policy, not a preference, is why test
 * scaffolding sits beside the code it drives.
 */
import { mount } from 'svelte';
import { Editor, installPlugins, parse, type EditorInstance, type InlineNode } from 'aragonite';
import { computeInlineContent } from 'aragonite/plugin';
import { EDITOR_PLUGINS } from './editor-plugins';

/** 1x1 transparent PNG, so a resolved embed loads rather than reporting itself broken. */
const PIXEL =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** The inline nodes of the document block at `index`, with the plugins installed. */
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
	host.id = 'wiki-embed-harness';
	document.body.appendChild(host);

	const editor = mount(Editor, {
		target: host,
		props: {
			source,
			plugins: EDITOR_PLUGINS,
			resolveImageUrl: (target: string) => `${PIXEL}#${target}`
		}
	}) as EditorInstance;

	Object.assign(window, { __wikiEmbedSource: () => editor.getSource() });
}
