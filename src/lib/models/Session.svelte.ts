/*

alright basically this is like an App class in the classic Java patterns because they're kinda
cute and nice and simple and work well with the other models in this system that I want to use

 */

// external
import { load, type Store } from '@tauri-apps/plugin-store';
import { SvelteSet } from 'svelte/reactivity';

// internal
import EditorState, { type EditorJSON, type TabState } from '#lib/models/EditorState.svelte.js';
import { SettingsState, getSetting, registerSettings } from '#lib/models/Settings.svelte.js';
import type { Source } from '#lib/models/Source.js';
import {
	applyAccent,
	applyTheme,
	BUILTIN_THEMES,
	DEFAULT_THEME,
	type Theme
} from '#lib/services/theme.svelte.js';

export interface ViewTab {
	kind: string;
	state?: Record<string, any>;
}

// ── App state store (state.json) ─────────────────────────────────────────────────────

export interface AppState {
	activeTheme: string;
	editors: EditorJSON[];
	viewTabs?: ViewTab[];
}

const DEFAULTS: AppState = {
	activeTheme: 'default-dark',
	editors: []
};

const APP_STATE_VERSION = 1;

let appStore: Store | null = null;

async function getAppStore(): Promise<Store> {
	if (!appStore) {
		appStore = await load('state.json');
		const v = await appStore.get<number>('version');
		if (v !== APP_STATE_VERSION) {
			if (v !== undefined) await appStore.clear();
			await appStore.set('version', APP_STATE_VERSION);
			await appStore.save();
		}
	}
	return appStore;
}

async function loadAppState(): Promise<AppState> {
	const s = await getAppStore();
	return {
		activeTheme: (await s.get<string>('activeTheme')) ?? DEFAULTS.activeTheme,
		editors: (await s.get<EditorJSON[]>('editors')) ?? DEFAULTS.editors,
		viewTabs: (await s.get<ViewTab[]>('viewTabs')) ?? []
	};
}

async function updateAppState(partial: Partial<AppState>): Promise<void> {
	const s = await getAppStore();
	for (const [key, value] of Object.entries(partial)) {
		await s.set(key, value);
	}
}

// ── Session ──────────────────────────────────────────────────────────────────────────

class Session {
	editors: EditorState[] = $state([]);
	focusSignal = $state(0);
	private current: EditorState | null = $state(null);
	activeTheme: string = $state(''); // ;;;;;; replace the current theme config here, managed here
	// sources: Source[];
	missingSources = new SvelteSet<string>();
	viewTabs: Map<string, ViewTab> = new Map();
	settings = new SettingsState();

	private themeStore: Store;

	private constructor(
		editors: EditorState[],
		activeTheme: string,
		themeStore: Store,
		viewTabs?: ViewTab[]
	) {
		this.editors = editors;
		registerSettings(this.settings);
		for (const e of editors) e.session = this;
		this.activeTheme = activeTheme;
		this.themeStore = themeStore;
		if (viewTabs) {
			for (const vt of viewTabs) this.viewTabs.set(vt.kind, vt);
		}
	}

	getViewTab(kind: string): ViewTab {
		if (!this.viewTabs.has(kind)) this.viewTabs.set(kind, { kind });
		return this.viewTabs.get(kind)!;
	}

	static async init(): Promise<Session> {
		let state = await loadAppState();
		let themeStore = await load('themes.json');

		// Built-ins are code-owned, so they are rewritten every boot and anything else is stale.
		for (const [key, theme] of Object.entries(BUILTIN_THEMES)) {
			await themeStore.set(key, theme);
		}
		for (const key of await themeStore.keys()) {
			if (!(key in BUILTIN_THEMES)) {
				await themeStore.delete(key);
			}
		}

		let editors: EditorState[] = [];
		for (const editorJSON of state.editors) {
			editors.push(await EditorState.loadFromJSON(editorJSON));
		}
		if (editors.length === 0) {
			editors.push(new EditorState());
		}

		let session = new Session(editors, state.activeTheme, themeStore, state.viewTabs);
		await session.settings.load();
		await session.applyCurrentTheme();
		return session;
	}

	get active(): EditorState {
		return this.editors.find((e) => e === this.current) ?? this.editors[0];
	}

	activate(editor: EditorState, focus = false) {
		if (focus && this.active !== editor) this.focusSignal++;
		this.current = editor;
	}

	beside(editor: EditorState): EditorState {
		if (editor.peer) return editor.peer;
		const created = new EditorState();
		created.session = this;
		editor.flex = 1;
		this.editors.push(created);
		return created;
	}

	moveTab(tab: TabState, from: EditorState, to: EditorState, index?: number) {
		if (from === to) return;
		from.closeTab(tab.id, false);
		if (to !== this.editors[0]) tab.pinned = false;
		to.insertTab(tab, index);
		this.activate(to, true);
	}

	closeEditor(editor: EditorState) {
		const rest = this.editors.filter((e) => e !== editor);
		if (this.active === editor) this.activate(rest[0], true);
		this.editors = rest;
	}

	// ── Theme ───────────────────────────────────────────────────────────────────────────

	async applyCurrentTheme() {
		const theme = (await this.themeStore.get<Theme>(this.activeTheme)) ?? DEFAULT_THEME;
		applyTheme(theme);
		const accent = await getSetting<string>('appearance.accent');
		applyAccent(accent, theme.type);
	}

	async setTheme(name: string) {
		const theme = await this.themeStore.get<Theme>(name);
		if (!theme) return;
		this.activeTheme = name;
		await this.applyCurrentTheme();
		await this.persist();
	}

	async saveTheme(key: string, theme: Theme) {
		await this.themeStore.set(key, theme);
	}

	async listThemes(): Promise<string[]> {
		return (await this.themeStore.keys()).sort((a, b) => a.localeCompare(b));
	}

	// ── Serialization ───────────────────────────────────────────────────────────────────
	toJSON(): AppState {
		return {
			editors: this.editors.map((e) => e.toJSON()),
			activeTheme: this.activeTheme,
			viewTabs: [...this.viewTabs.values()]
		};
	}

	async persist() {
		let json = this.toJSON();
		await updateAppState(json);
	}
}

export default Session;
