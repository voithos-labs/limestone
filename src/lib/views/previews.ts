import { readTextFile } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { MemberRow } from '$lib/models/View.svelte';
import type { Source } from '$lib/models/Source';
import DocHandle from '$lib/models/DocHandle';

// Cheap previews for cards until there are real thumbnails: the first image embedded in the
// body if there is one, else the first few hundred characters of prose with the markdown
// stripped. Cached per (id, updated_at) so a reload only reads files that changed.

export type Preview = { text: string; image: string };

const PREVIEW_MAX = 280;
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const IMAGE_EMBED_RE = /!\[\[([^\]\n]+?)\]\]|!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/;

function stripMd(s: string): string {
	return s
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/!\[\[[^\]\n]*\]\]/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/^[-*+]\s+\[[ xX]\]\s+/gm, '')
		.replace(/^\s*[-*+>]\s+/gm, '')
		.replace(/[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}/g, '$1')
		.replace(/\n{2,}/g, '\n')
		.trim();
}

// same resolution the editor's inline embeds use: source-relative, falling back to the
// source's asset folder for bare filenames
function firstImage(body: string, source: Source): string {
	const m = IMAGE_EMBED_RE.exec(body);
	if (!m) return '';
	const target = (m[1] ? m[1].split('|')[0] : m[3]).trim();
	if (/^(https?|data|asset):/i.test(target)) return target;
	const clean = target.replace(/\\/g, '/').replace(/^\.?\//, '');
	const ext = clean.split('.').pop()?.toLowerCase() ?? '';
	if (!IMAGE_EXTS.has(ext)) return '';
	const loc = (source.asset_location ?? '').replace(/^\/+|\/+$/g, '');
	const rel = clean.includes('/') || !loc ? clean : `${loc}/${clean}`;
	return convertFileSrc(`${source.path}/${rel}`);
}

export class PreviewCache {
	private cache = new Map<string, Preview>();

	async fetch(rows: MemberRow[], sources: Source[]): Promise<Record<string, Preview>> {
		const out: Record<string, Preview> = {};
		if (rows.length === 0) return out;
		const byId = new Map(sources.map((s) => [s.id, s]));
		await Promise.all(
			rows.map(async (r) => {
				const key = `${r.id}:${r.updated_at}`;
				let hit = this.cache.get(key);
				if (hit === undefined) {
					const src = byId.get(r.source_id);
					if (!src) return;
					try {
						const raw = await readTextFile(`${src.path}/${r.rel_path}`);
						const body = DocHandle.deserialize(raw).body;
						hit = { text: stripMd(body).slice(0, PREVIEW_MAX), image: firstImage(body, src) };
					} catch {
						hit = { text: '', image: '' };
					}
					this.cache.set(key, hit);
				}
				out[r.id] = hit;
			})
		);
		return out;
	}
}
