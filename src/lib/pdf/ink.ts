import type { InkStroke, PageRect } from './annotation.js';

/**
 * Ink geometry in page fractions. A page is `1` wide and `aspect` (its height over its width)
 * tall, so distances and stroke widths stay uniform although the fractions are not.
 */

// ── Public API ──────────────────────────────────────────────────────────────

/** A stroke that isn't part of an annotation yet, and the page it's on. */
export interface LooseStroke extends InkStroke {
	page: number;
}

/** Drops the points a stroke doesn't need (Douglas–Peucker), rounded for storage. */
export function simplify(points: number[], aspect: number, tolerance = 0.0012): number[] {
	const n = points.length / 2;
	if (n <= 2) return points.map(round);
	const keep = new Uint8Array(n);
	keep[0] = keep[n - 1] = 1;
	const stack: [number, number][] = [[0, n - 1]];
	while (stack.length) {
		const [a, b] = stack.pop()!;
		let far = -1;
		let farDist = tolerance;
		for (let i = a + 1; i < b; i++) {
			const d = segmentDistance(points, i, a, b, aspect);
			if (d > farDist) {
				far = i;
				farDist = d;
			}
		}
		if (far >= 0) {
			keep[far] = 1;
			stack.push([a, far], [far, b]);
		}
	}
	const out: number[] = [];
	for (let i = 0; i < n; i++) if (keep[i]) out.push(round(points[2 * i]), round(points[2 * i + 1]));
	return out;
}

/** An SVG path through the points, in a viewBox `1` wide and `aspect` tall, smoothed by midpoints. */
export function strokePath(points: number[], aspect: number): string {
	const x = (i: number) => points[2 * i];
	const y = (i: number) => points[2 * i + 1] * aspect;
	const n = points.length / 2;
	if (n === 1) return `M${x(0)} ${y(0)}l0 0`;
	let d = `M${x(0)} ${y(0)}`;
	for (let i = 1; i < n - 1; i++) {
		d += `Q${x(i)} ${y(i)} ${(x(i) + x(i + 1)) / 2} ${(y(i) + y(i + 1)) / 2}`;
	}
	return `${d}L${x(n - 1)} ${y(n - 1)}`;
}

/** Whether most of a stroke's points fall inside a lasso drawn as a flat point list. */
export function inLasso(stroke: InkStroke, lasso: number[]): boolean {
	const n = stroke.points.length / 2;
	let inside = 0;
	for (let i = 0; i < n; i++) {
		if (pointInPolygon(stroke.points[2 * i], stroke.points[2 * i + 1], lasso)) inside++;
	}
	return inside / n >= 0.6;
}

/** Whether a stroke passes within `radius` (a fraction of the page's width) of a point. */
export function nearStroke(
	stroke: InkStroke,
	x: number,
	y: number,
	radius: number,
	aspect: number
): boolean {
	const p = stroke.points;
	const n = p.length / 2;
	if (n === 1) return Math.hypot(p[0] - x, (p[1] - y) * aspect) <= radius;
	for (let i = 0; i < n - 1; i++) {
		if (
			distanceToSegment(x, y, p[2 * i], p[2 * i + 1], p[2 * i + 2], p[2 * i + 3], aspect) <= radius
		)
			return true;
	}
	return false;
}

/** The box around some strokes, as a page rect. */
export function strokesBox(strokes: InkStroke[]): PageRect {
	let x0 = 1,
		y0 = 1,
		x1 = 0,
		y1 = 0;
	for (const s of strokes) {
		for (let i = 0; i < s.points.length; i += 2) {
			x0 = Math.min(x0, s.points[i]);
			x1 = Math.max(x1, s.points[i]);
			y0 = Math.min(y0, s.points[i + 1]);
			y1 = Math.max(y1, s.points[i + 1]);
		}
	}
	return [round(x0), round(y0), round(x1 - x0), round(y1 - y0)];
}

/** The strokes moved so their box's top-left corner lands on a point, as near it as the page allows. */
export function moveStrokes(strokes: InkStroke[], x: number, y: number): InkStroke[] {
	const [bx, by, w, h] = strokesBox(strokes);
	const dx = clamp(x, 0, 1 - w) - bx;
	const dy = clamp(y, 0, 1 - h) - by;
	return strokes.map((s) => ({
		...s,
		points: s.points.map((v, i) => round(v + (i % 2 ? dy : dx)))
	}));
}

// ── Internal ────────────────────────────────────────────────────────────────

function round(n: number): number {
	return Math.round(n * 10000) / 10000;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

function segmentDistance(p: number[], i: number, a: number, b: number, aspect: number): number {
	return distanceToSegment(
		p[2 * i],
		p[2 * i + 1],
		p[2 * a],
		p[2 * a + 1],
		p[2 * b],
		p[2 * b + 1],
		aspect
	);
}

function distanceToSegment(
	px: number,
	py: number,
	ax: number,
	ay: number,
	bx: number,
	by: number,
	aspect: number
): number {
	const [qy, aay, bby] = [py * aspect, ay * aspect, by * aspect];
	const dx = bx - ax;
	const dy = bby - aay;
	const len = dx * dx + dy * dy;
	const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (qy - aay) * dy) / len));
	return Math.hypot(px - (ax + t * dx), qy - (aay + t * dy));
}

function pointInPolygon(x: number, y: number, poly: number[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
		const [xi, yi, xj, yj] = [poly[i], poly[i + 1], poly[j], poly[j + 1]];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}
