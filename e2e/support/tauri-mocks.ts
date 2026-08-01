/**
 * A fake Tauri backend for the browser. Every native surface limestone touches funnels through
 * one `invoke` channel, so replacing `__TAURI_INTERNALS__` covers all of it. Commands the handler
 * map doesn't answer are recorded rather than faked, so an app change that reaches for a new
 * command fails a spec instead of silently reading `null`.
 */

import type { Page } from '@playwright/test';
// The backend's own defaults, not a copy: a parallel set drifts, and a spec asserting a value the
// shipped app never starts at cannot tell a read setting from one that silently fell back.
import SHIPPED_DEFAULTS from '../../src-tauri/defaults/default_settings.json' with { type: 'json' };

// ── Public API ───────────────────────────────────────────────────────────────

/** Raw file contents keyed by source-relative path, e.g. `notes/hello.md`. */
export type SeededDocs = Record<string, string>;

/** The host `convertFileSrc` mints, so a spec can recognize a fetch of a mocked asset. */
export const ASSET_HOST = 'asset.localhost';

export interface MockOptions {
	docs: SeededDocs;
	/**
	 * Whether the seeded source keeps document metadata in YAML frontmatter. Off by default: with
	 * it on every save stamps a fresh `updated_at`, so a spec that turns it on asserts on the
	 * stable frontmatter keys, never on the whole file.
	 */
	frontmatter: boolean;
	/**
	 * Setting values the reader changed. Each key REPLACES the whole top-level branch of that
	 * name — seeding one `appearance` field drops the rest of the group, so seed the group whole.
	 */
	settings: Settings;
	/** What a previous session left in `state.json` per tab, keyed by the doc's seeded path. */
	tabState: Record<string, Record<string, unknown>>;
	/**
	 * Property names a saved view contributes to every seeded document. With any, the header grows
	 * an asynchronously loading properties panel — a header that settles after the first paint.
	 */
	propertyFields: string[];
}

/** The backend's settings tree, shaped only as far as a spec needs to address it. */
export type Settings = Record<string, unknown>;

/** Everything `write_document` was called with, not just the path and body. */
export interface DocumentWrite {
	path: string;
	content: string;
	sourceId: string;
	updatedAt: number;
	create: boolean;
}

/** An image the reader pasted, as it reached the source's asset importer. */
export interface AssetImport {
	sourceId: string;
	ext: string;
	byteLength: number;
	/** The path handed back, which the editor writes into the document as an embed. */
	relPath: string;
}

export interface MockState {
	writes: DocumentWrite[];
	assetImports: AssetImport[];
	/** Every command in the order it was invoked, so a spec can assert ordering. */
	calls: string[];
	/** Commands with no handler. Non-empty means the mock layer needs extending. */
	unhandledCommands: string[];
}

type MockWindow = typeof globalThis & {
	__TAURI_INTERNALS__?: Record<string, unknown>;
	__TAURI_EVENT_PLUGIN_INTERNALS__?: Record<string, unknown>;
	__mockState?: MockState;
};

/**
 * Installs the fake backend before any app code runs. Seeded docs exist both on the fake
 * filesystem and in the restored session, so each opens as a tab, the first one focused.
 */
export async function installTauriMocks(page: Page, options: MockOptions): Promise<void> {
	await page.addInitScript(installMockInternals, { ...options, defaults: SHIPPED_DEFAULTS });
}

export async function getMockState(page: Page): Promise<MockState> {
	return page.evaluate(() => {
		const state = (window as MockWindow).__mockState;
		if (!state) throw new Error('Tauri mocks were not installed on this page');
		return {
			writes: state.writes.map((write) => ({ ...write })),
			assetImports: state.assetImports.map((each) => ({ ...each })),
			calls: [...state.calls],
			unhandledCommands: [...state.unhandledCommands]
		};
	});
}

// ── Init script ──────────────────────────────────────────────────────────────

// Playwright serializes this function, so it can only reach its own body and
// erased type annotations — never anything else in module scope.
function installMockInternals({
	docs,
	frontmatter,
	settings: overrides,
	tabState,
	propertyFields,
	defaults: shippedDefaults
}: MockOptions & { defaults: Settings }): void {
	const SOURCE = {
		id: 'mock-source',
		title: 'Mock source',
		path: '/mock-source',
		created_at: '2026-01-01T00:00:00Z',
		accessed_at: '2026-01-01T00:00:00Z',
		use_frontmatter: frontmatter,
		note_location: '',
		asset_location: 'assets',
		ignore: [] as string[]
	};
	const SEEDED_AT = Date.UTC(2026, 0, 1);
	const APP_VERSION = '0.0.0-mock';

	const files: Record<string, string> = { ...docs };
	const state: MockState = { writes: [], assetImports: [], calls: [], unhandledCommands: [] };

	function clone<T>(value: T): T {
		return JSON.parse(JSON.stringify(value)) as T;
	}

	function deepFreeze<T>(value: T): T {
		if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
		return Object.freeze(value);
	}

	// Frozen: a setting write that reached this branch would leave `isModified` reading false
	// for a value the reader just changed, and the app would never show it as modified.
	const defaults = deepFreeze(shippedDefaults);

	// Seeded overrides reach the values alone, never the defaults, so what a spec seeds reads
	// back as modified — the shape the app sees once the reader has changed a setting.
	const values: Settings = { ...clone(defaults), ...overrides };

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

	// Two queries answered, each matched on the shape only it has: the document-by-id join and a
	// view's membership lookup. Anything else reads as an empty table. Matching loosely (any
	// `FROM documents d`) would answer queries this was never written for — the way a mock stops
	// standing for the backend.
	function runSelect(query: string, params: unknown[]): unknown[] {
		if (!query.includes('FROM documents d')) return [];
		const seeded = params.filter((p): p is string => typeof p === 'string' && p in files);
		if (query.includes('JOIN sources s')) return seeded.slice(0, 1).map(documentRow);
		return query.includes('d.id IN (') ? seeded.map(documentRow) : [];
	}

	// ── Stores ─────────────────────────────────────────

	const restoredTabs = Object.keys(files).map((relPath) => ({
		type: 'markdown',
		handleId: relPath,
		state: tabState[relPath] ?? {},
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

	// One saved view every seeded document belongs to, so the header's properties panel has
	// fields to render. Its own membership query is answered by `runSelect`.
	const propsView = {
		id: 'mock-view',
		slug: 'notes',
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
		fields: propertyFields.map((name, i) => ({ id: `field-${i}`, name, type: 'text', config: {} })),
		filter: { op: 'and', children: [] },
		faces: [],
		state: {}
	};

	const stores: Record<string, Record<string, unknown>> = {
		// `version` must match the app's APP_STATE_VERSION: on a mismatch the session
		// wipes the store, taking the seeded tabs with it.
		'state.json': { version: 1, activeTheme: 'default-dark', editors: restoredEditors },
		'themes.json': {},
		'views.json': { version: 1, views: propertyFields.length > 0 ? [propsView] : [] }
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
		let current: unknown = values;
		for (const segment of key.split('.')) {
			if (current === null || typeof current !== 'object') return null;
			current = (current as Record<string, unknown>)[segment];
		}
		return current ?? null;
	}

	function writeSetting(key: string, value: unknown): void {
		const segments = key.split('.');
		let branch = values as Record<string, unknown>;
		for (const segment of segments.slice(0, -1)) {
			const next = branch[segment];
			if (next === null || typeof next !== 'object') branch[segment] = {};
			branch = branch[segment] as Record<string, unknown>;
		}
		branch[segments[segments.length - 1]] = value;
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

	function runCallback(id: number, data: unknown): void {
		const callback = callbacks.get(id);
		if (!callback) {
			console.warn(`[tauri-mock] no callback registered for id ${id}`);
			return;
		}
		callback(data);
	}

	// The listen id must be the callback id the app registered, or unlisten cannot
	// find it and an emit cannot reach the handler.
	function runEventCommand(op: string, args: Record<string, any>): unknown {
		switch (op) {
			case 'listen':
				(listeners[args.event] ??= []).push(args.handler);
				return args.handler;
			case 'emit': {
				for (const id of listeners[args.event] ?? []) runCallback(id, args);
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
		state.calls.push(cmd);

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
			case 'write_document': {
				// The Rust command refuses to overwrite when the caller asked to create.
				if (args.create && args.relPath in files) {
					throw new Error(`"${args.relPath}" already exists`);
				}
				files[args.relPath] = args.contents;
				state.writes.push({
					path: args.relPath,
					content: args.contents,
					sourceId: args.sourceId,
					updatedAt: args.updatedAt,
					create: args.create ?? false
				});
				return null;
			}
			case 'import_source_asset_bytes': {
				// As the Rust command does: the bytes land in the source's asset folder under a
				// generated name, and the path comes back relative to the source.
				const relPath = `${SOURCE.asset_location}/Pasted image ${state.assetImports.length + 1}.${args.ext}`;
				state.assetImports.push({
					sourceId: args.sourceId,
					ext: args.ext,
					byteLength: atob(args.data).length,
					relPath
				});
				return relPath;
			}
			case 'delete_document':
				delete files[args.relPath];
				return null;
			case 'sql_select':
				return runSelect(args.query, args.params ?? []);
			case 'sql_execute':
				return { rows_affected: 0, last_insert_rowid: 0 };
			case 'get_setting':
				return settingAt(args.key);
			case 'set_setting_global':
				writeSetting(args.key, args.value);
				return null;
			case 'get_all_settings':
				return clone(values);
			case 'get_default_settings':
				return clone(defaults);
			case 'get_app_info':
				return { device_key: 'mock-device', version: APP_VERSION };
			case 'get_sources':
				return [clone(SOURCE)];
			case 'get_source_by_id':
				return clone(SOURCE);
			case 'get_default_source_id':
				return SOURCE.id;

			// Window chrome has no effect in a browser, but the calls are recorded above,
			// so a spec can still assert that closing destroyed the window.
			case 'plugin:window|is_maximized':
				return false;
			case 'plugin:window|minimize':
			case 'plugin:window|toggle_maximize':
			case 'plugin:window|start_dragging':
			case 'plugin:window|close':
			case 'plugin:window|destroy':
			case 'plugin:webview|set_webview_zoom':
				return null;
		}

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
