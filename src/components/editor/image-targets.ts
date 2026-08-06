/**
 * Which paths limestone treats as images. Shared by the embed recognizer and the URL resolver on
 * purpose: if the two lists drifted, an embed one accepted and the other did not would render as
 * a broken image with no explanation. Anything outside this set stays plain text, which is what
 * keeps `![[some-note.md]]` readable.
 */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

/** Whether `target`'s extension is an image one. A bare `.png` with no name is not a path. */
export function isImageTarget(target: string): boolean {
	const dot = target.lastIndexOf('.');
	if (dot < 1) return false;
	return IMAGE_EXTS.has(target.slice(dot + 1).toLowerCase());
}
