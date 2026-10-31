import type { AnnotationColor } from '#lib/pdf/annotation.js';

/** Each color as an `r g b` triplet, set as `--ann` so a fill, ring or bar can take its own alpha. */
export const ANNOTATION_RGB: Record<AnnotationColor, string> = {
	amber: '238 187 47',
	sage: '98 188 128',
	sky: '73 154 212',
	rose: '214 81 126',
	violet: '141 94 201'
};
