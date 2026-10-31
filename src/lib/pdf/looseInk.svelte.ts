import { invoke } from '@tauri-apps/api/core';
import type PdfHandle from '#lib/models/PdfHandle.js';
import { reportError } from '#lib/overlays.svelte.js';
import { isStroke } from './annotation.js';
import type { LooseStroke } from './ink.js';

/** A PDF's loose ink: strokes drawn but not yet lassoed, kept in the PDF's sidecar. */
export default class LooseInk {
	strokes: LooseStroke[] = $state([]);

	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private pending = false;

	constructor(private readonly pdf: () => PdfHandle) {}

	async load(): Promise<void> {
		const pdf = this.pdf();
		const raw = await invoke<unknown[]>('read_pdf_ink', { sourceId: pdf.source.id, id: pdf.id });
		this.strokes = raw.filter(
			(s): s is LooseStroke => isStroke(s) && Number.isInteger((s as LooseStroke).page)
		);
	}

	add(stroke: LooseStroke): void {
		this.strokes = [...this.strokes, stroke];
		this.save();
	}

	/** Removes the strokes `drop` picks and returns them. */
	take(drop: (s: LooseStroke) => boolean): LooseStroke[] {
		const taken = this.strokes.filter(drop);
		if (taken.length === 0) return taken;
		this.strokes = this.strokes.filter((s) => !drop(s));
		this.save();
		return taken;
	}

	/** Writes once drawing pauses, rather than on every stroke. */
	private save(): void {
		this.pending = true;
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.flush(), 400);
	}

	/** Writes what's waiting now; the viewer calls this as it closes. */
	async flush(): Promise<void> {
		clearTimeout(this.saveTimer);
		if (!this.pending) return;
		this.pending = false;
		const pdf = this.pdf();
		await invoke('save_pdf_ink', {
			id: pdf.id,
			sourceId: pdf.source.id,
			relPath: pdf.relPath,
			ink: $state.snapshot(this.strokes)
		}).catch((e) => reportError(e, "The ink couldn't be saved."));
	}
}
