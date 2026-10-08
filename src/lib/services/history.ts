import { invoke } from '@tauri-apps/api/core';
import * as Automerge from '@automerge/automerge/slim';
import wasmUrl from '@automerge/automerge/automerge.wasm?url';

import { fromBase64, toBase64 } from '#lib/services/assets';
import { getAppInfo } from '#lib/models/Settings.svelte';
import { registerFlush } from '#lib/services/platform';

// region store
// ── Per-Doc Automerge Store ──────────────────────────────────────────────────────────

interface DocHistoryShape {
	text: string;
}

type Doc = Automerge.Doc<DocHistoryShape>;

interface HistoryEntry {
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

async function openHistory(docId: string): Promise<HistoryEntry> {
	const [actor, chunks] = await Promise.all([
		ensureReady(),
		invoke<string[]>('history_load', { docId })
	]);
	let doc = Automerge.init<DocHistoryShape>({ actor });
	doc = Automerge.loadIncremental(doc, genesis(docId));
	for (const chunk of chunks) doc = Automerge.loadIncremental(doc, fromBase64(chunk));
	return { doc, chain: Promise.resolve() };
}

function historyEntry(docId: string): Promise<HistoryEntry> {
	let entry = entries.get(docId);
	if (!entry) {
		entry = openHistory(docId);
		entry.catch(() => entries.delete(docId));
		entries.set(docId, entry);
	}
	return entry;
}

async function historyDoc(docId: string): Promise<Doc> {
	const entry = await historyEntry(docId);
	await entry.chain;
	return entry.doc;
}

async function changeHistory(
	docId: string,
	fn: Automerge.ChangeFn<DocHistoryShape>
): Promise<void> {
	const entry = await historyEntry(docId);
	const run = entry.chain.then(async () => {
		const before = Automerge.getHeads(entry.doc).join();
		const next = Automerge.change(entry.doc, fn);
		const heads = Automerge.getHeads(next);
		if (heads.join() === before) return;
		const [hash] = heads;
		const data = toBase64(Automerge.getLastLocalChange(next)!);
		await invoke('history_append', { docId, hash, data });
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

export async function removeHistory(docId: string): Promise<void> {
	const entry = entries.get(docId);
	entries.delete(docId);
	if (entry) await settled(entry);
	await invoke('history_remove', { docId });
}

/**
 * Add change to history via Automerge `updateText`
 */
export function addChangeHistory(docId: string, newBody: string): Promise<void> {
	return changeHistory(docId, (d) => Automerge.updateText(d, ['text'], newBody));
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

export async function historyCheckpoints(docId: string): Promise<Checkpoint[]> {
	return buildCheckpoints(docId, await historyDoc(docId));
}

export async function historyTextAt(docId: string, cp: Checkpoint): Promise<string> {
	const doc = await historyDoc(docId);
	return Automerge.view(doc, cp.heads).text;
}

export async function historyDelta(
	docId: string,
	from: Checkpoint | 'present', // the present is a present
	to: Checkpoint
): Promise<StateDelta> {
	const doc = await historyDoc(docId);
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
