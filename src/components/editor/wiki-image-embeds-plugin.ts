import { definePlugin, registerInlineSyntax, INLINE_PRIORITIES } from 'aragonite/plugin';
import type { EditorPlugin, ImageFields, InlineNode } from 'aragonite/plugin';
import { OPEN, recognizeWikiImageEmbed } from './wiki-image-embeds-scan';

/**
 * Renders Obsidian-style `![[cat.png]]` image embeds, the format limestone's notes
 * already use and its image paste still writes.
 *
 * An embed becomes a built-in `image` inline node, so it is an image to the whole
 * editor and not merely to the eye: `resolveImageUrl` resolves it, the image widget
 * renders it, and selecting, resizing and deleting it behave as they do for
 * `![alt](url)`. Nothing here resolves URLs — the editor's own prop does that, for
 * embeds and GFM images alike.
 *
 * The `![[` rung is priced below the built-in boundary so it is consulted before the
 * bracket scanner claims the `!`. That is also why the recognizer must decline the
 * grammars' overlap itself; see `wiki-image-embeds-scan.ts`.
 *
 * Minting a built-in kind means owning the way back: every write path re-serializes an
 * image in the built-in grammar, so `rewriteImage` is what keeps a resize from leaving
 * `![cat.png|320](cat.png)` where the author wrote an embed.
 */
export function wikiImageEmbedsPlugin(): EditorPlugin {
	return definePlugin({
		name: 'limestone-wiki-image-embeds',
		setup() {
			registerInlineSyntax('!', wikiImageEmbedNode, {
				prefix: OPEN,
				priority: INLINE_PRIORITIES.prefixOverride,
				rewriteImage: rewriteWikiImageEmbed
			});
		}
	});
}

// ── Internal ────────────────────────────────────────────────────────────────

function wikiImageEmbedNode(raw: string, pos: number, end: number): InlineNode | null {
	const embed = recognizeWikiImageEmbed(raw, pos, end);
	if (!embed) return null;
	return {
		kind: 'image',
		start: embed.start,
		end: embed.end,
		children: [],
		// An embed names its file and nothing else, so the path doubles as the alt text.
		alt: embed.target,
		url: embed.target,
		...(embed.width !== undefined ? { width: embed.width } : {})
	};
}

/**
 * Writes an edited embed back in the syntax it was written in. Returning `null` declines the
 * edit, and the editor suppresses the commit rather than writing bytes this plugin did not
 * author — the honest answer for an edit an embed has nowhere to keep: it holds a target and an
 * optional width, and that is all. Ignoring such a field instead would hand back the bytes
 * unchanged, and unchanged bytes are dropped by the commit's equality guard with no diagnostic
 * at all, so the affordance would fail silently rather than visibly.
 *
 * A height is the one field written rather than declined: the grammar has a single dimension
 * slot, and storing the width a reader dragged to serves them better than refusing the drag.
 */
function rewriteWikiImageEmbed(source: string, fields: ImageFields): string | null {
	// The claim reaches the node's descendants too, so bytes this rung never shaped can arrive
	// here; rewriting those would nest the syntax inside itself.
	if (!source.startsWith(OPEN)) return null;
	if (fields.title !== undefined || fields.label !== undefined) return null;
	// The recognizer fills alt from the target, so an embed's alt is a shadow of it rather than
	// anything the syntax stores. It may read as the new target, or as the old one it is still
	// carrying through a retarget — both re-derive. Anything else is alt text with nowhere to go.
	const target = recognizeWikiImageEmbed(source, 0, source.length)?.target;
	if (fields.alt !== fields.url && fields.alt !== target) return null;
	return `${OPEN}${fields.url}${fields.width !== undefined ? `|${fields.width}` : ''}]]`;
}
