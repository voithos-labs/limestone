// @vitest-environment jsdom
/**
 * Runs the `![[…]]` syntax through aragonite's published tests for plugin-added inline syntax.
 * This plugin gets first look at `!`, which aragonite's own image parser also owns, so the checks
 * that matter are that it bows out on the overlap and that it really produces an image. Neither
 * shows up in a plain save-and-reload check, and both are what keeps a note readable in Obsidian.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins } from 'aragonite';
import { INLINE_PRIORITIES } from 'aragonite/plugin';
import { resetPluginPlatformForTests, runInlineKindConformance } from 'aragonite/testing';
import type { InlineConformanceProfile } from 'aragonite/testing';
import { wikiImageEmbedsPlugin } from './wiki-image-embeds-plugin';
import { OPEN } from './wiki-image-embeds-scan';

const MINTS_ONLY_A_BUILT_IN =
	'the rung mints the built-in `image` kind over its own bytes and declares no kind of its ' +
	'own, so the widget and its editing policy are the editor’s image widget, not the plugin’s';

const wikiImageEmbedRung: InlineConformanceProfile = {
	trigger: '!',
	prefix: OPEN,
	priority: INLINE_PRIORITIES.prefixOverride,
	fixtures: ['![[cat.png]]', '![[cat.png|300]]', 'Look ![[cat.png]] here.'],
	// `![[cat.png]](u)` is a valid Markdown image whose alt text is `[cat.png]`, and
	// `![[notes.md]]` is prose to leave alone. This plugin sees both first and has to bow out of
	// each. Keep the `.png` in the overlap case: with a name that isn't an image, isImageTarget
	// declines first and the clash between the two syntaxes is never actually tested.
	overlapFixtures: ['![[cat.png]](u)', '![[a]](u)', '![[notes.md]]', 'see ![[cat.png]](u) here'],
	overlapDecline: { mode: 'assert' },
	widget: { mode: 'exempt', reason: MINTS_ONLY_A_BUILT_IN },
	editingPolicy: { mode: 'exempt', reason: MINTS_ONLY_A_BUILT_IN },
	imageClaim: { mode: 'assert' }
};

describe('the `![[…]]` rung passes aragonite’s inline conformance kit', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([wikiImageEmbedsPlugin()]);
	});

	it('runs every cell the kit defines', () => {
		const report = runInlineKindConformance(wikiImageEmbedRung);
		expect(report.cells.map((c) => c.cell)).toEqual([
			'claims',
			'roundTrip',
			'overlapDecline',
			'widget',
			'editingPolicy',
			'imageClaim',
			'registration'
		]);
	});

	// A check that merely ran proves nothing: an exemption that should have failed, or a fixture
	// the plugin stopped claiming, would otherwise slip through as a silent pass.
	it('asserts the two cells the rung’s shape owns', () => {
		const cells = runInlineKindConformance(wikiImageEmbedRung).cells;
		const cell = (name: string) => cells.find((c) => c.cell === name)!;
		expect(cell('overlapDecline').status).toBe('asserted');
		expect(cell('imageClaim').status).toBe('asserted');
		expect(cell('imageClaim').detail).toContain('rewriteImage');
	});
});
