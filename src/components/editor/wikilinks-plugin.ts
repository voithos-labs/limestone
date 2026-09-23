import {
	definePlugin,
	declarePluginInlineKind,
	registerInlineSyntax,
	registerInlineWidgetKind,
	INLINE_PRIORITIES
} from '@voithos-labs/aragonite/plugin';
import type { EditorPlugin, InlineNode } from '@voithos-labs/aragonite/plugin';
import WikiLink from './WikiLink.svelte';
import BodyTag from './BodyTag.svelte';
import { LINK_OPEN, recognizeTag, recognizeWikiLink } from './wikilinks-scan';

export const WIKILINK_KIND = 'limestone-wikilink';
export const BODY_TAG_KIND = 'limestone-tag';

export interface ActivateDetail {
	kind: 'wikilink' | 'tag';
	target: string;
	fragment?: string;
}

export const ACTIVATE_EVENT = 'limestone-activate';

export function wikiLinksPlugin(): EditorPlugin {
	return definePlugin({
		name: 'limestone-wikilinks',
		setup() {
			const link = declarePluginInlineKind(WIKILINK_KIND);
			registerInlineSyntax(
				'[',
				(raw, pos, end): InlineNode | null => {
					const span = recognizeWikiLink(raw, pos, end);
					return span ? { kind: link, start: span.start, end: span.end, text: span.inner } : null;
				},
				{ prefix: LINK_OPEN, priority: INLINE_PRIORITIES.prefixOverride }
			);
			registerInlineWidgetKind(link, {
				isWidget: () => true,
				component: WikiLink,
				editing: { revealSource: true, claimsActivationClick: true }
			});

			const tag = declarePluginInlineKind(BODY_TAG_KIND);
			registerInlineSyntax('#', (raw, pos, end): InlineNode | null => {
				const span = recognizeTag(raw, pos, end);
				return span ? { kind: tag, start: span.start, end: span.end, text: span.name } : null;
			});
			registerInlineWidgetKind(tag, {
				isWidget: () => true,
				component: BodyTag,
				editing: { revealSource: true, claimsActivationClick: true }
			});
		}
	});
}
