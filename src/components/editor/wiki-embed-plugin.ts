import { definePlugin, isProseKind } from 'aragonite/plugin';
import type {
	Decoration,
	DecorationSource,
	DocumentView,
	EditorPlugin,
	NodeView
} from 'aragonite/plugin';
import { scanWikiEmbeds, type WikiEmbed } from './wiki-embed-scan';

/**
 * Renders Obsidian-style `![[cat.png]]` image embeds, the format limestone's notes
 * already use and its image paste still writes.
 *
 * The embeds render as replace decorations rather than as inline image nodes, because
 * aragonite's inline-syntax registry refuses `!` as a trigger: it is a reserved trigger
 * the built-in bracket scanner claims, and it is also held out of the scanner's
 * fast-bail character set, so `registerInlineSyntax` rejects it outright (see
 * `core/inline/scan/plugin-syntax.ts` upstream). Decorations reach the same pixels
 * through a view-only layer — and, being view-only, they cannot perturb the bytes.
 * Making `!` scan-visible upstream is what would let this become a real inline node,
 * with the caret and delete behavior aragonite gives its own image widgets.
 */

/** Per-instance options the host mounts the plugin with. */
export interface WikiEmbedOptions {
	/**
	 * An embed target — a source-relative asset path — to a URL the webview can load.
	 * Null declines the embed, leaving its bytes as literal text.
	 */
	resolveUrl(target: string): string | null;
}

export function wikiEmbedPlugin(): EditorPlugin<WikiEmbedOptions> {
	return definePlugin<WikiEmbedOptions>({
		name: 'limestone-wiki-embed',
		setup(ctx) {
			ctx.onEditor((editor) => {
				const handle = editor.decorations.addSource(createEmbedSource(() => editor.options));
				return () => handle.dispose();
			});
		}
	});
}

// ── Internal ────────────────────────────────────────────────────────────────

const SOURCE_NAME = 'limestone-wiki-embed';

// Aragonite's own class for an image widget, so an embed lays out exactly like a GFM
// image in the same document; the limestone class is the handle for styling and specs.
const ISLAND_CLASS = 'md-image-widget ls-wiki-embed';

/**
 * The document scan, memoized on the edit epoch: decorations are re-provided on every
 * render pass, and only an edit can change what the embeds are.
 */
function createEmbedSource(readOptions: () => WikiEmbedOptions | undefined): DecorationSource {
	let scannedEpoch = -1;
	let decorations: Decoration[] = [];
	return {
		name: SOURCE_NAME,
		provide(doc, { editEpoch }) {
			if (editEpoch !== scannedEpoch) {
				scannedEpoch = editEpoch;
				decorations = collectEmbeds(doc, readOptions());
			}
			return decorations;
		}
	};
}

function collectEmbeds(doc: DocumentView, options: WikiEmbedOptions | undefined): Decoration[] {
	const decorations: Decoration[] = [];
	forEachLeaf(doc.children, [], (node, path) => {
		// Code and other marker-only leaves carry no inline content to layer over.
		if (!isProseKind(node.kind)) return;
		for (const embed of scanWikiEmbeds(node.raw)) {
			// Optional: the plugins prop accepts a bare unit, which mounts with no options.
			const url = options?.resolveUrl(embed.target) ?? null;
			if (url === null) continue;
			decorations.push({
				type: 'replace',
				path,
				start: embed.start,
				end: embed.end,
				class: ISLAND_CLASS,
				widget: { buildDom: () => buildEmbedImage(url, embed) }
			});
		}
	});
	return decorations;
}

function buildEmbedImage(url: string, embed: WikiEmbed): HTMLElement {
	const img = document.createElement('img');
	img.src = url;
	img.alt = embed.target;
	if (embed.width !== undefined) img.width = embed.width;
	return img;
}

function forEachLeaf(
	children: readonly NodeView[],
	path: number[],
	visit: (node: NodeView, path: number[]) => void
): void {
	for (let i = 0; i < children.length; i++) {
		const node = children[i];
		const childPath = [...path, i];
		if (node.children) forEachLeaf(node.children, childPath, visit);
		else visit(node, childPath);
	}
}
