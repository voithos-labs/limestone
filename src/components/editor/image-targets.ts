/**
 * Which paths limestone treats as images. Two decisions read this one rule: the embed
 * recognizer, deciding whether `![[x.ext]]` becomes an image node at all, and the editor's
 * resolver, deciding whether a target is rebased onto the source's asset folder. Kept in one
 * place because the failure mode of two copies is silent — an embed the recognizer claims and
 * the resolver then leaves unresolved renders as a broken image with no explanation.
 *
 * The set is the one the previous editor embedded; a target outside it stays literal text,
 * which is what keeps `![[some-note.md]]` — an Obsidian note link — readable.
 */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

/** Whether `target`'s extension names an image. A bare extension is no path to one. */
export function isImageTarget(target: string): boolean {
	const dot = target.lastIndexOf('.');
	if (dot < 1) return false;
	return IMAGE_EXTS.has(target.slice(dot + 1).toLowerCase());
}
