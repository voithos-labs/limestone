import {
	historyCheckpoints,
	historyDelta,
	historyTextAt,
	type Checkpoint,
	type StateDelta
} from '#lib/services/history.js';
import type DocHandle from './DocHandle.js';

export interface HistoryVersion {
	text: string;
	delta: StateDelta;
}

export default class DocHistory {
	readonly doc: DocHandle;
	checkpoints = $state<Checkpoint[]>([]);
	index = $state(0);
	version = $state<HistoryVersion | null>(null);
	loading = $state(false);
	private seq = 0;
	private cache = new Map<string, HistoryVersion>();

	constructor(doc: DocHandle) {
		this.doc = doc;
	}

	get available(): boolean {
		return this.doc.idOnDisk;
	}

	get count(): number {
		return this.checkpoints.length;
	}

	get atPresent(): boolean {
		return this.index >= this.checkpoints.length - 1;
	}

	get selected(): Checkpoint | null {
		return this.checkpoints[this.index] ?? null;
	}

	async load(): Promise<void> {
		const seq = ++this.seq;
		const checkpoints = await historyCheckpoints(this.doc);
		if (seq !== this.seq) return;
		this.checkpoints = checkpoints;
		this.index = Math.max(0, checkpoints.length - 1);
		this.version = null;
		this.loading = false;
	}

	async select(i: number): Promise<void> {
		const cps = this.checkpoints;
		const idx = Math.max(0, Math.min(cps.length - 1, i));
		this.index = idx;
		const seq = ++this.seq;
		if (idx >= cps.length - 1) {
			this.version = null;
			this.loading = false;
			return;
		}
		const cp = cps[idx];
		const key = cp.heads.join('\n');
		let v = this.cache.get(key);
		if (!v) {
			this.loading = true;
			const prev = cps[idx - 1];
			const [text, delta] = await Promise.all([
				historyTextAt(this.doc, cp),
				prev ? historyDelta(this.doc, prev, cp) : null
			]);
			v = { text, delta: delta ?? { inserts: [{ from: 0, to: text.length }], removals: [] } };
			this.cache.set(key, v);
			if (seq !== this.seq) return;
			this.loading = false;
		}
		this.version = v;
	}

	async selectAt(heads: string[], time: number): Promise<void> {
		const cps = this.checkpoints;
		const key = heads.join('\n');
		let i = cps.findIndex((cp) => cp.heads.join('\n') === key);
		if (i < 0) {
			for (let j = 0; j < cps.length - 1; j++) if (cps[j].time <= time) i = j;
		}
		if (i >= 0) await this.select(i);
	}

	reset(): void {
		void this.select(this.checkpoints.length - 1);
	}
}
