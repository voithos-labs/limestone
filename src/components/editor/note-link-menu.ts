/**
 * The [[ menu: notes in this vault by title, and after [[Note# that note's headings (a bare [[#
 * lists this note's own). A pick writes the link through writeWikiLink, so what lands always
 * reads back as the same wikilink.
 */

import type { InlineMenuItem, InlineMenuSource } from '@voithos-labs/aragonite';
import { readTextFile } from '@tauri-apps/plugin-fs';
import DocHandle from '$lib/models/DocHandle';
import { linkTargets, resolveWikiLink } from '$lib/services/links.svelte';
import { searchTitles } from '$lib/services/search';
import { noteHeadings } from './note-headings';
import { LINK_OPEN, writeWikiLink } from './wikilinks-scan';

export const NOTE_LINK_MENU = 'limestone-note-links';

const MAX_ROWS = 20;

export interface NoteLinkMenuDeps {
	/** The vault the open note lives in, or null while none is loaded. */
	vault(): { id: string; path: string } | null;
	/** The open note, left out of the list since opening it put it top of the recents. */
	currentId(): string | null;
	/** The open note's text as it stands in the editor. */
	currentText(): string;
}

export function noteLinkMenu(deps: NoteLinkMenuDeps): InlineMenuSource {
	return {
		name: NOTE_LINK_MENU,
		trigger: LINK_OPEN,
		// ![[ is an image embed, not a link to a note
		opensAt: (raw, pos) => raw[pos - 1] !== '!',
		// ] is the link closed by hand and | starts an alias; [ is a byte no link can hold
		accepts: (query) => !/[[\]|\n]/.test(query),
		items: async ({ query, signal }) => {
			const vault = deps.vault();
			if (!vault) return [];
			const hash = query.indexOf('#');
			const rows =
				hash < 0
					? await noteRows(vault.id, deps.currentId(), query)
					: await headingRows(vault, deps, query.slice(0, hash), query.slice(hash + 1));
			return signal.aborted ? [] : rows;
		}
	};
}

// ── Notes ───────────────────────────────────────────────────────────────────────────

async function noteRows(
	vaultId: string,
	currentId: string | null,
	query: string
): Promise<InlineMenuItem[]> {
	const found = await searchTitles(query, { sql: 'd.source_id = ?', params: [vaultId] });
	const docs = found
		.filter((r) => r.id !== currentId)
		.slice(0, MAX_ROWS)
		.flatMap((r) => (r.rel_path ? [{ id: r.id, rel_path: r.rel_path, title: r.title }] : []));
	const targets = await linkTargets(vaultId, docs);
	return docs.flatMap((doc) => {
		const target = targets.get(doc.id);
		// a name holding # or | can't be written as a link at all, so it isn't offered
		const insert = target ? writeWikiLink(target) : null;
		if (!insert) return [];
		const slash = doc.rel_path.lastIndexOf('/');
		const folder = slash > 0 ? doc.rel_path.slice(0, slash) : undefined;
		return [{ id: doc.id, label: doc.title, detail: folder, icon: 'link' as const, insert }];
	});
}

// ── Headings ────────────────────────────────────────────────────────────────────────

async function headingRows(
	vault: { id: string; path: string },
	deps: NoteLinkMenuDeps,
	notePart: string,
	headingQuery: string
): Promise<InlineMenuItem[]> {
	const note = notePart.trim();
	const found = note ? await otherNote(vault, note) : { target: '', text: deps.currentText() };
	if (!found) return [];
	const wanted = headingQuery.trim().toLowerCase();
	const seen = new Set<string>();
	const rows: InlineMenuItem[] = [];
	for (const heading of noteHeadings(found.text)) {
		if (seen.has(heading.text) || !heading.text.toLowerCase().includes(wanted)) continue;
		const insert = writeWikiLink(found.target, heading.text);
		if (!insert) continue;
		seen.add(heading.text);
		rows.push({
			id: heading.text,
			label: heading.text,
			detail: `H${heading.level}`,
			icon: 'heading',
			insert
		});
		if (rows.length === MAX_ROWS) break;
	}
	return rows;
}

// The note the link part names, found the way a click on the finished link would find it
async function otherNote(
	vault: { id: string; path: string },
	note: string
): Promise<{ target: string; text: string } | null> {
	const hit = await resolveWikiLink(vault.id, note);
	if (!hit) return null;
	try {
		const raw = await readTextFile(`${vault.path}/${hit.rel_path}`);
		const target = (await linkTargets(vault.id, [hit])).get(hit.id) ?? note;
		return { target, text: DocHandle.stripFence(raw) };
	} catch {
		return null;
	}
}
