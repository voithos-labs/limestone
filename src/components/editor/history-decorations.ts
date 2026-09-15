import { isProseKind } from '@voithos-labs/aragonite';
import type { Decoration, DocumentView, NodeView } from '@voithos-labs/aragonite';
import type { StateDelta } from '$lib/services/history';

export const HISTORY_INSERT_CLASS = 'hist-ins';
export const HISTORY_BLOCK_CLASS = 'hist-block';

interface Line {
	src: number;
	local: number;
	len: number;
}

interface Leaf {
	path: number[];
	prose: boolean;
	raw: string;
	lines: Line[];
}

function splitLines(text: string): { start: number; len: number }[] {
	const out: { start: number; len: number }[] = [];
	let i = 0;
	while (i < text.length) {
		const nl = text.indexOf('\n', i);
		const end = nl === -1 ? text.length : nl + 1;
		out.push({ start: i, len: end - i });
		i = end;
	}
	return out;
}

function collectLeaves(doc: DocumentView): Leaf[] {
	const leaves: Leaf[] = [];
	let pos = doc.prefix.length;
	doc.children.forEach((child, i) => {
		pos += child.leadingTrivia.length;
		const start = pos;
		const lines = splitLines(child.raw).map((l) => ({
			src: start + l.start,
			local: l.start,
			len: l.len
		}));
		descend(child, [i], lines, leaves);
		pos += child.raw.length;
	});
	return leaves;
}

function descend(node: NodeView, path: number[], lines: Line[], out: Leaf[]): void {
	const children = node.children;
	if (!children || children.length === 0) {
		out.push({ path, prose: isProseKind(node.kind), raw: node.raw, lines });
		return;
	}
	let concat = '';
	const starts: number[] = [];
	for (const c of children) {
		starts.push(concat.length);
		concat += c.leadingTrivia + c.raw;
	}
	const concatLines = splitLines(concat);
	if (concatLines.length !== lines.length) {
		out.push({ path, prose: false, raw: node.raw, lines });
		return;
	}
	const mapped: Line[] = concatLines.map((cl, j) => ({
		src: lines[j].src + (lines[j].len - cl.len),
		local: cl.start,
		len: cl.len
	}));
	children.forEach((c, k) => {
		const rawStart = starts[k] + c.leadingTrivia.length;
		const rawEnd = rawStart + c.raw.length;
		const childLines = mapped
			.filter((l) => l.local >= rawStart && l.local < rawEnd)
			.map((l) => ({ src: l.src, local: l.local - rawStart, len: l.len }));
		descend(c, [...path, k], childLines, out);
	});
}

function overlap(leaf: Leaf, from: number, to: number): [number, number][] {
	const segs: [number, number][] = [];
	for (const line of leaf.lines) {
		const a = Math.max(from, line.src);
		const b = Math.min(to, line.src + line.len);
		if (a >= b) continue;
		const s = line.local + (a - line.src);
		let e = line.local + (b - line.src);
		if (leaf.raw[e - 1] === '\n') e--;
		if (e <= s) continue;
		const last = segs[segs.length - 1];
		if (last && last[1] === s) last[1] = e;
		else segs.push([s, e]);
	}
	return segs;
}

export function historyDecorations(doc: DocumentView, delta: StateDelta): Decoration[] {
	const leaves = collectLeaves(doc);
	const out: Decoration[] = [];
	const blocks = new Set<string>();
	const markBlock = (leaf: Leaf) => {
		const key = leaf.path.join(',');
		if (blocks.has(key)) return;
		blocks.add(key);
		out.push({ type: 'block', path: leaf.path, class: HISTORY_BLOCK_CLASS });
	};

	for (const ins of delta.inserts) {
		for (const leaf of leaves) {
			const segs = overlap(leaf, ins.from, ins.to);
			if (segs.length === 0) continue;
			if (!leaf.prose) {
				markBlock(leaf);
				continue;
			}
			for (const [start, end] of segs) {
				out.push({ type: 'mark', path: leaf.path, start, end, class: HISTORY_INSERT_CLASS });
			}
		}
	}

	return out;
}
