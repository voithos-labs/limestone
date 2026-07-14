<script lang="ts">
	import type View from '$lib/models/View.svelte';
	import type {
		FilterNode,
		ViewFace,
		SortKey,
		ViewField,
		MemberRow
	} from '$lib/models/View.svelte';
	import { isLeafActive } from '$lib/models/View.svelte';
	import {
		createMetaDate,
		deriveCreateContext,
		folderLinkChain,
		folderPath
	} from '$lib/views/createDefaults';
	import { searchDocuments } from '$lib/services/search';
	import { select } from '$lib/services/db';
	import { listSources, pickCreationSource, getDefaultSourceId, type Source } from '$lib/models/Source';
	import Group, { GroupType } from '$lib/models/Group';
	import DocHandle from '$lib/models/DocHandle';
	import FaceCard from '../FaceCard.svelte';
	import { readTextFile } from '@tauri-apps/plugin-fs';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { onMount, untrack } from 'svelte';

	let {
		view,
		face,
		onOpenRow,
		createSignal = 0
	}: {
		view: View;
		face: ViewFace;
		onOpenRow?: (rowId: string) => void;
		createSignal?: number;
	} = $props();

	type Row = MemberRow;

	const query = $derived((view.state.search as string | undefined) ?? '');
	const layout = $derived((face.config.layout as string) ?? 'grid');

	let rows: Row[] = $state([]);
	let total = $state(0);
	let error = $state('');
	let loading = $state(true);
	let loadToken = 0;

	let sources: Source[] = $state([]);
	let folders: Group[] = $state([]);
	let defaultSourceId: string | null = $state(null);

	async function load(silent = false) {
		const token = ++loadToken;
		if (!silent) loading = true;
		error = '';
		try {
			const q = query.trim();
			let out: Row[];
			if (q) {
				const hits = await searchDocuments(q);
				const ids = hits
					.filter((h) => h.kind === 'document')
					.map((h) => h.id)
					.slice(0, 100);
				if (ids.length === 0) {
					out = [];
				} else {
					const members = (await view.getMembers({ face, ids_in: ids, limit: ids.length })) as Row[];
					const byId = new Map(members.map((m) => [m.id, m]));
					out = ids.map((id) => byId.get(id)).filter((r): r is Row => !!r);
				}
			} else {
				out = (await view.getMembers({ face, limit: 100 })) as Row[];
			}
			if (token !== loadToken) return;
			rows = out;
			total = out.length;
			loadRowTags(out);
			loadPreviews(out, token);
			if (!q && out.length === 100) {
				view.countMembers({ face })
					.then((n) => {
						if (token === loadToken) total = n;
					})
					.catch(() => {});
			}
		} catch (e) {
			if (token === loadToken) error = String(e);
		} finally {
			if (token === loadToken) loading = false;
		}
	}

	function nodeSig(n: FilterNode): string {
		if ('children' in n) return `C|${n.op}|${n.children.map(nodeSig).join(',')}`;
		return isLeafActive(n.op, n.value) ? `L|${n.field_id}|${n.op}|${String(n.value)}` : '';
	}

	function sortSig(keys: SortKey[]): string {
		return keys.map((k) => `${k.field_id}|${k.direction}|${k.nulls ?? 'last'}`).join(',');
	}

	let reloadTimer: ReturnType<typeof setTimeout> | null = null;
	let lastSig: string | null = null;
	let lastFaceId: string | null = null;

	$effect(() => {
		const sig = [
			view.slug,
			nodeSig(view.filter),
			nodeSig(face.additive_filter),
			sortSig(face.sort),
			query.trim()
		].join('#');
		const faceId = face.id;
		if (lastSig === null) {
			lastSig = sig;
			lastFaceId = faceId;
			return;
		}
		if (sig === lastSig) {
			lastFaceId = faceId;
			return;
		}
		const faceChanged = faceId !== lastFaceId;
		lastSig = sig;
		lastFaceId = faceId;
		if (reloadTimer) clearTimeout(reloadTimer);
		if (faceChanged) load(true);
		else reloadTimer = setTimeout(() => load(true), 100);
	});

	onMount(() => {
		load();
		listSources()
			.then((ss) => (sources = ss))
			.catch(() => {});
		Group.list()
			.then((gs) => (folders = gs.filter((g) => g.groupType === GroupType.Folder)))
			.catch(() => {});
		getDefaultSourceId()
			.then((id) => (defaultSourceId = id))
			.catch(() => {});
		return () => {
			if (reloadTimer) clearTimeout(reloadTimer);
			if (settleTimer) clearTimeout(settleTimer);
		};
	});

	let rowTags: Record<string, { id: string; slug: string }[]> = $state({});

	async function loadRowTags(list: Row[]) {
		if (list.length === 0) {
			rowTags = {};
			return;
		}
		try {
			const ph = list.map(() => '?').join(', ');
			const hits = await select<{ doc_id: string; id: string; slug: string }>(
				`SELECT dg.document_id AS doc_id, g.id, g.slug
				 FROM document_groups dg
						  JOIN groups g ON g.id = dg.group_id
				 WHERE g.group_type = 'tag'
				   AND dg.document_id IN (${ph})`,
				list.map((r) => r.id)
			);
			const next: Record<string, { id: string; slug: string }[]> = {};
			for (const h of hits) (next[h.doc_id] ??= []).push({ id: h.id, slug: h.slug });
			rowTags = next;
		} catch {}
	}

	const PREVIEW_MAX = 280;
	const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
	const IMAGE_EMBED_RE = /!\[\[([^\]\n]+?)\]\]|!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/;

	type Preview = { text: string; image: string };
	const previewCache = new Map<string, Preview>();
	let previews: Record<string, string> = $state({});
	let images: Record<string, string> = $state({});

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

	// same resolution the editor's inline embeds use: source-relative, falling back
	// to the source's asset folder for bare filenames
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

	async function loadPreviews(list: Row[], token: number) {
		let srcs = sources;
		if (srcs.length === 0) {
			try {
				srcs = sources = await listSources();
			} catch {
				return;
			}
		}
		const byId = new Map(srcs.map((s) => [s.id, s]));
		const nextText: Record<string, string> = {};
		const nextImg: Record<string, string> = {};
		await Promise.all(
			list.map(async (r) => {
				const key = `${r.id}:${r.updated_at}`;
				let hit = previewCache.get(key);
				if (hit === undefined) {
					const src = byId.get(r.source_id);
					if (!src) return;
					try {
						const raw = await readTextFile(`${src.path}/${r.rel_path}`);
						const body = DocHandle.deserialize(raw).body;
						hit = {
							text: stripMd(body).slice(0, PREVIEW_MAX),
							image: firstImage(body, src)
						};
					} catch {
						hit = { text: '', image: '' };
					}
					previewCache.set(key, hit);
				}
				nextText[r.id] = hit.text;
				if (hit.image) nextImg[r.id] = hit.image;
			})
		);
		if (token === loadToken) {
			previews = nextText;
			images = nextImg;
		}
	}

	const metaFields = $derived(
		face.display_field_ids
			.map((fid) => view.fields.find((f) => f.id === fid))
			.filter((f): f is ViewField => !!f && f.type !== 'title')
	);

	const tagSlugsFor = (rowId: string) => (rowTags[rowId] ?? []).map((t) => t.slug);

	const GAP = 12;
	const COL_MIN = 220;
	let gridW = $state(0);
	let heights: Record<string, number> = $state({});
	let settledW = $state(0);
	let settleTimer: ReturnType<typeof setTimeout> | null = null;
	let animate = $state(false);

	// Only the container width is debounced: card widths are pinned to it, so a
	// window drag can't change any card's height, and positions never go stale.
	$effect(() => {
		const w = gridW;
		if (settleTimer) clearTimeout(settleTimer);
		if (w <= 0 || untrack(() => settledW) === 0) {
			settledW = w;
			return;
		}
		settleTimer = setTimeout(() => (settledW = w), 120);
	});

	const colCount = $derived(
		layout === 'list' ? 1 : Math.max(1, Math.floor((settledW + GAP) / (COL_MIN + GAP)))
	);

	// Cards are hidden until every one has reported a real height: a single card's
	// position depends on all the others, so a partial set means wrong positions.
	const measured = $derived(rows.length > 0 && rows.every((r) => heights[r.id] !== undefined));

	$effect(() => {
		if (!measured || untrack(() => animate)) return;
		requestAnimationFrame(() => requestAnimationFrame(() => (animate = true)));
	});

	$effect(() => {
		void rows;
		animate = false;
	});

	const cardLayout = $derived.by(() => {
		const colW = (settledW - (colCount - 1) * GAP) / colCount;
		const tot = new Array(colCount).fill(0);
		const pos: Record<string, { x: number; y: number }> = {};
		for (const r of rows) {
			let ci = 0;
			for (let i = 1; i < colCount; i++) if (tot[i] < tot[ci]) ci = i;
			pos[r.id] = { x: ci * (colW + GAP), y: tot[ci] };
			tot[ci] += (heights[r.id] ?? 0) + GAP;
		}
		return { colW, pos, height: Math.max(0, ...tot) };
	});

	const createCtx = $derived(deriveCreateContext(view, face, folders));
	let creating = false;

	async function createNote() {
		if (creating) return;
		creating = true;
		try {
			let source: Source | undefined;
			if (createCtx.sourceId) source = sources.find((s) => s.id === createCtx.sourceId);
			if (!source && createCtx.folderGroupId) {
				const g = folders.find((f) => f.id === createCtx.folderGroupId);
				if (g?.sourceId) source = sources.find((s) => s.id === g.sourceId);
			}
			if (!source) source = pickCreationSource(sources, defaultSourceId) ?? undefined;
			if (!source) throw new Error('No source available to create in');
			const dir = createCtx.folderGroupId ? folderPath(createCtx.folderGroupId, folders) : '';
			const groupIds = [
				...(createCtx.folderGroupId ? folderLinkChain(createCtx.folderGroupId, folders) : []),
				...createCtx.tagGroupIds
			];
			const props = Object.keys(createCtx.fieldValues).length
				? { views: { [view.slug]: createCtx.fieldValues } }
				: {};
			const doc = await DocHandle.createFromTitle(source, {
				title: 'Untitled',
				dir,
				groupIds,
				properties: props
			});
			// keep the note inside the view's date scope (e.g. a journal body on a past day)
			const createdAt = createMetaDate(createCtx, 'created_at');
			const updatedAt = createMetaDate(createCtx, 'updated_at');
			if (createdAt || updatedAt) {
				await doc.saveMeta({
					createdAt: createdAt ?? undefined,
					updatedAt: updatedAt ?? undefined
				});
			}
			load(true);
			onOpenRow?.(doc.id);
		} catch (e) {
			error = String(e);
		} finally {
			creating = false;
		}
	}

	let lastCreateSignal = -1;
	$effect(() => {
		const sig = createSignal;
		if (lastCreateSignal === -1) {
			lastCreateSignal = sig;
			return;
		}
		if (sig !== lastCreateSignal) {
			lastCreateSignal = sig;
			createNote();
		}
	});
</script>

{#if error}
	<p class="error">{error}</p>
{/if}

<div class="list-face">
	<div
		class="lf-grid"
		class:measured
		bind:clientWidth={gridW}
		style:height="{measured ? cardLayout.height : 0}px"
	>
		{#if settledW > 0}
			{#each rows as row (row.id)}
				{@const p = cardLayout.pos[row.id]}
				<div
					class="card-slot"
					class:animated={animate}
					style:width="{cardLayout.colW}px"
					style:transform="translate({p.x}px, {p.y}px)"
					bind:clientHeight={heights[row.id]}
				>
					<FaceCard
						{row}
						fields={metaFields}
						viewSlug={view.slug}
						{sources}
						tags={tagSlugsFor(row.id)}
						preview={previews[row.id] ?? ''}
						image={images[row.id] ?? ''}
						onOpen={() => onOpenRow?.(row.id)}
					/>
				</div>
			{/each}
		{/if}
	</div>

	{#if !loading && rows.length === 0}
		<div class="lf-empty">No documents</div>
	{:else}
		<div class="lf-footer">
			{#if loading}loading...
			{:else if total > rows.length}showing {rows.length} of {total}{:else}{rows.length}
				{rows.length === 1 ? 'doc' : 'docs'}
			{/if}
		</div>
	{/if}
</div>

<style>
	.error {
		margin: 0 24px 12px;
		padding: 8px 12px;
		font-size: 12px;
		color: var(--color-accent);
		background: var(--error-bg);
		border-radius: var(--radius-ui);
	}

	.list-face {
		margin: 0 24px;
		font-family: var(--font-ui);
	}

	.lf-grid {
		position: relative;
	}

	.card-slot {
		position: absolute;
		top: 0;
		left: 0;
	}

	.lf-grid:not(.measured) .card-slot {
		visibility: hidden;
	}

	.card-slot.animated {
		transition: transform 160ms ease;
	}

	.lf-empty {
		padding: 28px 14px;
		text-align: center;
		font-size: 13px;
		color: var(--color-ui-muted);
	}

	.lf-footer {
		padding: 14px 16px 16px;
		font-size: 11px;
		color: var(--color-ui-muted);
		text-align: center;
	}
</style>
