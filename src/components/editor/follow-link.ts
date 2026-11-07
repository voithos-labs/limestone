/**
 * what happens when you click a link, tag or citation in a document.
 *
 * A wikilink opens its note (making it if nothing has that name), a tag opens its view, and a
 * citation opens its pdf at the annotation, in the same tab, a new one, or the pane beside. Notes
 * and pdf comments both use it.
 */

import type { Attachment } from 'svelte/attachments';
import Doc, { type AnyDoc } from '#lib/models/Doc.js';
import MarkdownHandle from '#lib/models/MarkdownHandle.js';
import View from '#lib/models/View.svelte.js';
import { tagId } from '#lib/models/Tag.js';
import type EditorState from '#lib/models/EditorState.svelte.js';
import { TabState } from '#lib/models/EditorState.svelte.js';
import { resolveWikiLink, targetStem, touchLinkIndex } from '#lib/services/links.svelte.js';
import type { Source } from '#lib/models/Source.js';
import { reportError } from '#lib/overlays.svelte.js';
import { openAtAnnotation } from '#lib/pdf/citation.js';
import { ACTIVATE_EVENT, type ActivateDetail } from './wikilinks';
import { OPEN_ANNOTATION_EVENT, type OpenAnnotationDetail } from './citation-embeds';

/* --------------------- Following clicks in a document --------------------- */

/**
 * Follows what's clicked inside the element it's attached to: a link or tag through `onActivate`,
 * which each kind of document handles its own way, and a citation by opening its PDF at the
 * annotation. The editor is read when a click comes, so a changed one doesn't re-attach.
 */
export function followLinks(
	editor: () => EditorState | undefined,
	onActivate: (detail: ActivateDetail) => void
): Attachment<HTMLElement> {
	return (el) => {
		const activate = (e: Event) => onActivate((e as CustomEvent<ActivateDetail>).detail);
		const openAnnotation = (e: Event) => {
			const ed = editor();
			if (!ed) return;
			openAtAnnotation(ed, (e as CustomEvent<OpenAnnotationDetail>).detail).catch((err) =>
				reportError(err, "The PDF couldn't be opened.")
			);
		};
		el.addEventListener(ACTIVATE_EVENT, activate);
		el.addEventListener(OPEN_ANNOTATION_EVENT, openAnnotation);
		return () => {
			el.removeEventListener(ACTIVATE_EVENT, activate);
			el.removeEventListener(OPEN_ANNOTATION_EVENT, openAnnotation);
		};
	};
}

/* --------------------------- Wikilinks and tags --------------------------- */

/** The document a link was followed from, and where it's shown. */
export interface LinkOrigin {
	editor: EditorState;
	tab: TabState;
	id: string;
	title: string;
	source: Source;
}

export interface FollowOptions {
	heading?: string;
	side?: boolean;
	newTab?: boolean;
}

/** A tab-state key: the heading a note opened from a link scrolls to. */
export const OPEN_AT_HEADING = 'open_at_heading';

/**
 * Opens the note a wikilink names, making it when nothing has that name. Says `'here'` instead
 * when the link names the document it was followed from, which stays where it is.
 */
export async function followWikiLink(
	from: LinkOrigin,
	target: string,
	{ heading, side = false, newTab = false }: FollowOptions = {}
): Promise<'here' | void> {
	const hit = await resolveWikiLink(from.source.id, target);
	if (hit?.id === from.id && !side) return 'here';
	let doc: AnyDoc;
	if (hit) {
		doc = await Doc.load(hit.id);
	} else {
		const slash = target.lastIndexOf('/');
		doc = await MarkdownHandle.createFromTitle(from.source, {
			title: targetStem(target),
			...(slash > 0 ? { dir: target.slice(0, slash) } : {})
		});
		touchLinkIndex();
	}
	const state = heading ? { [OPEN_AT_HEADING]: heading } : {};
	if (side) from.editor.beside().openDetail(TabState.docContent(doc), from.title);
	else if (newTab) from.editor.openDoc(doc, state);
	else from.editor.showDocInTab(from.tab, doc, state);
}

/** Opens a tag's view. */
export async function followTag(
	from: Pick<LinkOrigin, 'editor' | 'tab' | 'title'>,
	slug: string,
	{ side = false, newTab = false }: FollowOptions = {}
): Promise<void> {
	const view = await View.forUnit(tagId(slug), slug);
	if (side) from.editor.beside().openDetail({ type: 'view', view }, from.title);
	else if (newTab) from.editor.openView(view);
	else from.editor.showViewInTab(from.tab, view);
}
