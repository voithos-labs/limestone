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

export type Tab =
	| { kind: 'document'; id: string }
	| { kind: 'settings' }
	| { kind: 'search' };

export function tabKey(tab: Tab): string {
	return tab.kind === 'document' ? `document:${tab.id}` : tab.kind;
}

// ── Serialization ───────────────────────────────────────────────────────────────────

export interface EditorJSON {
	documentIds: string[];
	docsAccessOrderById: string[];
	focusedTabKey?: string;
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
	focusedTabKey: string | null = $state(null);
	private docsAccessOrderById: string[] = $state([]); // reverse accessed order, last = most recent
	onChanged?: () => void;

	constructor(json?: EditorJSON, docs?: DocHandle[]) {
		this.focusedTabKey = json?.focusedTabKey ?? null;
		if (json?.docsAccessOrderById) this.docsAccessOrderById = json.docsAccessOrderById;
		if (docs) this.docs = docs;
	}

	changed() {
		this.onChanged?.();
	}

	// ── Getters ─────────────────────────────────────────────────────────────────────────

	get focusedDocument(): DocHandle | undefined {
		if (!this.focusedTabKey?.startsWith('document:')) return undefined;
		const id = this.focusedTabKey.slice('document:'.length);
		return this.docs.find((v) => v.id === id);
	}

	isTabFocused(tab: Tab): boolean {
		return this.focusedTabKey === tabKey(tab);
	}

	// ── Serialization ───────────────────────────────────────────────────────────────────

	static async loadFromJSON(json: EditorJSON): Promise<EditorState> {
		let docIds: string[] = [...new Set(json.documentIds)];
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
			focusedTabKey: this.focusedTabKey ?? undefined
		};
	}

	// ── Tab actions ─────────────────────────────────────────────────────────────────────

	focusTab(tab: Tab) {
		const key = tabKey(tab);
		if (this.focusedTabKey === key) return;
		this.focusedTabKey = key;
		if (tab.kind === 'document') {
			// update accessed order: filter out id, then append to end to update order
			let accessedOrder = this.docsAccessOrderById.filter((v) => v != tab.id);
			accessedOrder.push(tab.id);
			this.docsAccessOrderById = accessedOrder;
		}
		this.changed();
	}

	openDoc(doc: DocHandle) {
		if (this.docs.some(d => d.id === doc.id)) return;
		this.docs.push(doc);
		this.changed();
	}

	closeDoc(id: string) {
		const idx = this.docs.findIndex((v) => v.id === id);
		if (idx === -1) return;

		this.docs.splice(idx, 1);
		this.docsAccessOrderById = this.docsAccessOrderById.filter((v) => v != id);

		if (this.focusedTabKey === `document:${id}`) {
			let lastAccessedId = this.docsAccessOrderById.at(-1);
			if (lastAccessedId) {
				this.focusedTabKey = `document:${lastAccessedId}`;
			} else if (this.docs.length > 0) {
				this.focusedTabKey = `document:${this.docs[Math.min(idx, this.docs.length - 1)].id}`;
			} else {
				this.focusedTabKey = null;
			}
		}
		this.changed();
	}

	moveDoc(fromIndex: number, toIndex: number) {
		if (fromIndex === toIndex) return;
		const [doc] = this.docs.splice(fromIndex, 1);
		this.docs.splice(toIndex, 0, doc);
		this.changed();
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
}

export default EditorState;
