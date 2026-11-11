/**
 * loose ink: strokes drawn on a pdf that aren't part of an annotation yet.
 *
 * They aren't notes, so they live in the pdf's meta file (`.limestone/docs/<id>/meta.json`)
 * instead. Lassoing some and giving them a comment or a citation makes them an ink annotation. This
 * class holds them, and writes them back shortly after drawing stops and when the viewer closes.
 */

import { invoke } from '@tauri-apps/api/core';
import type PdfHandle from '#lib/models/PdfHandle.js';
import { reportError } from '#lib/overlays.svelte.js';
import { isStroke } from './annotation.js';
import type { LooseStroke } from './ink.js';

/** A PDF's loose ink: strokes drawn but not yet lassoed, kept in the PDF's meta.json. */
export default class LooseInk {
	// raw, so `take` hands back the very strokes `add` stored and a history step can find them again
	strokes: LooseStroke[] = $state.raw([]);
	/** Whether the strokes have been read at least once, so none means there are none. */
	loaded = $state(false);

	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private pending = false;

	constructor(private readonly pdf: () => PdfHandle) {}

	async load(): Promise<void> {
		const pdf = this.pdf();
		const raw = await invoke<unknown[]>('read_pdf_ink', { sourceId: pdf.source.id, id: pdf.id });
		this.strokes = raw.filter(
			(s): s is LooseStroke => isStroke(s) && Number.isInteger((s as LooseStroke).page)
		);
		this.loaded = true;
	}

	add(...strokes: LooseStroke[]): void {
		if (strokes.length === 0) return;
		this.strokes = [...this.strokes, ...strokes];
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
