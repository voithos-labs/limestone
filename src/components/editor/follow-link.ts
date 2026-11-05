import Doc, { type AnyDoc } from '#lib/models/Doc.js';
import MarkdownHandle from '#lib/models/MarkdownHandle.js';
import View from '#lib/models/View.svelte.js';
import { tagId } from '#lib/models/Tag.js';
import type EditorState from '#lib/models/EditorState.svelte.js';
import { TabState } from '#lib/models/EditorState.svelte.js';
import { resolveWikiLink, targetStem, touchLinkIndex } from '#lib/services/links.svelte.js';
import type { Source } from '#lib/models/Source.js';

/** Following a wikilink or tag from a document: into its tab, a new tab, or the pane beside. */

// ── Public API ──────────────────────────────────────────────────────────────

/** A tab-state key: the heading a note opened from a link scrolls to. */
export const OPEN_AT_HEADING = 'open_at_heading';

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
