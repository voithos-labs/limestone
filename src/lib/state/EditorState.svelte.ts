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
 *
 * ---
 *
 * okay just thinking about the tab type / class etc. idea and how it can be multiple purpose,
 * i.e. holds tab type, including static?, tab state (scroll pos, cursor pos, zoom, etc.), and serve
 * the basic purpose of interfacing somewhat coherently with the UI. See above todo ^
 *
 * so hm I'm just gonna OOP this bitch java be praised
 *
 */

import DocHandle from '$lib/models/DocHandle';

// ── Focus (used elsewhere) ───────────────────────────────────────────────────────────

export type FocusTarget =
	| { kind: 'document'; id: string }
	| { kind: 'settings' }
	| { kind: 'search' };

// ── Tabs ─────────────────────────────────────────────────────────────────────────────

export interface TabJSON {
	type: string;
	handleId: string;
	state: Record<string, any>;
}

export class TabState {
	type: string; // markdown, views, pdf, etc.
	handle: DocHandle; // todo (views): DocHandle | View, or could do a Handle trait thing
	state: Record<string, any> = $state({}); // props, e.g. scroll pos

	constructor(json: TabJSON, handle: DocHandle) {
		this.type = json.type;
		this.handle = handle;
		this.state = json.state ?? {};
	}

	get id() {
		return this.handle.id;
	}

	toJSON(): TabJSON {
		return {
			type: this.type,
			handleId: this.handle.id,
			state: this.state
		};
	}

	static newTabFromHandle(handle: DocHandle) {
		return new TabState(
			{
				type: 'markdown',
				handleId: handle.id,
				state: {}
			},
			handle
		);
	}

	static async loadFromJSON(json: TabJSON) {
		const handle = await DocHandle.fromID(json.handleId);
		return new TabState(json, handle);
	}
}

// ── Core ─────────────────────────────────────────────────────────────────────────────

export interface EditorJSON {
	tabs: TabJSON[];
	tabAccessOrderById: string[];
	focused?: FocusTarget;
}

/**
 * EditorState Model
 *
 * This is a model designed to work within state.json
 * It tracks your active tabs within a given 'editor' ; for which you may have two (or more?)
 * in split-screen mode
 *
 * `this.tabs` is the editor's ordered tab list
 *
 * tab actions, such as closing a tab or reordering it, are performed by the id of the underlying
 * handle rather than the index of the tab in .tabs
 */
class EditorState {
	tabs: TabState[] = $state([]);
	focused: FocusTarget | null = $state(null);
	private tabAccessOrderById: string[] = $state([]); // reverse accessed order, last = most recent
	onChanged?: () => void;

	constructor(json?: EditorJSON, tabs?: TabState[]) {
		this.focused = json?.focused ?? null;
		if (json?.tabAccessOrderById) this.tabAccessOrderById = json.tabAccessOrderById;
		if (tabs) this.tabs = tabs;
	}

	changed() {
		this.onChanged?.();
	}

	// ── Getters ─────────────────────────────────────────────────────────────────────────

	get focusedDocument(): DocHandle | undefined {
		return this.focusedTab?.handle;
	}

	get focusedTab(): TabState | undefined {
		if (this.focused?.kind !== 'document') return undefined;
		const id = this.focused.id;
		return this.tabs.find((v) => v.id === id);
	}

	isTabFocused(tab: FocusTarget): boolean {
		if (!this.focused || this.focused.kind !== tab.kind) return false;
		if (tab.kind === 'document') {
			return this.focused.kind === 'document' && this.focused.id === tab.id;
		}
		return true;
	}

	// ── Serialization ───────────────────────────────────────────────────────────────────

	static async loadFromJSON(json: EditorJSON): Promise<EditorState> {
		// dedupe by handleId to guard against corrupt state.json
		let seen = new Set<string>();
		let tabs: TabState[] = [];
		for (const tabJson of json.tabs ?? []) {
			if (seen.has(tabJson.handleId)) continue;
			seen.add(tabJson.handleId);
			// lookup handle in db and fill metadata
			try {
				let tab = await TabState.loadFromJSON(tabJson);
				// could group calls or await all at once, should be fast enough though
				// todo: listeners?
				tabs.push(tab);
			} catch (e) {
				console.error(
					`Failed to load tab for handle ${tabJson.handleId} found in editor state json: ${e}`
				);
				continue;
			}
		}

		return new EditorState(json, tabs);
	}

	toJSON(): EditorJSON {
		return {
			tabs: this.tabs.map((t) => t.toJSON()),
			tabAccessOrderById: this.tabAccessOrderById,
			focused: this.focused ?? undefined
		};
	}

	// ── Tab actions ─────────────────────────────────────────────────────────────────────

	focusTab(tab: FocusTarget) {
		if (this.isTabFocused(tab)) return;
		this.focused = tab;
		if (tab.kind === 'document') {
			// update accessed order: filter out id, then append to end to update order
			let accessedOrder = this.tabAccessOrderById.filter((v) => v != tab.id);
			accessedOrder.push(tab.id);
			this.tabAccessOrderById = accessedOrder;
		}
		this.changed();
	}

	openTab(tab: TabState) {
		if (this.tabs.some((d) => d.id === tab.id)) return; // dupe
		this.tabs.push(tab);
		this.changed();
	}

	openDoc(doc: DocHandle) {
		this.openTab(TabState.newTabFromHandle(doc));
	}

	closeTab(id: string) {
		const idx = this.tabs.findIndex((v) => v.id === id);
		if (idx === -1) return;

		this.tabs.splice(idx, 1);
		this.tabAccessOrderById = this.tabAccessOrderById.filter((v) => v != id);

		if (this.focused?.kind === 'document' && this.focused.id === id) {
			let lastAccessedId = this.tabAccessOrderById.at(-1);
			if (lastAccessedId) {
				this.focused = { kind: 'document', id: lastAccessedId };
			} else if (this.tabs.length > 0) {
				this.focused = {
					kind: 'document',
					id: this.tabs[Math.min(idx, this.tabs.length - 1)].id
				};
			} else {
				this.focused = null;
			}
		}
		this.changed();
	}

	moveTab(fromIndex: number, toIndex: number) {
		if (fromIndex === toIndex) return;
		const [tab] = this.tabs.splice(fromIndex, 1);
		this.tabs.splice(toIndex, 0, tab);
		this.changed();
	}

	/**
	 * returns TabState instances in reverse accessed order (last is most recent) within editor
	 *
	 * lazily cleans up previously removed tabs from this.tabAccessOrderById
	 */
	getTabsAccessedOrder(): TabState[] {
		let tabsAccessedOrder: TabState[] = [];
		let missingTabsIndexes: number[] = [];
		for (const [i, id] of this.tabAccessOrderById.entries()) {
			let tabIndex = this.tabs.findIndex((v) => v.id === id);
			if (tabIndex === -1) {
				// queue remove referenced tab from this.tabAccessOrderById (sync)
				missingTabsIndexes.push(i);
			} else {
				tabsAccessedOrder.push(this.tabs[tabIndex]);
			}
		}
		// clean missing tabs
		this.tabAccessOrderById = this.tabAccessOrderById.filter(
			(_, i) => !missingTabsIndexes.includes(i)
		);

		return tabsAccessedOrder;
	}
}

export default EditorState;
