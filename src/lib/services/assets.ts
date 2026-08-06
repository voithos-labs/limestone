import { invoke } from '@tauri-apps/api/core';
import { toBase64 } from '$lib/util/bytes';

export function importGlobalAsset(srcPath: string): Promise<string> {
	return invoke<string>('import_global_asset', { srcPath });
}

export function importGlobalAssetBytes(
	data: ArrayBuffer | Uint8Array,
	ext: string
): Promise<string> {
	return invoke<string>('import_global_asset_bytes', { data: toBase64(data), ext });
}

export function importSourceAssetBytes(
	sourceId: string,
	data: ArrayBuffer | Uint8Array,
	ext: string
): Promise<string> {
	return invoke<string>('import_source_asset_bytes', { sourceId, data: toBase64(data), ext });
}

export function deleteSourceAsset(sourceId: string, relPath: string): Promise<void> {
	return invoke<void>('delete_source_asset', { sourceId, relPath });
}
