/**
 * A fake Tauri backend for the browser. Every native surface limestone touches —
 * store, fs, events, window/webview chrome, SQL, settings, sources — funnels
 * through one `invoke` channel, so replacing `__TAURI_INTERNALS__` covers all of
 * it. Commands the handler map doesn't answer are recorded rather than faked, so
 * an app change that reaches for a new command fails a spec instead of silently
 * reading `null`.
 */

import type { Page } from '@playwright/test';

// ── Public API ───────────────────────────────────────────────────────────────

/** Markdown bodies keyed by source-relative path, e.g. `notes/hello.md`. */
export type SeededDocs = Record<string, string>;

export interface MockState {
	writes: { path: string; content: string }[];
	/** Commands with no handler. Non-empty means the mock layer needs extending. */
	unhandledCommands: string[];
}

type MockWindow = typeof globalThis & {
	__TAURI_INTERNALS__?: Record<string, unknown>;
	__TAURI_EVENT_PLUGIN_INTERNALS__?: Record<string, unknown>;
	__mockState?: MockState;
};

/**
 * Installs the fake backend before any app code runs. Seeded docs exist both on
 * the fake filesystem and in the restored session, so each opens as a tab, the
 * first one focused.
 */
export async function installTauriMocks(page: Page, docs: SeededDocs): Promise<void> {
	await page.addInitScript(installMockInternals, docs);
}

export async function getMockState(page: Page): Promise<MockState> {
	return page.evaluate(() => {
		const state = (window as MockWindow).__mockState;
		if (!state) throw new Error('Tauri mocks were not installed on this page');
		return {
			writes: state.writes.map((write) => ({ ...write })),
			unhandledCommands: [...state.unhandledCommands]
		};
	});
}

// ── Init script ──────────────────────────────────────────────────────────────

// Playwright serializes this function, so it can only reach its own body and
// erased type annotations — never anything else in module scope.
function installMockInternals(docs: SeededDocs): void {
	const SOURCE = {
		id: 'mock-source',
		title: 'Mock source',
		path: '/mock-source',
		created_at: '2026-01-01T00:00:00Z',
		accessed_at: '2026-01-01T00:00:00Z',
		// Frontmatter would stamp a fresh `updated_at` into every save, making the
		// recorded write content differ from the editor body and from run to run.
		use_frontmatter: false,
		note_location: '',
		asset_location: 'assets',
		ignore: [] as string[]
	};
	const SEEDED_AT = Date.UTC(2026, 0, 1);
	const APP_VERSION = '0.0.0-mock';

	const files: Record<string, string> = { ...docs };
	const state: MockState = { writes: [], unhandledCommands: [] };

	const settings = {
		appearance: {
			compact_tabs: false,
			collapse_pinned_tabs: false,
			compact_doc_header: true,
			editor_font_size: 16,
			ui_scale_percent: 100,
			max_page_width: 900
		},
		updates: { auto_install: false }
	};

	function clone<T>(value: T): T {
		return JSON.parse(JSON.stringify(value)) as T;
	}

	function unhandled(cmd: string): null {
		if (!state.unhandledCommands.includes(cmd)) state.unhandledCommands.push(cmd);
		console.warn(`[tauri-mock] no handler for ${cmd}`);
		return null;
	}

	// ── Documents ──────────────────────────────────────

	function relPathOf(absolute: string): string {
		const normalized = absolute.replace(/\\/g, '/');
		const prefix = `${SOURCE.path}/`;
		return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
	}

	// A document's id is its path, so specs address a doc by the key they seeded it under.
	function documentRow(relPath: string) {
		return {
			id: relPath,
			source_id: SOURCE.id,
			document_type: 'markdown',
			rel_path: relPath,
			title: relPath.split('/').pop()!.replace(/\.md$/i, ''),
			created_at: SEEDED_AT,
			updated_at: SEEDED_AT,
			accessed_at: SEEDED_AT,
			mtime: null,
			deleted_at: null,
			properties: '{}',
			source_path: SOURCE.path,
			source_title: SOURCE.title,
			groups_json: null
		};
	}

	// Only the document-by-id join is answered. Every other query reads as an empty
	// table, which is what the app shows for a library with no indexed content.
	function runSelect(query: string, params: unknown[]): unknown[] {
		if (!query.includes('FROM documents d JOIN sources s')) return [];
		const id = params[0];
		return typeof id === 'string' && id in files ? [documentRow(id)] : [];
	}

	// ── Stores ─────────────────────────────────────────

	const restoredTabs = Object.keys(files).map((relPath) => ({
		type: 'markdown',
		handleId: relPath,
		state: {},
		pinned: false
	}));
	const restoredEditors: Record<string, unknown>[] = [];
	if (restoredTabs.length > 0) {
		const focus = { kind: 'tab', id: restoredTabs[0].handleId };
		restoredEditors.push({
			tabs: restoredTabs,
			tabAccessOrderById: restoredTabs.map((tab) => tab.handleId),
			focusOrder: [focus],
			focused: focus
		});
	}

	const stores: Record<string, Record<string, unknown>> = {
		// `version` must match the app's APP_STATE_VERSION: on a mismatch the session
		// wipes the store, taking the seeded tabs with it.
		'state.json': { version: 1, activeTheme: 'default-dark', editors: restoredEditors },
		'themes.json': {}
	};
	const storePaths: string[] = [];

	function storeRid(path: string): number {
		const existing = storePaths.indexOf(path);
		if (existing !== -1) return existing;
		if (!(path in stores)) stores[path] = {};
		return storePaths.push(path) - 1;
	}

	function runStoreCommand(op: string, args: Record<string, any>): unknown {
		if (op === 'load' || op === 'get_store') return storeRid(args.path);
		const data = stores[storePaths[args.rid]];
		switch (op) {
			case 'get':
				return [data[args.key], args.key in data];
			case 'set':
				data[args.key] = args.value;
				return null;
			case 'has':
				return args.key in data;
			case 'delete': {
				const existed = args.key in data;
				delete data[args.key];
				return existed;
			}
			case 'keys':
				return Object.keys(data);
			case 'values':
				return Object.values(data);
			case 'entries':
				return Object.entries(data);
			case 'length':
				return Object.keys(data).length;
			case 'clear':
			case 'reset': {
				for (const key of Object.keys(data)) delete data[key];
				return null;
			}
			case 'save':
			case 'reload':
				return null;
			default:
				return unhandled(`plugin:store|${op}`);
		}
	}

	// ── Settings ───────────────────────────────────────

	function settingAt(key: string): unknown {
		let current: unknown = settings;
		for (const segment of key.split('.')) {
			if (current === null || typeof current !== 'object') return null;
			current = (current as Record<string, unknown>)[segment];
		}
		return current ?? null;
	}

	// ── Callbacks and events ───────────────────────────

	const callbacks = new Map<number, (data: unknown) => void>();
	const listeners: Record<string, number[]> = {};

	function registerCallback(callback: (data: unknown) => void, once = false): number {
		const id = window.crypto.getRandomValues(new Uint32Array(1))[0];
		callbacks.set(id, (data) => {
			if (once) callbacks.delete(id);
			callback?.(data);
		});
		return id;
	}

	// The listen id must be the callback id the app registered, or unlisten cannot
	// find it and an emit cannot reach the handler.
	function runEventCommand(op: string, args: Record<string, any>): unknown {
		switch (op) {
			case 'listen':
				(listeners[args.event] ??= []).push(args.handler);
				return args.handler;
			case 'emit': {
				for (const id of listeners[args.event] ?? []) callbacks.get(id)?.(args);
				return null;
			}
			case 'unlisten':
				return null;
			default:
				return unhandled(`plugin:event|${op}`);
		}
	}

	function unregisterListener(event: string, id: number): void {
		listeners[event] = (listeners[event] ?? []).filter((each) => each !== id);
		callbacks.delete(id);
	}

	// ── IPC ────────────────────────────────────────────

	async function invoke(cmd: string, args: Record<string, any> = {}): Promise<unknown> {
		const STORE_PREFIX = 'plugin:store|';
		if (cmd.startsWith(STORE_PREFIX)) return runStoreCommand(cmd.slice(STORE_PREFIX.length), args);
		const EVENT_PREFIX = 'plugin:event|';
		if (cmd.startsWith(EVENT_PREFIX)) return runEventCommand(cmd.slice(EVENT_PREFIX.length), args);

		switch (cmd) {
			case 'plugin:app|version':
				return APP_VERSION;
			case 'plugin:updater|check':
				return null;
			case 'plugin:fs|read_text_file': {
				const relPath = relPathOf(args.path);
				if (!(relPath in files)) throw new Error(`No such file: ${args.path}`);
				// The plugin decodes bytes, not a string.
				return Array.from(new TextEncoder().encode(files[relPath]));
			}
			case 'plugin:fs|exists':
				return relPathOf(args.path) in files;
			case 'write_document':
				files[args.relPath] = args.contents;
				state.writes.push({ path: args.relPath, content: args.contents });
				return null;
			case 'sql_select':
				return runSelect(args.query, args.params ?? []);
			case 'sql_execute':
				return { rows_affected: 0, last_insert_rowid: 0 };
			case 'get_setting':
				return settingAt(args.key);
			case 'get_all_settings':
			case 'get_default_settings':
				return clone(settings);
			case 'get_app_info':
				return { device_key: 'mock-device', version: APP_VERSION };
			case 'get_sources':
				return [clone(SOURCE)];
			case 'get_source_by_id':
				return clone(SOURCE);
			case 'get_default_source_id':
				return SOURCE.id;
		}

		// Window chrome is inert in a browser: maximize, drag, zoom and close all no-op.
		if (cmd.startsWith('plugin:window|') || cmd.startsWith('plugin:webview|')) return null;

		return unhandled(cmd);
	}

	// ── Internals (mirrors @tauri-apps/api/mocks) ──────

	const scope = window as MockWindow;
	scope.__TAURI_INTERNALS__ = {
		...scope.__TAURI_INTERNALS__,
		invoke,
		transformCallback: registerCallback,
		unregisterCallback: (id: number) => callbacks.delete(id),
		runCallback: (id: number, data: unknown) => callbacks.get(id)?.(data),
		callbacks,
		metadata: {
			currentWindow: { label: 'main' },
			currentWebview: { windowLabel: 'main', label: 'main' }
		},
		convertFileSrc: (filePath: string, protocol = 'asset') =>
			`http://${protocol}.localhost/${encodeURIComponent(filePath)}`
	};
	scope.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener };
	scope.__mockState = state;
}
