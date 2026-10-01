<script lang="ts">
	import { untrack } from 'svelte';
	import {
		ArrowRight,
		Bookmark,
		Calendar,
		Folder as FolderIcon,
		FolderInput,
		GitBranch,
		Hash
	} from '@lucide/svelte';
	import { listSavedViewJSON } from '$lib/models/View.svelte';
	import Folder, {
		folderIdPath,
		folderIdSource,
		type FolderMeta,
		type MetaMode
	} from '$lib/models/Folder';
	import { getSource, sourceName } from '$lib/models/Source';
	import { metaDialog } from '$lib/metaDialog.svelte';
	import { toasts } from '$lib/toasts.svelte';

	// Where a folder's tags and fields live: written into the top of each file, or kept by
	// Limestone alone. The diagram shows the difference; the choice below sets it
	let name = $state('');
	let meta = $state<FolderMeta | null>(null);
	let mode: MetaMode = $state('follow');
	// what the dialog opened on, so Save only writes a choice the reader actually changed
	let opened: MetaMode = $state('follow');
	// a source has no parent to follow: it just uses metadata or doesn't
	let isRoot = $state(false);
	// the header wears the place's own icon: a project's emoji or mark, else folder or source
	let kind: 'project' | 'folder' | 'source' = $state('folder');
	let emoji = $state('');
	let saving = $state(false);

	// what the picked mode would resolve to, which is what the diagram draws
	const writes = $derived(!meta ? true : mode === 'follow' ? meta.follows : mode === 'write');

	async function load(id: string) {
		meta = null;
		strip = 'idle';
		stripNote = '';
		try {
			const path = folderIdPath(id);
			isRoot = !path;
			const [m, src, saved] = await Promise.all([
				Folder.meta(id),
				getSource(folderIdSource(id)),
				listSavedViewJSON().catch(() => [])
			]);
			meta = m;
			// a source with no choice of its own shows what it comes to today
			mode = isRoot && m.mode === 'follow' ? (m.follows ? 'write' : 'off') : m.mode;
			opened = mode;
			name = isRoot ? sourceName(src) : (path.split('/').pop() ?? path);
			const project = saved.find((v) => v.unit === id);
			kind = project ? 'project' : isRoot ? 'source' : 'folder';
			emoji = project?.emoji ?? '';
		} catch (e) {
			console.error('folder metadata load failed', e);
		}
	}

	$effect(() => {
		if (!metaDialog.open) return;
		const id = metaDialog.folderId;
		untrack(() => load(id));
	});

	async function save() {
		if (!meta || saving) return;
		saving = true;
		try {
			if (mode !== opened) await Folder.setMetaMode(metaDialog.folderId, mode);
			metaDialog.close();
		} catch (e) {
			toasts.push(`That setting couldn't be changed: ${String(e)}`);
		} finally {
			saving = false;
		}
	}

	// ── Removing metadata: text in place, confirmed in place ──────────────────
	let strip: 'idle' | 'armed' | 'running' | 'done' = $state('idle');
	let stripNote = $state('');
	let disarmTimer: ReturnType<typeof setTimeout> | null = null;

	function disarm() {
		if (strip === 'armed') strip = 'idle';
		if (disarmTimer) clearTimeout(disarmTimer);
		disarmTimer = null;
	}

	async function onStrip() {
		if (strip === 'idle') {
			strip = 'armed';
			disarmTimer = setTimeout(disarm, 4000);
			return;
		}
		if (strip !== 'armed' || !meta) return;
		if (disarmTimer) clearTimeout(disarmTimer);
		strip = 'running';
		const id = metaDialog.folderId;
		try {
			// taking metadata out only makes sense if nothing writes it back: the policy lands first
			if (mode !== opened) {
				await Folder.setMetaMode(id, mode);
				opened = mode;
			}
			const r = await Folder.stripMeta(id);
			stripNote = r.failed
				? `Removed from ${r.touched} · ${r.failed} couldn't be changed`
				: `Removed from ${r.touched} ${r.touched === 1 ? 'file' : 'files'}`;
			const next = await Folder.meta(id);
			meta = { ...next, mode };
		} catch (e) {
			stripNote = `That didn't work: ${String(e)}`;
		}
		strip = 'done';
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') metaDialog.close();
	}

	const OPTIONS: { value: MetaMode; label: string; hint?: string }[] = [
		{ value: 'follow', label: 'Follow parent' },
		{
			value: 'write',
			label: 'Use metadata',
			hint: 'Tags and fields are saved at the top of each file.'
		},
		{ value: 'off', label: "Don't use metadata", hint: 'Files are left exactly as they are.' }
	];
	const options = $derived(isRoot ? OPTIONS.filter((o) => o.value !== 'follow') : OPTIONS);
</script>

<svelte:window onkeydown={metaDialog.open ? onKey : undefined} />

{#if metaDialog.open}
	<div class="overlay" role="presentation" onclick={() => metaDialog.close()}>
		<div
			class="dialog"
			role="dialog"
			aria-label="{name} metadata settings"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<h3 class="title-h">
				<span class="title-chip">
					<span class="title-icon">
						{#if emoji}
							<span class="title-emoji">{emoji}</span>
						{:else if kind === 'project'}
							<Bookmark size={14} strokeWidth={1.75} />
						{:else if kind === 'source'}
							<FolderInput size={14} strokeWidth={1.75} />
						{:else}
							<FolderIcon size={14} strokeWidth={1.75} />
						{/if}
					</span>
					<span class="title-name">{name}</span>
				</span>
				metadata settings
			</h3>

			<!-- the same note, as the file holds it and as Limestone shows it -->
			<div class="diagram" class:off={!writes}>
				<div class="pane">
					<span class="pane-label">In the file</span>
					<div class="file">
						<div class="fm">
							<div class="fm-inner">
								<div class="ln fence">---</div>
								<div class="ln t-tags">
									<span class="k">tags:</span> <span class="v">[lecture]</span>
								</div>
								<div class="ln t-due">
									<span class="k">due:</span> <span class="v">2026-10-02</span>
								</div>
								<div class="ln fence">---</div>
							</div>
						</div>
						<div class="ln h"># Week 5 notes</div>
						<div class="body-fold">
							<div class="fold-inner"><div class="ln body">...</div></div>
						</div>
					</div>
				</div>

				<span class="arrow"><ArrowRight size={16} strokeWidth={1.75} /></span>

				<div class="pane">
					<span class="pane-label">In Limestone</span>
					<div class="app">
						<div class="app-title">Week 5 notes</div>
						<div class="body-fold">
							<div class="fold-inner"><div class="ln body">...</div></div>
						</div>
						<div class="app-row">
							<span class="chip t-tags"><Hash size={11} strokeWidth={2} />lecture</span>
							<span class="chip t-due"><Calendar size={11} strokeWidth={2} />Oct 2</span>
						</div>
					</div>
				</div>
			</div>

			{#if meta?.repo}
				<p class="repo">
					<GitBranch size={13} strokeWidth={1.75} />
					This folder is a Git repo, so metadata written to files shows up in diffs.
				</p>
			{/if}

			<div class="options" role="radiogroup">
				{#each options as o (o.value)}
					<button
						class="opt"
						class:picked={mode === o.value}
						class:slim={!o.hint}
						type="button"
						role="radio"
						aria-checked={mode === o.value}
						onclick={() => (mode = o.value)}
					>
						<span class="radio"></span>
						<span class="opt-text">
							<span class="opt-label">
								{o.label}
								{#if o.value === 'follow'}<span class="default">(default)</span>{/if}
							</span>
							{#if o.hint}<span class="opt-hint">{o.hint}</span>{/if}
						</span>
						{#if o.value === 'follow' && meta}
							<span class="state" class:on={meta.follows}>{meta.follows ? 'On' : 'Off'}</span>
						{/if}
					</button>
				{/each}
			</div>

			<div class="foot">
				<span class="strip-spot">
					{#if strip === 'done'}
						<span class="strip-note">{stripNote}</span>
					{:else if !writes && meta && meta.withFrontmatter > 0}
						<button
							class="strip"
							class:armed={strip === 'armed'}
							type="button"
							disabled={strip === 'running'}
							onclick={onStrip}
							onmouseleave={disarm}
						>
							{strip === 'running'
								? 'Removing…'
								: strip === 'armed'
									? 'Are you sure?'
									: `Remove metadata from ${meta.withFrontmatter} ${meta.withFrontmatter === 1 ? 'file' : 'files'}…`}
						</button>
					{/if}
				</span>
				<button class="btn ghost" type="button" onclick={() => metaDialog.close()}>Cancel</button>
				<button class="btn primary" type="button" disabled={!meta || saving} onclick={save}>
					Save
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 900;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
	}

	.dialog {
		width: 560px;
		max-width: calc(100vw - 32px);
		padding: 24px 20px 20px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 13px;
		color: var(--color-text-primary);
		outline: none;
	}

	.title-h {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 4px 20px;
		font-size: 16px;
		font-weight: 600;
	}

	.title-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		height: 26px;
		padding: 0 10px 0 8px;
		border-radius: 7px;
		background: var(--chip-bg);
		white-space: nowrap;
	}

	.title-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.title-emoji {
		font-size: 14px;
		line-height: 1;
	}

	.title-name {
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 14px;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	/* ── the diagram ── */
	.diagram {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 10px;
		margin: 0 4px;
	}

	.pane {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.pane-label {
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--color-ui-muted);
	}

	.arrow {
		display: inline-flex;
		margin-top: 18px;
		color: var(--color-ui-dulled);
	}

	.file,
	.app {
		min-height: 128px;
		padding: 10px 12px;
		border-radius: 8px;
		background: var(--chip-bg);
	}

	.file {
		font-family: var(--font-mono);
		font-size: 11.5px;
		line-height: 20px;
	}

	/* the block folds away when nothing would be written: the file is just its body */
	.fm {
		display: grid;
		grid-template-rows: 1fr;
		transition:
			grid-template-rows 180ms ease,
			opacity 180ms ease;
	}

	.fm-inner,
	.fold-inner {
		min-height: 0;
		overflow: hidden;
	}

	.diagram.off .fm {
		grid-template-rows: 0fr;
		opacity: 0;
	}

	.body-fold {
		display: grid;
		grid-template-rows: 0fr;
		opacity: 0;
		transition:
			grid-template-rows 180ms ease,
			opacity 180ms ease;
	}

	.diagram.off .body-fold {
		grid-template-rows: 1fr;
		opacity: 1;
	}

	.ln {
		margin: 0 -6px;
		padding: 0 6px;
		border-radius: 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.fence {
		color: var(--color-ui-dulled);
	}

	.k {
		color: var(--color-ui-muted);
	}

	.v {
		color: var(--color-accent);
	}

	.h {
		font-weight: 600;
	}

	.body {
		color: var(--color-ui-muted);
	}

	/* the same colour on both sides: this line becomes that chip */
	.t-tags {
		background: var(--accent-a14);
	}

	.t-due {
		background: rgba(110, 150, 190, 0.18);
	}

	.app {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.app-title {
		font-size: 14px;
		font-weight: 600;
	}

	.app-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		height: 20px;
		padding: 0 8px 0 6px;
		border-radius: 999px;
		font-size: 11.5px;
		color: var(--color-text-secondary);
	}

	.chip :global(svg) {
		opacity: 0.7;
	}

	/* off means no metadata at all: the chips go, their space stays so nothing jumps */
	.app-row {
		transition: opacity 180ms ease;
	}

	.diagram.off .app-row {
		opacity: 0;
	}

	.repo {
		display: flex;
		align-items: center;
		gap: 7px;
		margin: 14px 4px 0;
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	/* ── the choice: the preamble's selectable tiles, stacked ── */
	.options {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 16px 4px 0;
	}

	.opt {
		display: flex;
		align-items: flex-start;
		gap: 11px;
		padding: 11px 13px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: transparent;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			background-color 100ms ease,
			border-color 100ms ease;
	}

	.opt:hover {
		background: var(--chip-bg);
	}

	/* the default is one line, and says what following the parent comes to */
	.opt.slim {
		align-items: center;
		padding-top: 7px;
		padding-bottom: 7px;
	}

	.opt.slim .radio {
		margin-top: 0;
	}

	.default {
		margin-left: 6px;
		font-weight: 400;
		color: var(--color-ui-muted);
	}

	.state {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		min-width: 44px;
		height: 24px;
		margin-left: auto;
		padding: 0 10px;
		border-radius: 7px;
		background: var(--chip-bg);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-ui-muted);
	}

	.state.on {
		color: var(--color-text-primary);
	}

	.opt.picked {
		border-color: var(--color-accent);
		background: var(--accent-a9);
	}

	.radio {
		flex-shrink: 0;
		width: 14px;
		height: 14px;
		margin-top: 2px;
		border: 1.5px solid var(--color-ui-dulled);
		border-radius: 50%;
		transition:
			border-color 100ms ease,
			box-shadow 100ms ease;
	}

	.opt.picked .radio {
		border-color: var(--color-accent);
		box-shadow:
			inset 0 0 0 3px var(--color-bg),
			inset 0 0 0 7px var(--color-accent);
	}

	.opt-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.opt-label {
		font-size: 13.5px;
		font-weight: 600;
	}

	.opt-hint {
		font-size: 12px;
		line-height: 1.4;
		color: var(--color-ui-muted);
	}

	/* ── footer: the strip action as text on the left, buttons on the right ── */
	.foot {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 18px 4px 0;
	}

	.strip-spot {
		flex: 1;
		min-width: 0;
	}

	.strip {
		padding: 0;
		border: none;
		background: transparent;
		font: inherit;
		font-size: 12px;
		color: var(--color-ui-dulled);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}

	.strip:hover {
		color: var(--color-text-secondary);
	}

	.strip.armed {
		color: var(--error-fg);
	}

	.strip:disabled {
		text-decoration: none;
		cursor: progress;
	}

	.strip-note {
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.btn {
		height: 32px;
		padding: 0 14px;
		border: none;
		border-radius: 8px;
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}

	.btn.ghost {
		background: transparent;
		color: var(--color-text-secondary);
	}

	.btn.ghost:hover {
		background: var(--chip-bg);
	}

	.btn.primary {
		background: var(--color-accent);
		font-weight: 600;
		color: #fff;
	}

	.btn.primary:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	.btn.primary:disabled {
		background: var(--chip-bg);
		color: var(--color-ui-dulled);
		cursor: default;
	}
</style>
