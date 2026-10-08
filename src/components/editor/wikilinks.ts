import {
	definePlugin,
	declarePluginInlineKind,
	registerInlineSyntax,
	registerInlineWidgetKind,
	INLINE_PRIORITIES,
	type EditorPlugin,
	type InlineNode
} from '@voithos-labs/aragonite/plugin';
import WikiLink from './WikiLink.svelte';
import BodyTag from './BodyTag.svelte';
import { parseWikiTarget } from '#lib/services/links.svelte.js';

export const WIKILINK_KIND = 'limestone-wikilink';
export const BODY_TAG_KIND = 'limestone-tag';

export interface ActivateDetail {
	kind: 'wikilink' | 'tag';
	target: string;
	fragment?: string;
	side?: boolean;
	/** Ctrl/Cmd-click: open in a new tab rather than this one. */
	newTab?: boolean;
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
			// A plain click follows the link, as on a web page; the caret arrowing in shows its source
			registerInlineWidgetKind(link, {
				isWidget: () => true,
				component: WikiLink,
				editing: { revealSource: true, claimsActivationClick: true, plainClickActivates: true }
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

export const LINK_OPEN = '[[';
const LINK_CLOSE = ']]';

export interface WikiLinkSpan {
	start: number;
	end: number;
	inner: string;
}

export interface TagSpan {
	start: number;
	end: number;
	name: string;
}

export function recognizeWikiLink(raw: string, pos: number, end: number): WikiLinkSpan | null {
	if (!raw.startsWith(LINK_OPEN, pos)) return null;
	const innerStart = pos + LINK_OPEN.length;
	for (let i = innerStart; i < end; i++) {
		const ch = raw[i];
		if (ch === '\n' || ch === '[') return null;
		if (ch === ']') {
			if (i + 1 >= end || raw[i + 1] !== ']') return null;
			const inner = raw.slice(innerStart, i);
			const target = inner.split('|')[0].split('#')[0].trim();
			if (!target && !inner.includes('#')) return null;
			return { start: pos, end: i + LINK_CLOSE.length, inner };
		}
	}
	return null;
}

// The link as text, or null if recognizeWikiLink would read it back as a different link (a name
// holding # or |, say), so nothing written from here can come back wrong.
export function writeWikiLink(target: string, fragment?: string): string | null {
	const text = `${LINK_OPEN}${target}${fragment ? `#${fragment}` : ''}${LINK_CLOSE}`;
	const span = recognizeWikiLink(text, 0, text.length);
	if (span?.end !== text.length) return null;
	const back = parseWikiTarget(span.inner);
	const same = back.target === target && back.fragment === fragment && !back.alias;
	return same ? text : null;
}

const TAG_CHAR = /[\p{L}\p{N}_\-/]/u;

// A # opens a tag at the start of a block, after whitespace or after (, never mid-word (C#)
export function isTagOpening(raw: string, pos: number): boolean {
	const prev = pos > 0 ? raw[pos - 1] : '';
	return prev === '' || /\s/.test(prev) || prev === '(';
}

// Whether what follows a # could still be a tag name, the empty name included
export function isTagQuery(query: string): boolean {
	return [...query].every((ch) => TAG_CHAR.test(ch));
}

export function recognizeTag(raw: string, pos: number, end: number): TagSpan | null {
	if (raw[pos] !== '#' || !isTagOpening(raw, pos)) return null;
	let i = pos + 1;
	while (i < end && TAG_CHAR.test(raw[i])) i++;
	let name = raw.slice(pos + 1, i);
	while (name.endsWith('/')) name = name.slice(0, -1);
	if (!name || /^\d+$/.test(name)) return null;
	return { start: pos, end: pos + 1 + name.length, name };
}
