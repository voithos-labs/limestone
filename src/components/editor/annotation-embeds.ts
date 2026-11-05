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
import AnnotationCard from './AnnotationCard.svelte';
import { isImageTarget, OPEN } from './image-embeds';
import { recognizeWikiLink } from './wikilinks';
import { parseAnnotationTitle } from '#lib/pdf/annotation.js';

/**
 * A citation, `![[Hale & Ortiz 2023, p3 - The rate tracked…]]`, drawn as a card holding the
 * annotation's quote or region and its comment. Recognition runs at parse time with no index to
 * ask, so it claims only targets shaped like an annotation note's title; any other `![[note]]`
 * stays the text it was. A title that turns out to name no annotation draws a quiet placeholder.
 */
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
				view: svelteView(AnnotationCard),
				frame: true,
				editing: { revealSource: true, claimsActivationClick: true }
			});
		}
	});
}

export const ANNOTATION_EMBED_KIND = 'limestone-annotation-embed';

/** Asks the document's editor to open a PDF at one of its annotations. */
export const OPEN_ANNOTATION_EVENT = 'limestone-open-annotation';

export interface OpenAnnotationDetail {
	pdf: string;
	/** The annotation note's document id. */
	id: string;
}

export interface AnnotationEmbed {
	start: number;
	end: number;
	/** The annotation note's title. */
	target: string;
	pdfTitle: string;
	page: number;
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

// ── Internal ────────────────────────────────────────────────────────────────
