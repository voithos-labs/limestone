import { definePlugin, registerInlineSyntax, INLINE_PRIORITIES } from 'aragonite/plugin';
import type { EditorPlugin, InlineNode } from 'aragonite/plugin';
import { recognizeWikiImageEmbed } from './wiki-image-embeds-scan';

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
 */
export function wikiImageEmbedsPlugin(): EditorPlugin {
	return definePlugin({
		name: 'limestone-wiki-image-embeds',
		setup() {
			registerInlineSyntax('!', wikiImageEmbedNode, {
				prefix: '![[',
				priority: INLINE_PRIORITIES.prefixOverride
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
