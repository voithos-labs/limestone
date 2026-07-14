import { invoke } from '@tauri-apps/api/core';
import * as Automerge from '@automerge/automerge';
import { Repo, updateText } from '@automerge/automerge-repo';
import type {
	Chunk,
	DocHandle,
	DocumentId,
	StorageAdapterInterface,
	StorageKey
} from '@automerge/automerge-repo';

import { fromBase64, toBase64 } from '$lib/util/bytes';

// region storage adapter
// ── Storage Adapter (via Tauri To Fs) ────────────────────────────────────────────────

interface WireChunk {
	key: string[];
	data: string;
}

class TauriStorageAdapter implements StorageAdapterInterface {
	constructor(private readonly scope: string[]) {}

	async load(key: StorageKey): Promise<Uint8Array | undefined> {
		const data = await invoke<string | null>('storage_load', { key: [...this.scope, ...key] });
		return data === null ? undefined : fromBase64(data);
	}

	async save(key: StorageKey, data: Uint8Array): Promise<void> {
		await invoke('storage_save', { key: [...this.scope, ...key], data: toBase64(data) });
	}

	async remove(key: StorageKey): Promise<void> {
		await invoke('storage_remove', { key: [...this.scope, ...key] });
	}

	async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
		const chunks = await invoke<WireChunk[]>('storage_load_range', {
			prefix: [...this.scope, ...keyPrefix]
		});
		return chunks.map((c) => ({ key: c.key.slice(this.scope.length), data: fromBase64(c.data) }));
	}

	async removeRange(keyPrefix: StorageKey): Promise<void> {
		await invoke('storage_remove_range', { prefix: [...this.scope, ...keyPrefix] });
	}
}
// endregion
// region repo
// ── Repo Automerge ───────────────────────────────────────────────────────────────────

const repos = new Map<string, Repo>();

// dry init catch
function historyRepo(docId: string): Repo {
	let repo = repos.get(docId);
	if (!repo) {
		repo = new Repo({ storage: new TauriStorageAdapter([docId]) });
		repos.set(docId, repo);
	}
	return repo;
}

function listHistoryRoots(docId: string): Promise<string[]> {
	return invoke<string[]>('storage_list_roots', { prefix: [docId] });
}
// endregion
// region doc history management
// ── Doc History Management ───────────────────────────────────────────────────────────

interface DocHistoryShape {
	docId: string;
	text: string;
}

export interface Checkpoint {
	heads: string[]; // like git heads, literally hash[], of the changes sorted under this checkpoint
	time: number;
}

// todo: reasonable groupings, but worth more testing
const CHECKPOINT_GAP_MS = 20_000;
const CHECKPOINT_MAX_SPAN_MS = 60_000;

function buildCheckpoints(doc: Automerge.Doc<DocHistoryShape>): Checkpoint[] {
	const meta = Automerge.getChangesMetaSince(doc, []);
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
async function getDocHistoryHandle(docId: string): Promise<DocHandle<DocHistoryShape>> {
	const repo = historyRepo(docId);
	const [root] = await listHistoryRoots(docId);
	if (root) {
		return await repo.find<DocHistoryShape>(root as DocumentId);
	}
	return repo.create<DocHistoryShape>({ docId, text: '' });
}

/**
 * Add change to history via Automerge `updateText`
 */
export async function addChangeHistory(docId: string, newBody: string) {
	// load or create history
	const dh = await getDocHistoryHandle(docId);
	// apply change
	dh.change((d) => updateText(d, ['text'], newBody));
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

async function historyDoc(docId: string): Promise<Automerge.Doc<DocHistoryShape>> {
	const dh = await getDocHistoryHandle(docId);
	return dh.doc();
}

export async function historyCheckpoints(docId: string): Promise<Checkpoint[]> {
	return buildCheckpoints(await historyDoc(docId));
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
		// sort operation types, {'splice', 'del', 'put'},
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
		} else if (patch.action === 'put' && typeof patch.value === 'string') {
			removals.push({ at: 0, text: working });
			working = patch.value;
			inserts.push({ from: 0, to: working.length });
		}
	}
	return { inserts, removals };
}
// endregion
