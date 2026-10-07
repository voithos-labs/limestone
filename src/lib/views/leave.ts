import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

// How a row or card that stopped matching the view goes: rows and board cards fold up so what's
// below slides in, grid cards fade and shrink a touch. Anything else removed goes at once
export function leave(node: HTMLElement, { mode }: { mode: 'row' | 'card' }): TransitionConfig {
	if (node.dataset.leaving === undefined) return { duration: 0 };
	if (mode === 'card') {
		return {
			duration: 160,
			easing: cubicOut,
			css: (t) => `opacity: ${t}; transform: scale(${0.96 + 0.04 * t});`
		};
	}
	const h = node.offsetHeight;
	const s = getComputedStyle(node);
	const mt = parseFloat(s.marginTop) || 0;
	const mb = parseFloat(s.marginBottom) || 0;
	return {
		duration: 200,
		easing: cubicOut,
		css: (t) =>
			`overflow: hidden; height: ${t * h}px; min-height: 0; margin-top: ${t * mt}px; ` +
			`margin-bottom: ${t * mb}px; opacity: ${t};`
	};
}
