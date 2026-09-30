import { parseWikiTarget } from '$lib/wikilinks';

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

export function recognizeTag(raw: string, pos: number, end: number): TagSpan | null {
	if (raw[pos] !== '#') return null;
	const prev = pos > 0 ? raw[pos - 1] : '';
	if (prev !== '' && !/\s/.test(prev) && prev !== '(') return null;
	let i = pos + 1;
	while (i < end && TAG_CHAR.test(raw[i])) i++;
	let name = raw.slice(pos + 1, i);
	while (name.endsWith('/')) name = name.slice(0, -1);
	if (!name || /^\d+$/.test(name)) return null;
	return { start: pos, end: pos + 1 + name.length, name };
}
