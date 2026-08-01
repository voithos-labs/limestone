/**
 * Which paths limestone treats as images. One rule for both the embed recognizer and the
 * editor's URL resolver: two copies fail silently, an embed one claims and the other leaves
 * unresolved renders as a broken image with no explanation. A target outside the set stays
 * literal text, which is what keeps `![[some-note.md]]` readable.
 */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

/** Whether `target`'s extension names an image. A bare extension is no path to one. */
export function isImageTarget(target: string): boolean {
	const dot = target.lastIndexOf('.');
	if (dot < 1) return false;
	return IMAGE_EXTS.has(target.slice(dot + 1).toLowerCase());
}
