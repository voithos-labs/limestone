/**
 * Guards editor-tokens.css, the file that points aragonite's editor variables at limestone's
 * theme. Aragonite still adds and renames those variables, and a new one lands on aragonite's own
 * color with nothing to show it happened. So every variable aragonite declares has to be either
 * bridged in that file or listed below as one we chose to leave alone, and every name on either
 * list has to still exist in aragonite.
 */

import { describe, expect, it } from 'vitest';
import aragoniteTheme from 'aragonite/styles/editor-theme.css?raw';
import bridge from './editor-tokens.css?raw';

/** Variables limestone has no equivalent for, so they keep aragonite's own light/dark values. */
const LEFT_TO_ARAGONITE = new Set([
	'--font-editor',
	'--color-bg-secondary',
	'--color-bg-elevated',
	'--color-bg-muted',
	'--color-text-muted',
	// Code block highlighting. Limestone has no palette of its own to hand over.
	'--code-tok-keyword',
	'--code-tok-string',
	'--code-tok-number',
	'--code-tok-literal',
	'--code-tok-comment',
	'--code-tok-type',
	'--code-tok-function',
	'--code-tok-variable',
	'--code-tok-operator',
	'--code-tok-punctuation',
	'--code-tok-meta',
	'--code-tok-attr',
	'--code-tok-regexp',
	'--code-tok-symbol',
	'--code-tok-subst',
	'--code-tok-added',
	'--code-tok-removed',
	'--code-tok-heading',
	'--code-tok-link',
	'--code-tok-unknown',
	// Editor furniture the app never styles: selection wash, search hits, link and marker tints,
	// the drag indicator, and the placeholder fill behind not-yet-drawn parts of a long document.
	'--selection-overlay-bg',
	'--search-match-bg',
	'--search-match-active-bg',
	'--md-ref-label-color',
	'--md-link-blocked-color',
	'--md-unresolved-color',
	'--md-unresolved-image-bg',
	'--md-raw-html-color',
	'--md-marker-hover-bg',
	'--md-reorder-indicator',
	'--reorder-scope-bg',
	'--syntax-marker-dim',
	'--vr-spacer-bg'
]);

/** Names of the `--x: y` variables set by the rules whose selector `inScope` accepts. */
function variablesSetBy(css: string, inScope: (selector: string) => boolean): Set<string> {
	const names = new Set<string>();
	const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
	for (const [, selector, body] of withoutComments.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
		if (!inScope(selector)) continue;
		for (const [, name] of body.matchAll(/(--[\w-]+)\s*:/g)) names.add(name);
	}
	return names;
}

const aragoniteTokens = variablesSetBy(aragoniteTheme, (s) =>
	s.includes('.aragonite-editor-theme')
);
const bridgedTokens = variablesSetBy(bridge, (s) => s.trim() === '.editor');

describe('the editor theme bridge', () => {
	// If aragonite moves its variables into some other rule, the two checks below have nothing to
	// compare against and the advice they give would be wrong.
	it('finds aragonite’s theme variables', () => {
		expect(aragoniteTokens.size).toBeGreaterThan(20);
	});

	it('accounts for every variable aragonite declares', () => {
		const unaccounted = [...aragoniteTokens]
			.filter((name) => !bridgedTokens.has(name) && !LEFT_TO_ARAGONITE.has(name))
			.sort();

		const fix = 'new in aragonite: bridge each in editor-tokens.css or add to LEFT_TO_ARAGONITE';
		expect(unaccounted, fix).toEqual([]);
	});

	it('names only variables aragonite still declares', () => {
		const stale = [...bridgedTokens, ...LEFT_TO_ARAGONITE]
			.filter((name) => !aragoniteTokens.has(name))
			.sort();

		const fix = 'gone from aragonite: drop each from editor-tokens.css or LEFT_TO_ARAGONITE';
		expect(stale, fix).toEqual([]);
	});
});
