/**
 * Mounts a bare aragonite editor in the page, so the wiki-embed plugin can be driven
 * before Task 4 gives the app one. Nothing in the app imports it: `wiki-embed.spec.ts`
 * pulls it in over the dev server, which serves modules from `src/` alone — that fs
 * policy, not a preference, is why test scaffolding sits beside the code it drives.
 *
 * The resolver a real editor gets is limestone's asset resolver; here it answers a
 * fixed set of targets with a data URI, because the specs assert on the `<img>` the
 * plugin built, never on pixels.
 */
import { mount } from 'svelte';
import { Editor, type EditorInstance } from 'aragonite';
import { editorPlugins } from './editor-plugins';

/** 1x1 transparent PNG. */
const PIXEL =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export interface HarnessOptions {
	source: string;
	/** Embed targets the resolver answers. Every other target is declined. */
	resolvable?: string[];
}

export function mountHarnessEditor(opts: HarnessOptions): void {
	const host = document.createElement('div');
	host.id = 'wiki-embed-harness';
	document.body.appendChild(host);

	const resolvable = new Set(opts.resolvable ?? []);
	const editor = mount(Editor, {
		target: host,
		props: {
			source: opts.source,
			plugins: editorPlugins({
				// The fragment makes each target's URL distinct, so a spec can tell which
				// embed resolved to which asset.
				resolveUrl: (target) => (resolvable.has(target) ? `${PIXEL}#${target}` : null)
			})
		}
	}) as EditorInstance;

	Object.assign(window, { __wikiEmbedSource: () => editor.getSource() });
}
