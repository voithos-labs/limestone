import { definePlugin, registerInlineSyntax, INLINE_PRIORITIES } from 'aragonite/plugin';
import type { EditorPlugin, ImageFields, InlineNode } from 'aragonite/plugin';
import { OPEN, recognizeWikiImageEmbed } from './wiki-image-embeds-scan';

/**
 * Obsidian-style `![[cat.png]]` image embeds, the format limestone's notes use and its image
 * paste writes. An embed parses into aragonite's ordinary `image` node, so the editor treats it
 * as a real image everywhere, not just visually. Two consequences: this gets first look at `!`,
 * ahead of aragonite's own image parser, so it must bow out where the two syntaxes overlap (see
 * wiki-image-embeds-scan.ts), and every edit comes back in aragonite's image shape, so
 * `rewriteImage` is what puts the `![[…]]` back.
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
 * Writes an edited embed back as `![[…]]`, returning null for anything the syntax cannot hold
 * (it has room for a path and a width, nothing else). Null makes the editor reject the edit
 * visibly; quietly ignoring the field would hand back the same text, and the edit would vanish
 * with no explanation at all.
 */
function rewriteWikiImageEmbed(source: string, fields: ImageFields): string | null {
	// This is also called for text nested inside the node, which this plugin never produced.
	// Rewriting that would nest `![[` inside itself.
	if (!source.startsWith(OPEN)) return null;
	if (fields.title !== undefined || fields.label !== undefined) return null;
	// alt is copied from the path when parsing and never stored, so what comes back here is
	// either the new path or the old one. Anything else is real alt text, with nowhere to put it.
	const target = recognizeWikiImageEmbed(source, 0, source.length)?.target;
	if (fields.alt !== fields.url && fields.alt !== target) return null;
	// Height is dropped rather than refused: the syntax has one size slot, and keeping the width
	// someone just dragged to serves them better than rejecting the drag.
	return `${OPEN}${fields.url}${fields.width !== undefined ? `|${fields.width}` : ''}]]`;
}
