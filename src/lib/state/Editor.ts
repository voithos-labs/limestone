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
 * note: technically `Editor.activeDocumentId` and `Editor.docsAccessedOrderById` are not exclusive
 */

import DocHandle from '$lib/models/DocHandle';

export interface EditorJSON {
	documentIds: string[];
	activeDocumentId: string;
}

/**
 * Editor Model
 *
 * This is a model designed to work within the state / workspace json
 * It tracks your active tabs within a given 'editor' ; for which you may have two (or more?)
 * in split-screen mode
 *
 * `this.docs` acts as the editor's ordered tabs
 *
 * tab actions, such as closing a tab or reordering it, are performed by the id of the DocHandle
 * rather than the index
 */
class Editor {
	readonly docs: DocHandle[] = []; // tabs; order represents order of tabs
	private _activeDocumentId: string;
	private docsAccessedOrderById: string[] = []; // reverse accessed order, last = most recent

	constructor(json: EditorJSON, docs: DocHandle[]) {
		this._activeDocumentId = json.activeDocumentId;
		this.docs = docs;
	}

	// ── Getters ─────────────────────────────────────────────────────────────────────────

	get activeDocumentId() {
		return this._activeDocumentId;
	}

	// ── Serialization ───────────────────────────────────────────────────────────────────

	static async loadFromJSON(json: EditorJSON) {
		let docIds: string[] = json.documentIds;
		let docs: DocHandle[] = [];
		for (const id of docIds) {
			// lookup docs in db and fill metadata
			try {
				let doc = await DocHandle.fromID(id);
				// could group calls or await all at once, should be fast enough though
				docs.push(doc);
			} catch (e) {
				console.error(`Failed to load document with id ${id} found in editor state json: ${e}`);
				continue;
			}
		}

		return new Editor(json, docs);
	}

	toJSON() {
		return {
			// todo
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
	focusDoc(id: string): DocHandle {
		// will error if doc id not found
		let doc: DocHandle = this.findDocById(id);

		// update accessed order: filter out id, then append to end to update order
		let accessedOrder = this.docsAccessedOrderById.filter((v) => v != id);
		accessedOrder.push(id);
		this.docsAccessedOrderById = accessedOrder;

		// update active document
		this._activeDocumentId = id;

		return doc;
	}

	/**
	 * returns DocHandle instances in reverse accessed order (last is most recent) within editor
	 *
	 * lazily cleans up prevoiusly removed docs from this.docs
	 */
	getDocsAccessedOrder(): DocHandle[] {
		let docsAccessedOrder: DocHandle[] = [];
		let missingDocsIndexes: number[] = [];
		for (const [i, id] of this.docsAccessedOrderById.entries()) {
			let docIndex = this.docs.findIndex((v) => v.id == id);
			if (docIndex == -1) {
				// queue remove referenced doc from this.accessedDocIdOrder (sync)
				missingDocsIndexes.push(docIndex);
			} else {
				docsAccessedOrder.push(this.docs[docIndex]);
			}
		}
		// clean missing docs
		missingDocsIndexes.forEach((i) => this.docsAccessedOrderById.splice(i, 1));

		return docsAccessedOrder;
	}

	closeDoc(id: string) {
		this.docs.splice(this.docs.findIndex((v) => v.id == id, 1));
	}

	openDoc(doc: DocHandle) {
		this.docs.push(doc);
	}
}

export default Editor;
