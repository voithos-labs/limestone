/**
 * todo:
 * - [x] Tab interface would be a nice wrapper so we can put more things in tabs
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

import { v4 as uuidv4 } from 'uuid';
import DocHandle from '#lib/models/DocHandle.js';
import View, { listSavedViewJSON } from '#lib/models/View.svelte.js';
import type Session from '#lib/models/Session.svelte.js';

// ── Focus (used elsewhere) ───────────────────────────────────────────────────────────

export type FocusTarget =
	{ kind: 'tab'; id: string } | { kind: 'settings' } | { kind: 'search' } | { kind: 'preview' };

// ── Tabs ─────────────────────────────────────────────────────────────────────────────

export type TabContent =
	| { type: 'markdown'; handle: DocHandle }
	| { type: 'view'; view: View }
	| { type: 'new'; id: string }
	| { type: 'home'; id: string }
	| { type: 'licenses'; id: string };

// a tab's back stack travels with it, as the same shapes the tab itself serializes
export type TabJSON = TabJSONBase & {
	history?: TabJSONBase[];
	forward?: TabJSONBase[];
	tab_id?: string;
	detail?: string;
};

type Visit = { content: TabContent; state: Record<string, any> };

type TabJSONBase =
	| { type: 'markdown'; handleId: string; state: Record<string, any>; pinned?: boolean }
	| { type: 'view'; view: ReturnType<View['toJSON']>; state: Record<string, any>; pinned?: boolean }
	| { type: 'view-ref'; viewId: string; state: Record<string, any>; pinned?: boolean }
	| { type: 'new'; id: string; state: Record<string, any>; pinned?: boolean }
	| { type: 'home'; id: string; state: Record<string, any>; pinned?: boolean }
	| { type: 'licenses'; id: string; state: Record<string, any>; pinned?: boolean };
// 'view' inlines the full JSON

export class TabState {
	readonly id: string;
	content: TabContent = $state() as TabContent;
	state: Record<string, any> = $state({});
	pinned: boolean = $state(false);
	// places this tab showed before the current one, most recent last; travels in state.json
	history: Visit[] = $state([]);
	forward: Visit[] = $state([]);
	detail: string | null = $state(null);

	constructor(
		content: TabContent,
		state: Record<string, any> = {},
		pinned = false,
		id = TabState.idOf(content)
	) {
		this.id = id;
		this.content = content;
		this.state = state;
		this.pinned = pinned;
	}

	get type(): TabContent['type'] {
		return this.content.type;
	}

	static idOf(content: TabContent): string {
		switch (content.type) {
			case 'markdown':
				return content.handle.id;
			case 'view':
				return content.view.id;
			case 'new':
			case 'home':
			case 'licenses':
				return content.id;
		}
	}

	get origin(): TabContent {
		if (TabState.idOf(this.content) === this.id) return this.content;
		return this.history.find((h) => TabState.idOf(h.content) === this.id)?.content ?? this.content;
	}

	get title(): string {
		return this.detail ?? TabState.titleOf(this.origin);
	}

	static titleOf(content: TabContent): string {
		switch (content.type) {
			case 'markdown':
				return content.handle.title;
			case 'view':
				return content.view.slug;
			case 'new':
				return 'New project';
			case 'home':
				return 'Home';
			case 'licenses':
				return 'Licenses';
		}
	}

	get back(): Visit | undefined {
		return this.history[this.history.length - 1];
	}

	get next(): Visit | undefined {
		return this.forward[this.forward.length - 1];
	}

	// dep
	get handle(): DocHandle | undefined {
		return this.content.type === 'markdown' ? this.content.handle : undefined;
	}

	toJSON(): TabJSON {
		return {
			...TabState.contentToJSON(this.content, this.state, this.pinned),
			tab_id: this.id,
			detail: this.detail ?? undefined,
			history: this.history.map((h) => TabState.contentToJSON(h.content, h.state, false)),
			forward: this.forward.map((h) => TabState.contentToJSON(h.content, h.state, false))
		};
	}

	private static contentToJSON(
		content: TabContent,
		state: Record<string, any>,
		pinned: boolean
	): TabJSONBase {
		if (content.type === 'markdown') {
			return { type: 'markdown', handleId: content.handle.id, state, pinned };
		}
		if (content.type === 'new' || content.type === 'home' || content.type === 'licenses') {
			return { type: content.type, id: content.id, state, pinned };
		}
		if (!content.view.temporary) {
			return { type: 'view-ref', viewId: content.view.id, state, pinned };
		}
		return { type: 'view', view: content.view.toJSON(), state, pinned };
	}

	static forDoc(doc: DocHandle): TabState {
		return new TabState({ type: 'markdown', handle: doc });
	}

	static forView(view: View): TabState {
		return new TabState({ type: 'view', view });
	}

	static forNew(): TabState {
		return new TabState({ type: 'new', id: uuidv4() });
	}

	static forHome(): TabState {
		return new TabState({ type: 'home', id: 'home' });
	}

	static forLicenses(): TabState {
		return new TabState({ type: 'licenses', id: 'licenses' });
	}

	private static readonly MAX_HISTORY = 10;

	static async loadFromJSON(json: TabJSON): Promise<TabState> {
		const loaded = await TabState.contentFromJSON(json);
		const tab = json.tab_id
			? new TabState(loaded.content, loaded.state, loaded.pinned, json.tab_id)
			: loaded;
		tab.detail = json.detail ?? null;
		tab.history = await TabState.visitsFromJSON(json.history);
		tab.forward = await TabState.visitsFromJSON(json.forward);
		return tab;
	}

	private static async visitsFromJSON(entries: TabJSONBase[] = []): Promise<Visit[]> {
		const visits: Visit[] = [];
		// a document deleted since the last run simply drops out of the stack
		for (const entry of entries.slice(-TabState.MAX_HISTORY)) {
			try {
				const past = await TabState.contentFromJSON(entry);
				visits.push({ content: past.content, state: past.state });
			} catch {
				/* gone */
			}
		}
		return visits;
	}

	private static async contentFromJSON(json: TabJSONBase): Promise<TabState> {
		if (json.type === 'markdown') {
			const handle = await DocHandle.fromID(json.handleId);
			return new TabState({ type: 'markdown', handle }, json.state ?? {}, json.pinned ?? false);
		}
		if (json.type === 'view') {
			const view = new View(json.view);
			return new TabState({ type: 'view', view }, json.state ?? {}, json.pinned ?? false);
		}
		if (json.type === 'view-ref') {
			const saved = (await listSavedViewJSON()).find((v) => v.id === json.viewId);
			if (!saved) throw new Error(`Saved view not found: ${json.viewId}`);
			const view = new View(saved);
			return new TabState({ type: 'view', view }, json.state ?? {}, json.pinned ?? false);
		}
		if (json.type === 'new' || json.type === 'home' || json.type === 'licenses') {
			return new TabState({ type: json.type, id: json.id }, json.state ?? {}, json.pinned ?? false);
		}
		throw new Error(`Unknown tab type: ${(json as { type: string }).type}`);
	}
}

// ── Core ─────────────────────────────────────────────────────────────────────────────

export interface EditorJSON {
	tabs: TabJSON[];
	tabAccessOrderById: string[];
	focusOrder?: FocusTarget[];
	focused?: FocusTarget;
	flex?: number;
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
	// the bookmark's surface: one transient tab outside the strip, shown until focus goes
	// anywhere else, never persisted
	preview: TabState | null = $state(null);
	flex: number = $state(1);
	session: Session | null = null;
	private tabAccessOrderById: string[] = $state([]); // reverse accessed order, last = most recent
	private focusOrder: FocusTarget[] = $state([]);
	private closedTabs: { tab: TabState; index: number }[] = [];

	constructor(json?: EditorJSON, tabs?: TabState[]) {
		this.focused = json?.focused ?? null;
		if (json?.tabAccessOrderById) this.tabAccessOrderById = json.tabAccessOrderById;
		if (json?.focusOrder) this.focusOrder = json.focusOrder;
		if (json?.flex) this.flex = json.flex;
		if (tabs) this.tabs = tabs;
	}

	private sameTarget(a: FocusTarget, b: FocusTarget): boolean {
		if (a.kind !== b.kind) return false;
		if (a.kind === 'tab' && b.kind === 'tab') return a.id === b.id;
		return true;
	}

	private mostRecentValidFocus(): FocusTarget | null {
		for (let i = this.focusOrder.length - 1; i >= 0; i--) {
			const t = this.focusOrder[i];
			if (t.kind === 'preview') {
				if (this.preview) return t;
				continue;
			}
			if (t.kind !== 'tab') return t;
			if (this.tabs.some((tab) => tab.id === t.id)) return t;
		}
		return null;
	}

	// ── Getters ─────────────────────────────────────────────────────────────────────────

	get peer(): EditorState | null {
		return this.session?.editors.find((e) => e !== this) ?? null;
	}

	beside(): EditorState {
		return this.session?.beside(this) ?? this;
	}

	get focusedTab(): TabState | undefined {
		if (this.focused?.kind === 'preview') return this.preview ?? undefined;
		if (this.focused?.kind !== 'tab') return undefined;
		const id = this.focused.id;
		return this.tabs.find((v) => v.id === id);
	}

	get focusedDocument(): DocHandle | undefined {
		const tab = this.focusedTab;
		return tab?.content.type === 'markdown' ? tab.content.handle : undefined;
	}

	get focusedView(): View | undefined {
		const tab = this.focusedTab;
		return tab?.content.type === 'view' ? tab.content.view : undefined;
	}

	isTabFocused(tab: FocusTarget): boolean {
		if (!this.focused || this.focused.kind !== tab.kind) return false;
		if (tab.kind === 'tab') {
			return this.focused.kind === 'tab' && this.focused.id === tab.id;
		}
		return true;
	}

	// ── Serialization ───────────────────────────────────────────────────────────────────

	static async loadFromJSON(json: EditorJSON): Promise<EditorState> {
		// dedupe by id to guard against corrupt state.json
		const seen = new Set<string>();
		const tabs: TabState[] = [];
		for (const tabJson of json.tabs ?? []) {
			const id =
				tabJson.tab_id ??
				(tabJson.type === 'markdown'
					? tabJson.handleId
					: tabJson.type === 'view'
						? tabJson.view.id
						: tabJson.type === 'view-ref'
							? tabJson.viewId
							: tabJson.id);
			if (seen.has(id)) continue;
			seen.add(id);
			try {
				const tab = await TabState.loadFromJSON(tabJson);
				tabs.push(tab);
			} catch (e) {
				console.error(`Failed to load tab ${id} from editor state json: ${e}`);
				continue;
			}
		}

		return new EditorState(json, tabs);
	}

	toJSON(): EditorJSON {
		return {
			tabs: this.tabs.map((t) => t.toJSON()),
			tabAccessOrderById: this.tabAccessOrderById,
			focusOrder: this.focusOrder,
			focused: this.focused ?? undefined,
			flex: this.flex
		};
	}

	// ── Tab actions ─────────────────────────────────────────────────────────────────────

	focusTab(tab: FocusTarget) {
		if (this.isTabFocused(tab)) return;
		if (tab.kind !== 'preview') this.preview = null;
		this.focused = tab;
		if (tab.kind === 'tab') {
			// update accessed order: filter out id, then append to end to update order
			let accessedOrder = this.tabAccessOrderById.filter((v) => v != tab.id);
			accessedOrder.push(tab.id);
			this.tabAccessOrderById = accessedOrder;
		}
		this.focusOrder = [...this.focusOrder.filter((t) => !this.sameTarget(t, tab)), tab];
	}

	// show something in the bookmark's transient surface, replacing whatever was there; if
	// it's already a real tab, that tab is the place to be
	showPreview(tab: TabState) {
		const existing = this.tabs.find((t) => t.id === tab.id);
		if (existing) return this.focusTab({ kind: 'tab', id: existing.id });
		this.preview = tab;
		this.focused = { kind: 'preview' };
		this.focusOrder = [...this.focusOrder.filter((t) => t.kind !== 'preview'), { kind: 'preview' }];
	}

	openTab(tab: TabState) {
		if (this.tabs.some((d) => d.id === tab.id)) return; // dupe
		this.tabs.push(tab);
	}

	insertTab(tab: TabState, index = this.tabs.length) {
		if (!this.tabs.some((t) => t.id === tab.id)) {
			const pinned = this.pinnedCount;
			const at = tab.pinned ? Math.min(index, pinned) : Math.max(index, pinned);
			this.tabs.splice(at, 0, tab);
		}
		this.focusTab({ kind: 'tab', id: tab.id });
	}

	// `state` is merged into the tab's own, e.g. a heading for the editor to jump to once it opens
	openDoc(doc: DocHandle, state: Record<string, any> = {}) {
		const existing = this.tabs.find(
			(t) => t.content.type === 'markdown' && t.content.handle.id === doc.id
		);
		const tab = existing ?? TabState.forDoc(doc);
		Object.assign(tab.state, state);
		if (!existing) this.openTab(tab);
		this.focusTab({ kind: 'tab', id: tab.id });
	}

	openView(view: View) {
		this.openTab(TabState.forView(view));
		this.focusTab({ kind: 'tab', id: view.id });
	}

	// a tab navigates like a browser tab: it keeps its slot and its identity, remembering where it
	// was so the reader can go back, even if that content is open elsewhere
	showViewInTab(tab: TabState, view: View) {
		this.showInTab(tab, { type: 'view', view });
	}

	showDocInTab(tab: TabState, doc: DocHandle, state: Record<string, any> = {}) {
		this.showInTab(tab, { type: 'markdown', handle: doc }, state);
	}

	showSetupInTab(tab: TabState, state: Record<string, any> = {}) {
		this.showInTab(tab, { type: 'new', id: uuidv4() }, state);
	}

	private showInTab(tab: TabState, content: TabContent, state: Record<string, any> = {}) {
		if (TabState.idOf(content) === TabState.idOf(tab.content)) return;
		tab.history.push({ content: tab.content, state: tab.state });
		tab.forward = [];
		this.swapContent(tab, content, state);
	}

	goBack(tab: TabState) {
		const prev = tab.history.pop();
		if (!prev) return;
		tab.forward.push({ content: tab.content, state: tab.state });
		this.swapContent(tab, prev.content, prev.state);
	}

	goForward(tab: TabState) {
		const next = tab.forward.pop();
		if (!next) return;
		tab.history.push({ content: tab.content, state: tab.state });
		this.swapContent(tab, next.content, next.state);
	}

	openDetail(content: TabContent, origin: string) {
		const id = TabState.idOf(content);
		const open = this.tabs.find((t) => !t.detail && TabState.idOf(t.content) === id);
		if (open) return this.focusTab({ kind: 'tab', id: open.id });
		let tab = this.tabs.find((t) => t.detail);
		if (!tab) {
			tab = new TabState(content, {}, false, uuidv4());
			this.openTab(tab);
		}
		tab.detail = origin;
		tab.history = [];
		tab.forward = [];
		this.swapContent(tab, content, {});
	}

	private swapContent(tab: TabState, content: TabContent, state: Record<string, any>) {
		tab.content = content;
		tab.state = state;
		if (tab !== this.preview) this.focusTab({ kind: 'tab', id: tab.id });
	}

	openNewTab() {
		const tab = TabState.forNew();
		this.openTab(tab);
		this.focusTab({ kind: 'tab', id: tab.id });
	}

	// the landing page; one of it, focused if it's already open
	openHome() {
		const existing = this.tabs.find((t) => t.content.type === 'home');
		const tab = existing ?? TabState.forHome();
		if (!existing) this.openTab(tab);
		this.focusTab({ kind: 'tab', id: tab.id });
	}

	openLicenses() {
		this.openTab(TabState.forLicenses());
		this.focusTab({ kind: 'tab', id: 'licenses' });
	}

	focusAdjacentTab(delta: number) {
		const count = this.tabs.length;
		if (count === 0) return;
		const f = this.focused;
		const cur = f?.kind === 'tab' ? this.tabs.findIndex((t) => t.id === f.id) : -1;
		const base = cur === -1 ? (delta > 0 ? -1 : 0) : cur;
		this.focusTab({ kind: 'tab', id: this.tabs[(base + delta + count) % count].id });
	}

	/**
	 * Swap the tab `oldId` for `tab` in place
	 */
	replaceTab(oldId: string, tab: TabState) {
		const existing = this.tabs.find((t) => t.id === tab.id && t.id !== oldId);
		if (existing) {
			this.closeTab(oldId, false);
			this.focusTab({ kind: 'tab', id: existing.id });
			return;
		}
		const idx = this.tabs.findIndex((t) => t.id === oldId);
		if (idx === -1) {
			this.openTab(tab);
		} else {
			this.tabs[idx] = tab;
		}
		this.tabAccessOrderById = this.tabAccessOrderById.map((id) => (id === oldId ? tab.id : id));
		this.focusOrder = this.focusOrder.map((t) =>
			t.kind === 'tab' && t.id === oldId ? { kind: 'tab', id: tab.id } : t
		);
		if (this.focused?.kind === 'tab' && this.focused.id === oldId) {
			this.focused = { kind: 'tab', id: tab.id };
		}
	}

	closeTab(id: string, remember = true) {
		if (this.preview?.id === id) {
			this.preview = null;
			this.focusOrder = this.focusOrder.filter((t) => t.kind !== 'preview');
			if (this.focused?.kind === 'preview') this.focused = this.mostRecentValidFocus();
			return;
		}
		const idx = this.tabs.findIndex((v) => v.id === id);
		if (idx === -1) return;

		if (remember) {
			this.closedTabs.push({ tab: this.tabs[idx], index: idx });
			if (this.closedTabs.length > 25) this.closedTabs.shift();
		}

		this.tabs.splice(idx, 1);
		this.tabAccessOrderById = this.tabAccessOrderById.filter((v) => v != id);
		this.focusOrder = this.focusOrder.filter((t) => !(t.kind === 'tab' && t.id === id));

		if (this.focused?.kind === 'tab' && this.focused.id === id) {
			const prev = this.mostRecentValidFocus();
			if (prev) {
				this.focused = prev;
			} else if (this.tabs.length > 0) {
				this.focused = {
					kind: 'tab',
					id: this.tabs[Math.min(idx, this.tabs.length - 1)].id
				};
			} else {
				this.focused = null;
			}
		}
	}

	reopenClosedTab() {
		const entry = this.closedTabs.pop();
		if (!entry) return;
		if (this.tabs.some((t) => t.id === entry.tab.id)) {
			this.focusTab({ kind: 'tab', id: entry.tab.id });
			return;
		}
		const idx = Math.min(entry.index, this.tabs.length);
		this.tabs.splice(idx, 0, entry.tab);
		this.focusTab({ kind: 'tab', id: entry.tab.id });
	}

	moveTab(fromIndex: number, toIndex: number) {
		if (fromIndex === toIndex) return;
		const [tab] = this.tabs.splice(fromIndex, 1);
		this.tabs.splice(toIndex, 0, tab);
	}

	get pinnedCount(): number {
		return this.tabs.filter((t) => t.pinned).length;
	}

	reorderTab(fromIndex: number, toIndex: number, pinned: boolean) {
		const [tab] = this.tabs.splice(fromIndex, 1);
		tab.pinned = pinned;
		const pinnedRem = this.tabs.filter((t) => t.pinned).length;
		const dest = pinned
			? Math.min(Math.max(toIndex, 0), pinnedRem)
			: Math.min(Math.max(toIndex, pinnedRem), this.tabs.length);
		this.tabs.splice(dest, 0, tab);
	}

	togglePin(id: string) {
		const idx = this.tabs.findIndex((t) => t.id === id);
		if (idx === -1) return;
		const [tab] = this.tabs.splice(idx, 1);
		tab.pinned = !tab.pinned;
		const pinnedRem = this.tabs.filter((t) => t.pinned).length;
		this.tabs.splice(pinnedRem, 0, tab);
	}

	isPinned(id: string): boolean {
		return this.tabs.find((t) => t.id === id)?.pinned ?? false;
	}

	/** Close all unpinned tabs (pinned tabs are kept). */
	closeUnpinned() {
		const toClose = this.tabs.filter((t) => !t.pinned).map((t) => t.id);
		for (const id of toClose) this.closeTab(id);
	}

	/**
	 * returns TabState instances in reverse accessed order (last is most recent) within editor
	 *
	 * lazily cleans up previously removed tabs from this.tabAccessOrderById
	 */
	cleanTabsAccessedOrder(): TabState[] {
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
