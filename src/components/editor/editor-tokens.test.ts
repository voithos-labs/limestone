/**
 * Guards editor-tokens.css, the file that points aragonite's editor variables at limestone's
 * theme. Aragonite ships those variables in two tiers: host-contract names a themed app already
 * declares, which reach the editor on their own, and editor-owned names that still need a line in
 * the bridge. Every variable aragonite declares has to sit on one of the three lists below, every
 * name on a list has to still exist in aragonite, and the tiers have to be the ones assumed here.
 */

import { describe, expect, it } from 'vitest';
import aragoniteTheme from '@voithos-labs/aragonite/styles/editor-theme.css?raw';
import bridge from './editor-tokens.css?raw';
import appCss from '../../app.css?raw';
import themeService from '../../lib/services/theme.svelte.ts?raw';

/** Host-contract variables limestone declares itself, so they reach the editor with no bridge. */
const HOST_NATIVE = new Set([
	// same stack on both sides since the extraction; flows through now
	'--font-editor',
	// Declared on the editor wrapper by DocumentEditor, from the reader's zoom.
	'--editor-font-size',
	'--color-surface',
	'--color-text-secondary',
	'--color-text-primary',
	'--color-border',
	'--color-ui-muted',
	'--color-ui-dulled',
	'--color-accent',
	'--color-error',
	'--color-selection',
	'--radius-ui',
	'--radius-surface'
]);

/** Editor-owned variables limestone has no equivalent for, so they keep aragonite's values. */
const LEFT_TO_ARAGONITE = new Set([
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
	// Editor furniture the app never styles. The selection, search and reorder washes are here
	// too, but they mix over --color-selection, which limestone's themes declare.
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

// Both tiers name the opt-in class; only the editor-owned one also defaults on `.editor`, which
// is what makes it shadow the app's cascade and need a bridge line.
const hostTier = variablesSetBy(
	aragoniteTheme,
	(s) => s.includes('.aragonite-editor-theme') && !s.includes('.editor')
);
const editorTier = variablesSetBy(aragoniteTheme, (s) => s.includes('.editor'));
const aragoniteTokens = new Set([...hostTier, ...editorTier]);
const bridgedTokens = variablesSetBy(bridge, (s) => s.trim() === '.editor');

describe('the editor theme bridge', () => {
	it('agrees with aragonite on which variables the host owns', () => {
		const fix = 'a variable changed tiers upstream: move it between HOST_NATIVE and the bridge';
		expect([...hostTier].sort(), fix).toEqual([...HOST_NATIVE].sort());
	});

	it('accounts for every variable aragonite declares', () => {
		const unaccounted = [...aragoniteTokens]
			.filter(
				(name) => !bridgedTokens.has(name) && !HOST_NATIVE.has(name) && !LEFT_TO_ARAGONITE.has(name)
			)
			.sort();

		const fix = 'new in aragonite: bridge each in editor-tokens.css or add to LEFT_TO_ARAGONITE';
		expect(unaccounted, fix).toEqual([]);
	});

	it('names only variables aragonite still declares', () => {
		const stale = [...bridgedTokens, ...HOST_NATIVE, ...LEFT_TO_ARAGONITE]
			.filter((name) => !aragoniteTokens.has(name))
			.sort();

		const fix = 'gone from aragonite: drop each from editor-tokens.css or the lists here';
		expect(stale, fix).toEqual([]);
	});

	it('declares every host-contract variable it leaves unbridged', () => {
		const declared = (name: string) =>
			new RegExp(`${name}\\s*:`).test(appCss) || themeService.includes(`'${name.slice(2)}'`);

		const missing = [...HOST_NATIVE]
			.filter((name) => name !== '--editor-font-size')
			.filter((name) => !declared(name))
			.sort();

		const fix = 'declare in app.css or the theme service, or bridge in editor-tokens.css instead';
		expect(missing, fix).toEqual([]);
	});
});
