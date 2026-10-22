import { convertFileSrc } from '@tauri-apps/api/core';
import Doc, { type DocumentRow } from './Doc';
import type { Source } from './Source';

class PdfHandle extends Doc {
	constructor(row: DocumentRow, source: Source) {
		if (row.document_type !== 'pdf') {
			throw new Error(`${row.document_type} is not a pdf document (id ${row.id})`);
		}
		super(row, source);
	}

	get url(): string {
		return convertFileSrc(`${this.source.path}/${this.relPath}`);
	}
}

export default PdfHandle;
