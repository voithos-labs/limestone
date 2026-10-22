import { invoke } from '@tauri-apps/api/core';
import Doc, { type DocumentRow } from './Doc';
import type { Source } from './Source';

class PdfHandle extends Doc {
	constructor(row: DocumentRow, source: Source) {
		if (row.document_type !== 'pdf') {
			throw new Error(`${row.document_type} is not a pdf document (id ${row.id})`);
		}
		super(row, source);
	}

	async loadBytes(): Promise<Uint8Array> {
		const bytes = await invoke<ArrayBuffer>('read_document_bytes', {
			sourceId: this.source.id,
			relPath: this._relPath
		});
		await this.markAccessed();
		return new Uint8Array(bytes);
	}
}

export default PdfHandle;
