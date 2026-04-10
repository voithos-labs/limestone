/**
 * todo:
 * - Tab interface would be a nice wrapper so we can put more things in tabs
 * >> this would also allow mapping to components
 *
 * okay just thinking: you open the app and your editor state is restored from your last session,
 * do we just store document_ids in the state json?
 *
 * pros: simple, external-edit simple resolve on launch anyways
 * cons: if your document was deleted by an external edit, how are we showing a stub? Db will
 * have data so fine
 *
 * Okay just ids, but then we need two step construction because async eyawheywam fine
 *
 * ---
 *
 * for the accessed order hmm huh hmm just indexes? Then it needs to change on every opening and
 * closing of a tab, which I suppose it would anyway but that is slightly annoying
 * Index makes sense, which means on opening and closing this.docs (push & pop) we need to ensure
 * the accessed order stays synced... or we could calculate the accessed order on each use,
 * trimming it of missing docs lazily, which may have a better saftey net but only works for ids
 *
 * So maybe a set because all ts sets are OrderedSets? ehhh just use ids
 *
 * ---
 * note: technically `EditorState.activeDocumentId` and `EditorState.docsAccessedOrderById` are not exclusive
 */

import DocHandle from '$lib/models/DocHandle';

// ── Tab ─────────────────────────────────────────────────────────────────────────────

export type Tab = { kind: 'document'; id: string } | { kind: 'settings' } | { kind: 'search' };

export function tabKey(tab: Tab): string {
	return tab.kind === 'document' ? `document:${tab.id}` : tab.kind;
}

export function tabsEqual(a: Tab, b: Tab): boolean {
	return tabKey(a) === tabKey(b);
}

// ── Serialization ───────────────────────────────────────────────────────────────────

export interface EditorJSON {
	documentIds: string[];
	docsAccessOrderById: string[];
	focusedTab?: Tab;
}

/**
 * EditorState Model
 *
 * This is a model designed to work within state.json
 * It tracks your active tabs within a given 'editor' ; for which you may have two (or more?)
 * in split-screen mode
 *
 * `this.docs` acts as the editor's ordered tabs
 *
 * tab actions, such as closing a tab or reordering it, are performed by the id of the DocHandle
 * rather than the index of the tab / doc in .docs
 */
class EditorState {
	docs: DocHandle[] = $state([]); // tabs; order represents order of tabs
	focusedTab: Tab | null = $state(null);
	private docsAccessOrderById: string[] = $state([]); // reverse accessed order, last = most recent

	constructor(json?: EditorJSON, docs?: DocHandle[]) {
		this.focusedTab = json?.focusedTab ?? null;
		if (json?.docsAccessOrderById) this.docsAccessOrderById = json.docsAccessOrderById;
		if (docs) this.docs = docs;
	}

	// ── Getters ─────────────────────────────────────────────────────────────────────────

	get getFocusedDocument(): DocHandle | undefined {
		if (this.focusedTab?.kind !== 'document') return undefined;
		else {
			// @ts-ignore for focusedTab!.id
			return this.docs.find((v) => v.id === this.focusedTab!.id);
		}
	}

	isTabFocused(tab: Tab): boolean {
		if (!this.focusedTab) return false;
		return tabsEqual(this.focusedTab, tab);
	}

	// ── Serialization ───────────────────────────────────────────────────────────────────

	static async loadFromJSON(json: EditorJSON): Promise<EditorState> {
		let docIds: string[] = json.documentIds;
		let docs: DocHandle[] = [];
		for (const id of docIds) {
			// lookup docs in db and fill metadata
			try {
				let doc = await DocHandle.fromID(id);
				// could group calls or await all at once, should be fast enough though
				// todo: listeners?
				docs.push(doc);
			} catch (e) {
				console.error(`Failed to load document with id ${id} found in editor state json: ${e}`);
				continue;
			}
		}

		return new EditorState(json, docs);
	}

	toJSON(): EditorJSON {
		return {
			documentIds: this.docs.map((v) => v.id),
			docsAccessOrderById: this.docsAccessOrderById,
			focusedTab: this.focusedTab ?? undefined
		};
	}

	// ── Util ────────────────────────────────────────────────────────────────────────────

	findDocById(id: string): DocHandle {
		let doc = this.docs.find((v) => v.id === id);
		if (!doc) {
			throw new Error(`Document not found with id: ${id}`);
		}
		return doc;
	}

	/**
	 * Focus a document by its id and get its `DocHandle` instance
	 *
	 * Will error if id is not found in this.docs
	 */
	focusTab(tab: Tab) {
		this.focusedTab = tab;
		if (tab.kind === 'document') {
			// update accessed order: filter out id, then append to end to update order
			let accessedOrder = this.docsAccessOrderById.filter((v) => v != tab.id);
			accessedOrder.push(tab.id);
			this.docsAccessOrderById = accessedOrder;
		}
	}

	/**
	 * returns DocHandle instances in reverse accessed order (last is most recent) within editor
	 *
	 * lazily cleans up prevoiusly removed docs from this.docs
	 */
	getDocsAccessedOrder(): DocHandle[] {
		let docsAccessedOrder: DocHandle[] = [];
		let missingDocsIndexes: number[] = [];
		for (const [i, id] of this.docsAccessOrderById.entries()) {
			let docIndex = this.docs.findIndex((v) => v.id === id);
			if (docIndex === -1) {
				// queue remove referenced doc from this.accessedDocIdOrder (sync)
				missingDocsIndexes.push(i);
			} else {
				docsAccessedOrder.push(this.docs[docIndex]);
			}
		}
		// clean missing docs
		this.docsAccessOrderById = this.docsAccessOrderById.filter(
			(_, i) => !missingDocsIndexes.includes(i)
		);

		return docsAccessedOrder;
	}

	closeDoc(id: string) {
		// error if not found
		this.findDocById(id);

		this.docs.splice(
			this.docs.findIndex((v) => v.id === id),
			1
		);
		this.docsAccessOrderById = this.docsAccessOrderById.filter((v) => v != id);

		if (this.focusedTab?.kind === 'document' && this.focusedTab.id === id) {
			let lastAccessedId = this.docsAccessOrderById.at(-1);
			if (lastAccessedId) {
				this.focusedTab = { kind: 'document', id: lastAccessedId };
			} else if (this.docs.length > 0) {
				this.focusedTab = { kind: 'document', id: this.docs[0].id };
			} else {
				this.focusedTab = null;
			}
		}
	}
	openDoc(doc: DocHandle) {
		this.docs.push(doc);
	}
}

export default EditorState;
