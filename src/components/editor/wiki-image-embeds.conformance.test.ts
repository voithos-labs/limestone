// @vitest-environment jsdom
/**
 * Enrollment: the `![[…]]` rung runs aragonite's published inline-conformance battery. The rung
 * is priced below the built-in boundary on a trigger the built-in scanner owns, so the cells
 * that matter here are the overlap decline and the image claim — neither shows up in a byte
 * round-trip, and both are what keeps a note readable in Obsidian.
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
	// `![[cat.png]](u)` is a legal GFM image whose alt is `[cat.png]`, and `![[notes.md]]` is
	// prose the reader wants left alone — the rung runs ahead of both and owes them a decline.
	// The `.png` in the overlap is load-bearing: with a target no extension makes an image,
	// the decline comes from `isImageTarget` and the grammar overlap is never exercised.
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

	// A recorded cell proves nothing: an exemption the kit could falsify, or a fixture that
	// stopped being claimed, would otherwise pass as a quiet non-assertion.
	it('asserts the two cells the rung’s shape owns', () => {
		const cells = runInlineKindConformance(wikiImageEmbedRung).cells;
		const cell = (name: string) => cells.find((c) => c.cell === name)!;
		expect(cell('overlapDecline').status).toBe('asserted');
		expect(cell('imageClaim').status).toBe('asserted');
		expect(cell('imageClaim').detail).toContain('rewriteImage');
	});
});
