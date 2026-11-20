/**
 * the colors annotations and ink are drawn in, as `r g b` values for css.
 *
 * Plus which color a given annotation wears.
 */

import type { Annotation, AnnotationColor, InkColor } from '#lib/pdf/annotation.js';

/** Each color as an `r g b` triplet, set as `--ann` so a fill, ring or bar can take its own alpha. */
export const ANNOTATION_RGB: Record<AnnotationColor, string> = {
	accent: 'var(--color-accent-rgb)',
	amber: '238 187 47',
	sage: '98 188 128',
	sky: '73 154 212',
	rose: '214 81 126',
	violet: '141 94 201'
};

export const INK_RGB: Record<InkColor, string> = {
	...ANNOTATION_RGB,
	graphite: '58 58 54',
	pink: '208 57 107',
	blue: '48 141 207',
	green: '70 164 102'
};

/** The color an annotation's note and marks wear: its pen for ink, its highlight otherwise. */
export function annotationRgb(a: Pick<Annotation, 'kind' | 'color' | 'strokes'>): string {
	const pen = a.kind === 'ink' ? a.strokes?.[0]?.color : undefined;
	return pen ? INK_RGB[pen] : ANNOTATION_RGB[a.color];
}
