/** Owns which of aragonite's presentation modes limestone offers, and what a stored one reads as. */

import type { PresentationMode } from '@voithos-labs/aragonite';

export const MODES: readonly { value: PresentationMode; label: string }[] = [
	{ value: 'source', label: 'Source' },
	{ value: 'live', label: 'Live' },
	{ value: 'reading', label: 'Reading' }
];

/** aragonite's preview rungs stay unoffered here. */
function isOfferedMode(value: unknown): value is PresentationMode {
	return MODES.some((m) => m.value === value);
}

/** Documents saved before the swap remember the old middle mode; it reads as the new one. */
export function normalizeMode(value: unknown): PresentationMode | undefined {
	const v = value === 'preview-inline' ? 'live' : value;
	return isOfferedMode(v) ? v : undefined;
}
