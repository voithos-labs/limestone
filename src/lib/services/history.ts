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
export function historyRepo(docId: string): Repo {
	let repo = repos.get(docId);
	if (!repo) {
		repo = new Repo({ storage: new TauriStorageAdapter([docId]) });
		repos.set(docId, repo);
	}
	return repo;
}

export function listHistoryRoots(docId: string): Promise<string[]> {
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
	heads: string[];
	time: number;
}

const CHECKPOINT_GAP_MS = 60_000;
const CHECKPOINT_MAX_SPAN_MS = 300_000;

export function buildCheckpoints(doc: Automerge.Doc<DocHistoryShape>): Checkpoint[] {
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
async function addChangeHistory(docId: string, newBody: string) {
	// load or create history
	const dh = await getDocHistoryHandle(docId);
	// apply change
	dh.change((d) => updateText(d, ['text'], newBody));
}


// endregion