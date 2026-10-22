import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import * as Automerge from '@automerge/automerge/slim';
import wasmUrl from '@automerge/automerge/automerge.wasm?url';

import { fromBase64, toBase64 } from '#lib/services/assets.js';
import { getAppInfo } from '#lib/models/Settings.svelte.js';
import { registerFlush } from '#lib/services/platform.js';
import { execute, select } from '#lib/services/db.js';
import { defaultNoteDir, getSource } from '#lib/models/Source.js';
import { sanitizeSegment } from '#lib/util/paths.js';

// region store
// ── Per-Doc Automerge Store ──────────────────────────────────────────────────────────

interface DocHistoryShape {
	text: string;
}

export interface DocRef {
	id: string;
	source: { id: string };
}

type Doc = Automerge.Doc<DocHistoryShape>;

interface HistoryEntry {
	sourceId: string;
	doc: Doc;
	chain: Promise<unknown>;
}

const entries = new Map<string, Promise<HistoryEntry>>();

let deviceActor: Promise<string> | null = null;

function ensureReady(): Promise<string> {
	if (!deviceActor) {
		deviceActor = Promise.all([Automerge.initializeWasm(wasmUrl), getAppInfo()])
			.then(([, info]) => actorOf(info.device_key))
			.catch((e) => {
				deviceActor = null;
				throw e;
			});
	}
	return deviceActor;
}

function actorOf(uuid: string): string {
	return uuid.replace(/-/g, '');
}

function genesis(docId: string): Uint8Array {
	const doc = Automerge.change(
		Automerge.init<DocHistoryShape>({ actor: actorOf(docId) }),
		{ time: 0 },
		(d) => {
			d.text = '';
		}
	);
	return Automerge.getLastLocalChange(doc)!;
}

function loadChunks(sourceId: string, docId: string): Promise<string[]> {
	return invoke<string[]>('history_load', { sourceId, docId });
}

function buildDoc(actor: string, docId: string, chunks: string[]): Doc {
	let doc = Automerge.init<DocHistoryShape>({ actor });
	doc = Automerge.loadIncremental(doc, genesis(docId));
	for (const chunk of chunks) doc = Automerge.loadIncremental(doc, fromBase64(chunk));
	return doc;
}

async function openHistory(ref: DocRef): Promise<HistoryEntry> {
	const docId = ref.id;
	const sourceId = ref.source.id;
	const [actor, chunks] = await Promise.all([ensureReady(), loadChunks(sourceId, docId)]);
	return { sourceId, doc: buildDoc(actor, docId, chunks), chain: Promise.resolve() };
}

function historyEntry(ref: DocRef): Promise<HistoryEntry> {
	let entry = entries.get(ref.id);
	if (!entry) {
		entry = openHistory(ref);
		entry.catch(() => entries.delete(ref.id));
		entries.set(ref.id, entry);
	}
	return entry;
}

async function historyDoc(ref: DocRef): Promise<Doc> {
	const entry = await historyEntry(ref);
	await entry.chain;
	return entry.doc;
}

async function changeHistory(ref: DocRef, fn: Automerge.ChangeFn<DocHistoryShape>): Promise<void> {
	const entry = await historyEntry(ref);
	const run = entry.chain.then(async () => {
		const before = Automerge.getHeads(entry.doc).join();
		const next = Automerge.change(entry.doc, fn);
		const heads = Automerge.getHeads(next);
		if (heads.join() === before) return;
		const [hash] = heads;
		const data = toBase64(Automerge.getLastLocalChange(next)!);
		await invoke('history_append', { sourceId: entry.sourceId, docId: ref.id, hash, data });
		entry.doc = next;
	});
	entry.chain = run.catch(() => {});
	await run;
}

function settled(entry: Promise<HistoryEntry>): Promise<unknown> {
	return entry.then(
		(e) => e.chain,
		() => {}
	);
}

export async function flushHistory(): Promise<void> {
	await Promise.all([...entries.values()].map(settled));
}

registerFlush(flushHistory);

export async function removeHistory(ref: DocRef): Promise<void> {
	const entry = entries.get(ref.id);
	entries.delete(ref.id);
	if (entry) await settled(entry);
	await invoke('history_remove', { sourceId: ref.source.id, docId: ref.id });
}

interface HistoryOrphan {
	doc_id: string;
	source_id: string;
	holder_source_id: string;
}

async function adoptHistory({ doc_id, source_id, holder_source_id }: HistoryOrphan): Promise<void> {
	const entry = entries.get(doc_id);
	entries.delete(doc_id);
	if (entry) await settled(entry);
	const [actor, foreign, own] = await Promise.all([
		ensureReady(),
		loadChunks(source_id, doc_id),
		loadChunks(holder_source_id, doc_id)
	]);
	if (foreign.length === 0) return;
	let change: { hash: string; data: string } | null = null;
	if (own.length > 0) {
		const base = buildDoc(actor, doc_id, foreign);
		const text = buildDoc(actor, doc_id, own).text;
		const next = Automerge.change(base, (d) => Automerge.updateText(d, ['text'], text));
		const [hash] = Automerge.getHeads(next);
		if (hash !== Automerge.getHeads(base)[0]) {
			change = { hash, data: toBase64(Automerge.getLastLocalChange(next)!) };
		}
		await invoke('history_remove', { sourceId: holder_source_id, docId: doc_id });
	}
	await invoke('history_move', {
		sourceId: source_id,
		newSourceId: holder_source_id,
		docId: doc_id
	});
	if (change) {
		await invoke('history_append', { sourceId: holder_source_id, docId: doc_id, ...change });
	}
}

void listen<HistoryOrphan>('history-orphan', (e) => {
	adoptHistory(e.payload).catch((err) => console.error('history adopt failed', err));
});

interface HistoryDeleted {
	doc_id: string;
	source_id: string;
	deleted_at: number;
}

function titleFromText(text: string): string {
	const line = text
		.split('\n')
		.map((l) => l.trim())
		.find((l) => l.length > 0);
	return line?.replace(/^#+\s*/, '').slice(0, 80) || 'Untitled';
}

async function recordDeleted({ doc_id, source_id, deleted_at }: HistoryDeleted): Promise<void> {
	const [row] = await select<{ id: string }>('SELECT id FROM documents WHERE id = ?1', [doc_id]);
	if (row) return;
	const text = await lastHistoryText({ id: doc_id, source: { id: source_id } });
	if (text === null) return;
	const source = await getSource(source_id);
	const title = titleFromText(text);
	const dir = defaultNoteDir(source);
	const base = sanitizeSegment(title) || 'Untitled';
	const relPath = dir ? `${dir}/${base}.md` : `${base}.md`;
	await execute(
		`INSERT OR IGNORE INTO documents (id, source_id, rel_path, title, deleted_at, created_at, updated_at, accessed_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5, ?5)`,
		[doc_id, source_id, relPath, title, deleted_at || Date.now()]
	);
}

void listen<HistoryDeleted>('history-deleted', (e) => {
	recordDeleted(e.payload).catch((err) => console.error('deleted record failed', err));
});

export async function lastHistoryText(ref: DocRef): Promise<string | null> {
	try {
		const last = (await historyCheckpoints(ref)).at(-1);
		const text = last ? await historyTextAt(ref, last) : '';
		return text.trim() ? text : null;
	} catch {
		return null;
	}
}

export async function moveHistory(
	docId: string,
	sourceId: string,
	newSourceId: string
): Promise<void> {
	const entry = entries.get(docId);
	if (entry) await settled(entry);
	await invoke('history_move', { sourceId, newSourceId, docId });
	const loaded = await entry?.catch(() => null);
	if (loaded) loaded.sourceId = newSourceId;
}

/**
 * Add change to history via Automerge `updateText`
 */
export function addChangeHistory(ref: DocRef, newBody: string): Promise<void> {
	return changeHistory(ref, (d) => Automerge.updateText(d, ['text'], newBody));
}
// endregion
// region checkpoints
// ── Checkpoints ──────────────────────────────────────────────────────────────────────

export interface Checkpoint {
	heads: string[]; // like git heads, literally hash[], of the changes sorted under this checkpoint
	time: number;
}

// todo: reasonable groupings, but worth more testing
const CHECKPOINT_GAP_MS = 5_000;
const CHECKPOINT_MAX_SPAN_MS = 30_000;

function buildCheckpoints(docId: string, doc: Doc): Checkpoint[] {
	const skip = actorOf(docId);
	const meta = Automerge.getChangesMetaSince(doc, []).filter((c) => c.actor !== skip);
	const checkpoints: Checkpoint[] = [];
	let last: { hash: string; time: number } | null = null;
	let bucketStart = 0;
	for (const change of meta) {
		const time = change.time * 1000;
		if (
			last &&
			(time - last.time > CHECKPOINT_GAP_MS || time - bucketStart > CHECKPOINT_MAX_SPAN_MS)
		) {
			checkpoints.push({ heads: [last.hash], time: last.time });
			bucketStart = time;
		}
		if (!last) bucketStart = time;
		last = { hash: change.hash, time };
	}
	if (last) {
		checkpoints.push({ heads: [last.hash], time: last.time });
	}
	const present = Automerge.getHeads(doc);
	const tail = checkpoints[checkpoints.length - 1];
	if (!tail || tail.heads.join('\n') !== present.join('\n')) {
		checkpoints.push({ heads: present, time: last?.time ?? 0 });
	}
	return checkpoints;
}
// endregion
// region api
// ── READ API FOR UI-LIKE TYPES N STUFF ───────────────────────────────────────────────

/**
 * this is not data rich, basically just for highlighting changes in the UI
 */
export interface StateDelta {
	inserts: { from: number; to: number }[];
	removals: { at: number; text: string }[];
}

export async function historyCheckpoints(ref: DocRef): Promise<Checkpoint[]> {
	return buildCheckpoints(ref.id, await historyDoc(ref));
}

export async function historyTextAt(ref: DocRef, cp: Checkpoint): Promise<string> {
	const doc = await historyDoc(ref);
	return Automerge.view(doc, cp.heads).text;
}

export async function historyDelta(
	ref: DocRef,
	from: Checkpoint | 'present', // the present is a present
	to: Checkpoint
): Promise<StateDelta> {
	const doc = await historyDoc(ref);
	const fromHeads = from === 'present' ? Automerge.getHeads(doc) : from.heads;
	const patches = Automerge.diff(doc, fromHeads, to.heads).filter((p) => p.path[0] === 'text');

	const inserts: StateDelta['inserts'] = [];
	const removals: StateDelta['removals'] = [];
	let working = Automerge.view(doc, fromHeads).text;
	for (const patch of patches) {
		// sort operation types, {'splice', 'del'},
		// into `inserts` and `removals` for highlighting in editor UI
		if (patch.action === 'splice') {
			const at = patch.path[1] as number;
			working = working.slice(0, at) + patch.value + working.slice(at);
			inserts.push({ from: at, to: at + patch.value.length });
		} else if (patch.action === 'del') {
			const at = patch.path[1] as number;
			const len = patch.length ?? 1;
			removals.push({ at, text: working.slice(at, at + len) });
			working = working.slice(0, at) + working.slice(at + len);
		}
	}
	return { inserts, removals };
}
// endregion
