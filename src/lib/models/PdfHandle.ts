import { invoke } from '@tauri-apps/api/core';
import Doc, { type DocumentRow } from './Doc';
import type { Source } from './Source';
import { tagSlug } from './Tag';

function stemOf(relPath: string): string {
	return relPath.slice(relPath.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
}

class PdfHandle extends Doc {
	readonly writesMeta = true;
	readonly inRepo = false;
	readonly isNew = false;

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

	async fetchTags(): Promise<void> {
		await this.reload();
	}

	async setTags(slugs: string[]): Promise<void> {
		await invoke('set_document_tags', {
			id: this.id,
			sourceId: this.source.id,
			relPath: this._relPath,
			tags: [...new Set(slugs.map(tagSlug).filter(Boolean))]
		});
		await this.reload();
	}

	async saveMeta(meta: { createdAt?: Date; updatedAt?: Date }): Promise<void> {
		await invoke('save_document_meta', {
			id: this.id,
			sourceId: this.source.id,
			relPath: this._relPath,
			createdAt: meta.createdAt?.toISOString() ?? null,
			updatedAt: meta.updatedAt?.toISOString() ?? null
		});
		if (meta.createdAt) this.createdAt = meta.createdAt;
		if (meta.updatedAt) this.updatedAt = meta.updatedAt;
	}

	async rename(title: string): Promise<void> {
		const oldRelPath = this._relPath;
		const ext = oldRelPath.match(/\.[^./]+$/)?.[0] ?? '.pdf';
		const newRel = await invoke<string>('rename_document', {
			sourceId: this.source.id,
			relPath: oldRelPath,
			newName: title + ext
		});
		this.updateLocation(this.source, newRel, title);
		await this.updateLinks(oldRelPath);
	}

	async moveToPath(newRelPath: string): Promise<void> {
		const oldRelPath = this._relPath;
		await invoke('move_document', {
			sourceId: this.source.id,
			relPath: oldRelPath,
			newRelPath
		});
		this.updateLocation(this.source, newRelPath, stemOf(newRelPath));
		await this.updateLinks(oldRelPath);
		await this.stripLeftProjects(this.source.id, oldRelPath);
	}

	async moveToSource(newSource: Source, newRelPath: string): Promise<void> {
		const oldSourceId = this.source.id;
		const oldRelPath = this._relPath;
		await invoke('move_document', {
			sourceId: oldSourceId,
			relPath: oldRelPath,
			newRelPath,
			newSourceId: newSource.id
		});
		this.updateLocation(newSource, newRelPath, stemOf(newRelPath));
		await this.stripLeftProjects(oldSourceId, oldRelPath);
	}

	async delete(): Promise<boolean> {
		const kept = await invoke<boolean>('delete_document', {
			id: this.id,
			sourceId: this.source.id,
			relPath: this._relPath
		});
		if (kept) this.deletedAt = new Date();
		return kept;
	}

	async purge(): Promise<void> {
		await invoke('purge_document', { id: this.id });
	}

	markOpened() {}
}

export default PdfHandle;
