import { toasts } from '#lib/overlays.svelte.js';

/**
 * A citation is an ordinary note embed of the annotation note, so it reads as plain text outside
 * Limestone and Obsidian shows the quote and comment by transclusion.
 */

export function citationEmbed(title: string): string {
	return `![[${title}]]`;
}

export function citationLink(title: string): string {
	return `[[${title}]]`;
}

/** Copies the embed and says so, offering the plain link instead. */
export async function copyCitation(title: string): Promise<void> {
	await navigator.clipboard.writeText(citationEmbed(title));
	toasts.push('Citation copied: paste into any note to embed the quote and comment.', {
		variant: 'info',
		timeout: 6000,
		code: citationEmbed(title),
		action: { label: 'Copy as link instead', run: () => void copyLink(title) }
	});
}

export async function copyLink(title: string): Promise<void> {
	await navigator.clipboard.writeText(citationLink(title));
	toasts.push('Link copied', { variant: 'info' });
}
