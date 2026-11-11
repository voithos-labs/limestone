/**
 * the editor plugin that turns a citation, `![[X, p3 - words]]`, into a card.
 *
 * It runs while the markdown is parsed, with no index to ask, so it only claims embeds whose target
 * is shaped like an annotation note's title. Every other `![[note]]` is left alone.
 */

import {
	definePlugin,
	declarePluginInlineKind,
	registerInlineSyntax,
	registerInlineWidgetKind,
	INLINE_PRIORITIES,
	type EditorPlugin,
	type InlineNode
} from '@voithos-labs/aragonite/plugin';
import { svelteView } from '@voithos-labs/aragonite/svelte';
import CitationCard from './CitationCard.svelte';
import { isImageTarget, OPEN } from './image-embeds';
import { recognizeWikiLink } from './wikilinks';
import { parseAnnotationTitle } from '#lib/pdf/annotation.js';

/* ------------------- Recognizing and drawing citations -------------------- */

export interface AnnotationEmbed {
	start: number;
	end: number;
	/** The annotation note's title. */
	target: string;
	pdfTitle: string;
	page: number;
}

export const ANNOTATION_EMBED_KIND = 'limestone-annotation-embed';

/** The plugin that draws a citation as a card; the header above says which embeds it claims. */
export function annotationEmbedsPlugin(): EditorPlugin {
	return definePlugin({
		name: 'limestone-annotation-embeds',
		setup() {
			const kind = declarePluginInlineKind(ANNOTATION_EMBED_KIND);
			registerInlineSyntax(
				'!',
				(raw, pos, end): InlineNode | null => {
					const embed = recognizeAnnotationEmbed(raw, pos, end);
					return embed ? { kind, start: embed.start, end: embed.end, text: embed.target } : null;
				},
				// one past the image embeds, which share the prefix and get first look
				{ prefix: OPEN, priority: INLINE_PRIORITIES.prefixOverride + 1 }
			);
			registerInlineWidgetKind(kind, {
				isWidget: () => true,
				view: svelteView(CitationCard),
				frame: true,
				editing: { revealSource: true, claimsActivationClick: true }
			});
		}
	});
}

/**
 * The citation starting at `pos` (the `!`), or null. Pure, so a test can call it directly. Shares
 * the image embeds' rules for where an embed ends and when a `(` makes it a Markdown image.
 */
export function recognizeAnnotationEmbed(
	raw: string,
	pos: number,
	end: number
): AnnotationEmbed | null {
	if (!raw.startsWith(OPEN, pos)) return null;
	const link = recognizeWikiLink(raw, pos + 1, end);
	if (!link) return null;
	if (link.end < end && raw[link.end] === '(') return null;
	const target = link.inner.split('|')[0].trim();
	const title = parseAnnotationTitle(target);
	if (!title || isImageTarget(target)) return null;
	return { start: pos, end: link.end, target, ...title };
}

/* ---------------------- Opening the cited annotation ---------------------- */

export interface OpenAnnotationDetail {
	pdf: string;
	/** The annotation note's document id. */
	id: string;
}

/** Asks the document's editor to open a PDF at one of its annotations. */
export const OPEN_ANNOTATION_EVENT = 'limestone-open-annotation';
