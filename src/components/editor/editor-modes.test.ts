import { describe, expect, it } from 'vitest';
import { MODES, normalizeMode } from './editor-modes';

describe('the offered editor modes', () => {
	it('offers source, live and reading, in that order', () => {
		expect(MODES.map((m) => m.value)).toEqual(['source', 'live', 'reading']);
	});

	it('reads the old middle mode as the new one', () => {
		expect(normalizeMode('preview-inline')).toBe('live');
	});

	it('passes an offered mode through unchanged', () => {
		expect(normalizeMode('live')).toBe('live');
		expect(normalizeMode('reading')).toBe('reading');
	});

	// Falling back beats showing the settings page a mode it has no button for.
	it('has no answer for a mode it does not offer, or for a non-mode', () => {
		expect(normalizeMode('preview-block')).toBeUndefined();
		expect(normalizeMode(undefined)).toBeUndefined();
		expect(normalizeMode(7)).toBeUndefined();
	});
});
