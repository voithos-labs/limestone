import { definePlugin, registerInlineSyntax, INLINE_PRIORITIES } from 'aragonite/plugin';
import type { EditorPlugin, ImageFields, InlineNode } from 'aragonite/plugin';
import { OPEN, recognizeWikiImageEmbed } from './wiki-image-embeds-scan';

/**
 * Obsidian-style `![[cat.png]]` image embeds, the format limestone's notes use and its image
 * paste writes. An embed becomes a built-in `image` node so it is an image to the whole editor,
 * not merely to the eye. Two consequences: the rung is priced below the built-in boundary, so
 * the recognizer must decline the grammars' overlap itself (`wiki-image-embeds-scan.ts`); and
 * every write path re-serializes in the built-in grammar, so `rewriteImage` owns the way back.
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
 * Writes an edited embed back in its own syntax, declining with `null` any field the grammar
 * (a target and an optional width) cannot hold. Declining suppresses the commit visibly;
 * ignoring the field would return unchanged bytes, which the commit's equality guard drops
 * with no diagnostic at all.
 */
function rewriteWikiImageEmbed(source: string, fields: ImageFields): string | null {
	// The claim reaches the node's descendants too, so bytes this rung never shaped can arrive
	// here; rewriting those would nest the syntax inside itself.
	if (!source.startsWith(OPEN)) return null;
	if (fields.title !== undefined || fields.label !== undefined) return null;
	// The recognizer fills alt from the target, so an embed's alt shadows it rather than being
	// stored: it reads as the new target, or as the old one mid-retarget. Both re-derive;
	// anything else is alt text with nowhere to go.
	const target = recognizeWikiImageEmbed(source, 0, source.length)?.target;
	if (fields.alt !== fields.url && fields.alt !== target) return null;
	// A height is dropped rather than declined: the grammar has one dimension slot, and keeping
	// the width a reader dragged to serves them better than refusing the drag.
	return `${OPEN}${fields.url}${fields.width !== undefined ? `|${fields.width}` : ''}]]`;
}
