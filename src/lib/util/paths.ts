const ILLEGAL_CHARS = /[<>:"|?*\\/]|\p{Cc}/u;
const ILLEGAL_CHARS_ALL = new RegExp(ILLEGAL_CHARS.source, 'gu');
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_NAME_BYTES = 255;

function byteLength(s: string): number {
	return new TextEncoder().encode(s).length;
}

export function isValidSegment(name: string): boolean {
	const s = name.trim();
	if (s === '' || s === '.' || s === '..') return false;
	if (s.endsWith('.') || s.endsWith(' ')) return false;
	if (ILLEGAL_CHARS.test(s)) return false;
	if (RESERVED.test(s.split('.')[0])) return false;
	return byteLength(s) <= MAX_NAME_BYTES;
}

export function sanitizeSegment(name: string): string {
	let s = name.replace(ILLEGAL_CHARS_ALL, '-').trim();
	const dot = s.indexOf('.');
	const stem = dot === -1 ? s : s.slice(0, dot);
	if (RESERVED.test(stem)) s = dot === -1 ? `${s}-` : `${stem}-${s.slice(dot)}`;
	while (byteLength(s) > MAX_NAME_BYTES) s = [...s].slice(0, -1).join('');
	while (s.endsWith('.') || s.endsWith(' ')) s = s.slice(0, -1).trimEnd();
	return s;
}
