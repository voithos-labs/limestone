import { invoke } from '@tauri-apps/api/core';

function toBase64(data: ArrayBuffer | Uint8Array): string {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	let bin = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(bin);
}

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
