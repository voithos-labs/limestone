const ILLEGAL_CHARS = /[<>:"|?*\\/\[\]#^]|\p{Cc}/u;
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

export function segmentProblem(name: string): string | null {
	const s = name.trim();
	if (s === '') return "A name can't be empty.";
	if (s === '.' || s === '..') return 'That name is reserved by your system.';
	if (s.endsWith('.') || s.endsWith(' ')) return "A name can't end with a dot or a space.";
	const bad = [...new Set([...s].filter((c) => ILLEGAL_CHARS.test(c)))];
	if (bad.length) {
		const shown = bad.map((c) => (/\p{Cc}/u.test(c) ? 'control characters' : c)).join(' ');
		return `A name can't contain ${shown}`;
	}
	if (RESERVED.test(s.split('.')[0])) return 'That name is reserved by Windows.';
	if (byteLength(s) > MAX_NAME_BYTES) return 'That name is too long.';
	return null;
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

export type NameKind = 'file' | 'project' | 'tag' | 'ident';

const BLOCKED: Record<NameKind, RegExp> = {
	file: ILLEGAL_CHARS_ALL,
	project: /[<>:"'|?*\\/\[\]#^]|\p{Cc}/gu,
	tag: /[\s#"'\\]|\p{Cc}/gu,
	ident: /["'\\]|\p{Cc}/gu
};

const SHAKE = [0, -4, 4, -3, 3, 0].map((x) => ({ transform: `translateX(${x}px)` }));

export function nameGuard(node: HTMLInputElement, kind: NameKind | null = 'file') {
	function onBeforeInput(e: InputEvent) {
		if (!kind || e.isComposing) return;
		const text = e.data ?? e.dataTransfer?.getData('text/plain');
		if (!text) return;
		const clean = text.replace(BLOCKED[kind], '');
		if (clean === text) return;
		e.preventDefault();
		if (clean) {
			node.setRangeText(clean, node.selectionStart ?? 0, node.selectionEnd ?? 0, 'end');
			node.dispatchEvent(new Event('input', { bubbles: true }));
		}
		node.animate(SHAKE, { duration: 240 });
	}
	node.addEventListener('beforeinput', onBeforeInput);
	return {
		update(next: NameKind | null = 'file') {
			kind = next;
		},
		destroy() {
			node.removeEventListener('beforeinput', onBeforeInput);
		}
	};
}
