import { load, type Store } from '@tauri-apps/plugin-store';
import type View from '$lib/models/View.svelte';

// Saved views live in views.json
type ViewJSON = ReturnType<View['toJSON']>;

let store: Store | null = null;
async function getStore(): Promise<Store> {
	if (!store) store = await load('views.json');
	return store;
}

export async function listSavedViewJSON(): Promise<ViewJSON[]> {
	const s = await getStore();
	return (await s.get<ViewJSON[]>('views')) ?? [];
}

export async function saveViewJSON(json: ViewJSON): Promise<void> {
	const s = await getStore();
	const all = (await s.get<ViewJSON[]>('views')) ?? [];
	const idx = all.findIndex((v) => v.id === json.id);
	if (idx >= 0) all[idx] = json;
	else all.push(json);
	await s.set('views', all);
	await s.save();
}

export async function deleteSavedView(id: string): Promise<void> {
	const s = await getStore();
	const all = (await s.get<ViewJSON[]>('views')) ?? [];
	await s.set(
		'views',
		all.filter((v) => v.id !== id)
	);
	await s.save();
}

export async function isViewSaved(id: string): Promise<boolean> {
	return (await listSavedViewJSON()).some((v) => v.id === id);
}
