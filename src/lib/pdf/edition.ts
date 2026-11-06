import { invoke } from '@tauri-apps/api/core';
import { copyFile, exists, mkdir, remove, rename, stat } from '@tauri-apps/plugin-fs';
import { getSource } from '#lib/models/Source.js';

/**
 * Editions: which bytes an annotation was made on, and a preserved copy of them, so replacing a
 * PDF never repaints old marks onto new pages and the old pages stay readable.
 */

// ── Public API ──────────────────────────────────────────────────────────────

/** Where a source keeps its preserved editions. The scanner skips dot-folders. */
export const EDITIONS_DIR = '.limestone/editions';

export function editionPath(edition: string): string {
	return `${EDITIONS_DIR}/${edition}.pdf`;
}

/** Whether a source keeps a copy of an edition's bytes. */
export function isPreserved(sourcePath: string, edition: string): Promise<boolean> {
	return exists(`${sourcePath}/${editionPath(edition)}`);
}

/**
 * The edition a PDF file is: a short digest of its bytes, so any change to them is a new
 * edition. Hashed in the backend, which streams the file, and asked again only once the file's
 * size or modified time changes.
 */
export async function editionOf(pdf: {
	sourceId: string;
	sourcePath: string;
	relPath: string;
}): Promise<string> {
	const { size, mtime } = await stat(`${pdf.sourcePath}/${pdf.relPath}`);
	const key = `${pdf.sourceId}/${pdf.relPath}:${size}:${mtime?.getTime()}`;
	let digest = digests.get(key);
	if (!digest) {
		digest = invoke<string>('file_digest', { sourceId: pdf.sourceId, relPath: pdf.relPath });
		digests.set(key, digest);
		digest.catch(() => digests.delete(key));
	}
	return (await digest).slice(0, EDITION_ID_LENGTH);
}

/**
 * Copies the PDF into the source's editions folder unless that edition is already there. The copy
 * lands under a temporary name and is renamed into place, so an interrupted copy never passes for
 * a preserved edition.
 */
export async function preserveEdition(
	pdf: { sourcePath: string; relPath: string },
	edition: string
): Promise<void> {
	if (await isPreserved(pdf.sourcePath, edition)) return;
	const target = `${pdf.sourcePath}/${editionPath(edition)}`;
	await mkdir(`${pdf.sourcePath}/${EDITIONS_DIR}`, { recursive: true });
	const partial = `${target}.partial`;
	await copyFile(`${pdf.sourcePath}/${pdf.relPath}`, partial);
	await rename(partial, target);
}

/** The size of an edition's preserved copy in bytes, or null when there's none. */
export async function editionSize(sourcePath: string, edition: string): Promise<number | null> {
	try {
		return (await stat(`${sourcePath}/${editionPath(edition)}`)).size;
	} catch {
		return null;
	}
}

/** Deletes an edition's preserved copy; its marks can no longer be shown on the old pages. */
export function discardEdition(sourcePath: string, edition: string): Promise<void> {
	return remove(`${sourcePath}/${editionPath(edition)}`);
}

/**
 * The day an edition dates from, as "Oct 2" (with the year when it isn't this one), taken from
 * its preserved copy's modified time. Null when that can't be read.
 */
export async function editionDate(sourceId: string, edition: string): Promise<string | null> {
	const key = `${sourceId}/${edition}`;
	const known = dates.get(key);
	if (known) return known;
	try {
		const source = await getSource(sourceId);
		const { mtime } = await stat(`${source.path}/${editionPath(edition)}`);
		if (!mtime) return null;
		const year = mtime.getFullYear() === new Date().getFullYear() ? undefined : 'numeric';
		const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year });
		const date = day.format(mtime);
		dates.set(key, date);
		return date;
	} catch {
		return null;
	}
}

// ── Internal ────────────────────────────────────────────────────────────────

// an edition's bytes never change, so neither does its date; a failed read is asked again
const dates = new Map<string, string>();

// 64 bits of the digest: enough that two editions of one PDF never share an id
const EDITION_ID_LENGTH = 16;
const digests = new Map<string, Promise<string>>();
