/*

alright basically this is like an App class in the classic Java patterns because they're kinda
cute and nice and simple and work well with the other models in this system that I want to use

 */

// external
import { load, type Store } from '@tauri-apps/plugin-store';

// internal
import EditorState from '$lib/state/EditorState.svelte';
import type { Source } from '$lib/models/Source';
import { loadState, type State, updateState } from '$lib/state/State';
import { applyTheme, BUILTIN_THEMES, DEFAULT_THEME, type Theme } from '$lib/services/theme';

export interface ViewTab {
	kind: string;
	state?: Record<string, any>;
}

class Session {
	editors: EditorState[];
	activeTheme: string; // ;;;;;; replace the current theme config here, managed here
	// sources: Source[];
	viewTabs: Map<string, ViewTab> = new Map();

	private themeStore: Store;

	private constructor(
		editors: EditorState[],
		activeTheme: string,
		themeStore: Store,
		viewTabs?: ViewTab[]
	) {
		this.editors = editors;
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
		let state = await loadState();
		let themeStore = await load('themes.json');

		// ensure built-in themes are always up to date in the store
		for (const [key, theme] of Object.entries(BUILTIN_THEMES)) {
			await themeStore.set(key, theme);
		}

		// hydrate EditorState instances from JSON
		let editors: EditorState[] = [];
		for (const editorJSON of state.editors) {
			editors.push(await EditorState.loadFromJSON(editorJSON));
		}
		if (editors.length === 0) {
			editors.push(new EditorState());
		}

		let session = new Session(editors, state.activeTheme, themeStore, state.viewTabs);
		await session.applyCurrentTheme();
		return session;
	}

	// ── Theme ───────────────────────────────────────────────────────────────────────────

	async applyCurrentTheme() {
		const theme = await this.themeStore.get<Theme>(this.activeTheme);
		applyTheme(theme ?? DEFAULT_THEME);
	}

	async setTheme(name: string) {
		const theme = await this.themeStore.get<Theme>(name);
		if (!theme) return;
		this.activeTheme = name;
		applyTheme(theme);
		await this.persist();
	}

	async saveTheme(key: string, theme: Theme) {
		await this.themeStore.set(key, theme);
	}

	async listThemes(): Promise<string[]> {
		return await this.themeStore.keys();
	}

	// ── Serialization ───────────────────────────────────────────────────────────────────
	toJSON(): State {
		return {
			editors: this.editors.map((e) => e.toJSON()),
			activeTheme: this.activeTheme,
			viewTabs: [...this.viewTabs.values()]
		};
	}

	async persist() {
		let json = this.toJSON();
		await updateState(json);
	}
}

export default Session;
