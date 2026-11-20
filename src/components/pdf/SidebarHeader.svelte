<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import {
		ArrowLeft,
		ArrowRight,
		Bookmark,
		EllipsisVertical,
		ExternalLink,
		FolderInput,
		FolderOpen,
		ListTree,
		Rows2,
		SlidersHorizontal,
		MessageSquareQuote,
		Plus,
		Trash2,
		X
	} from '@lucide/svelte';
	import { reportError, type MenuEntry } from '#lib/overlays.svelte.js';
	import { moveNote } from '#lib/views/move.svelte.js';
	import MarkdownHandle from '#lib/models/MarkdownHandle.js';
	import type PdfHandle from '#lib/models/PdfHandle.js';
	import { sourceName, listSources, type Source } from '#lib/models/Source.js';
	import { folderId, folderIdPath, folderIdSource } from '#lib/models/Folder.js';
	import { listSavedViewJSON } from '#lib/models/View.svelte.js';
	import { foldersHidden } from '#lib/models/Settings.svelte.js';
	import type Tag from '#lib/models/Tag.js';
	import { tagIcon } from '#lib/views/filterDisplay.js';
	import { folderDir, fileName } from '#lib/views/fieldValue.js';
	import { isValidSegment, nameGuard, segmentProblem } from '#lib/util/paths.js';
	import { flushAll } from '#lib/services/platform.js';
	import type { Place } from '../editor/tabPlaces.js';
	import DocProperties from '../editor/DocProperties.svelte';
	import TodoCard from '../editor/TodoCard.svelte';
	import MoveDialog from '../dialogs/MoveDialog.svelte';
	import TagMenu from '../views/editors/TagMenu.svelte';
	import Menu from '../ui/Menu.svelte';

	let {
		handle,
		onDelete,
		propsOpen = $bindable(false),
		height = $bindable(0),
		back,
		forward,
		onOpenFolder,
		extra,
		sections,
		digest,
		jumps,
		sectionMenu
	}: {
		handle: PdfHandle;
		onDelete?: () => void;
		propsOpen?: boolean;
		height?: number;
		back?: Place;
		forward?: Place;
		onOpenFolder?: (unitId: string, name: string, newTab?: boolean) => void;
		extra?: Snippet;
		sections?: { on: boolean; toggle: () => void };
		digest?: { on: boolean; toggle: () => void };
		jumps?: { back?: Jumps; forward?: Jumps };
		sectionMenu?: { title: string; open: (anchor: HTMLElement) => void };
	} = $props();

	let title = $state(untrack(() => handle.title));
	let syncedTitle = untrack(() => handle.title);
	$effect(() => {
		const current = handle.title;
		untrack(() => {
			if (title === syncedTitle) title = current;
			syncedTitle = current;
		});
	});

	const relPath = $derived(handle.relPath);
	let source = $state<Source>(untrack(() => handle.source));
	let sources: Source[] = $state([]);
	let projects: { unit: string; slug: string; emoji?: string }[] = $state([]);

	onMount(() => {
		listSources()
			.then((ss) => (sources = ss))
			.catch(() => {});
		listSavedViewJSON()
			.then((vs) => {
				projects = vs.flatMap((v) =>
					v.unit?.startsWith('folder:') ? [{ unit: v.unit, slug: v.slug, emoji: v.emoji }] : []
				);
			})
			.catch((e) => console.error('load projects failed', e));
	});

	const ext = $derived(relPath.match(/\.[^.]+$/)?.[0] ?? '.pdf');
	const srcName = $derived(sourceName(source));
	const dirParts = $derived(folderDir(relPath).split('/').filter(Boolean));
	const project = $derived.by(() => {
		for (let depth = dirParts.length; depth >= 0; depth--) {
			const id = folderId(source.id, dirParts.slice(0, depth).join('/'));
			const hit = projects.find((p) => p.unit === id);
			if (hit) return { ...hit, depth };
		}
		return null;
	});
	const hideFolders = $derived(foldersHidden());
	const locParts = $derived(hideFolders ? [] : project ? dirParts.slice(project.depth) : dirParts);
	const fullPath = $derived([srcName, ...dirParts].join(' / '));
	const currentFolderId = $derived(folderId(source.id, folderDir(relPath)));
	const locPlace = $derived.by(() => {
		if (!hideFolders)
			return { id: currentFolderId, name: dirParts.at(-1) ?? srcName, kind: 'folder' };
		if (project) return { id: project.unit, name: project.slug, kind: 'project' };
		return { id: folderId(source.id, ''), name: srcName, kind: 'source' };
	});

	let titleTaken = $state(false);
	let titleCheckToken = 0;
	const titleIllegal = $derived(title.trim() !== '' && !isValidSegment(`${title.trim()}${ext}`));

	function titleCandidate(next: string): string {
		const dir = folderDir(relPath);
		return dir ? `${dir}/${next}${ext}` : `${next}${ext}`;
	}

	$effect(() => {
		const next = title.trim();
		const token = ++titleCheckToken;
		if (!next || next === handle.title) {
			titleTaken = !next;
			return;
		}
		if (titleCandidate(next).toLowerCase() === relPath.toLowerCase()) {
			titleTaken = false;
			return;
		}
		MarkdownHandle.pathTaken(source, titleCandidate(next))
			.then((taken) => {
				if (token === titleCheckToken) titleTaken = taken;
			})
			.catch(() => {});
	});

	async function commitTitle() {
		const next = title.trim();
		if (!next || next === handle.title || !isValidSegment(`${next}${ext}`)) {
			title = handle.title;
			return;
		}
		try {
			const caseOnly = titleCandidate(next).toLowerCase() === relPath.toLowerCase();
			if (!caseOnly && (await MarkdownHandle.pathTaken(source, titleCandidate(next)))) {
				title = handle.title;
				return;
			}
			await handle.rename(next);
		} catch (e) {
			title = handle.title;
			reportError(e, "This PDF couldn't be renamed.");
		}
	}

	function onTitleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') title = handle.title;
		if (e.key === 'Enter' || e.key === 'Escape') {
			e.preventDefault();
			(e.currentTarget as HTMLInputElement).blur();
		}
	}

	let folderOpen = $state(false);

	async function onPickFolder(groupId: string) {
		const target = sources.find((s) => s.id === folderIdSource(groupId)) ?? source;
		const dir = folderIdPath(groupId);
		const file = fileName(relPath);
		const newRel = dir ? `${dir}/${file}` : file;
		if (target.id === source.id && newRel === relPath) return;
		try {
			if (!(await moveNote(handle, target, newRel))) return;
			source = target;
		} catch (e) {
			reportError(e, "This PDF couldn't be moved.", () => onPickFolder(groupId));
		}
	}

	let tagList: Tag[] = $state(untrack(() => handle.tags));
	let tagMenuOpen = $state(false);
	let tagAnchor: HTMLElement | null = $state(null);

	async function saveTags(slugs: string[], retry: () => unknown) {
		try {
			await handle.setTags(slugs);
		} catch (e) {
			reportError(e, "Tags couldn't be saved.", retry);
		}
		tagList = handle.tags;
		tagsSaved++;
	}

	const TODO_ID = 'tag:todo';
	let tagsSaved = $state(0);
	const isTodo = $derived(tagList.some((t) => t.id === TODO_ID));
	const chipTags = $derived(tagList.filter((t) => t.id !== TODO_ID));

	function removeTodo() {
		const t = tagList.find((x) => x.id === TODO_ID);
		if (t) void toggleTag(t);
	}

	function toggleTag(tag: Tag): Promise<void> {
		const has = tagList.some((t) => t.id === tag.id);
		const next = has ? tagList.filter((t) => t.id !== tag.id) : [...tagList, tag];
		tagList = next;
		return saveTags(
			next.map((t) => t.slug),
			() => toggleTag(tag)
		);
	}

	function createTag(q: string): Promise<void> {
		const slug = q.trim();
		if (!slug || tagList.some((t) => t.slug === slug)) return Promise.resolve();
		return saveTags([...tagList.map((t) => t.slug), slug], () => createTag(q));
	}

	async function tagsMutated() {
		try {
			await handle.fetchTags();
			tagList = handle.tags;
		} catch (e) {
			console.error('refresh tags failed', e);
		}
	}

	interface Jumps {
		label: string;
		places: { page: number; section?: string }[];
		go: (steps?: number) => void;
	}

	const HOLD_MS = 400;
	const HOVER_MS = 700;
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;
	let jumpsOpen = $state(false);
	let jumpsDir: 'back' | 'forward' = $state('back');
	let jumpsAnchor: HTMLElement | null = $state(null);
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let held = false;

	const jumpItems: MenuEntry[] = $derived(
		(jumps?.[jumpsDir]?.places ?? []).map((p, i) => ({
			value: String(i + 1),
			label: `Page ${p.page}`,
			hint: p.section
		}))
	);

	function openJumps(dir: 'back' | 'forward', anchor: HTMLElement) {
		jumpsDir = dir;
		jumpsAnchor = anchor;
		jumpsOpen = true;
	}

	function holdJumps(dir: 'back' | 'forward', anchor: HTMLElement) {
		held = false;
		clearTimeout(hoverTimer);
		clearTimeout(holdTimer);
		holdTimer = setTimeout(() => {
			held = true;
			openJumps(dir, anchor);
		}, HOLD_MS);
	}

	function clickJump(dir: 'back' | 'forward') {
		if (held) held = false;
		else jumps?.[dir]?.go();
	}

	let menuOpen = $state(false);
	let menuAnchor: HTMLElement | null = $state(null);
	let confirmingDelete = $state(false);
	let propCount = $state(0);

	$effect(() => {
		if (!menuOpen) confirmingDelete = false;
	});

	const menuItems: MenuEntry[] = $derived([
		...(propCount > 0 || isTodo
			? [
					{
						value: 'props',
						label: propsOpen ? 'Hide properties' : 'Show properties',
						icon: SlidersHorizontal
					} as MenuEntry
				]
			: []),
		...(sections
			? [
					{
						value: 'sections',
						label: 'One section at a time',
						icon: Rows2,
						hint: sections.on ? 'On' : 'Off'
					} as MenuEntry
				]
			: []),
		...(propCount > 0 || isTodo || sections ? [{ kind: 'divider' } as MenuEntry] : []),
		...(onOpenFolder
			? [{ value: 'parent', label: `Go to ${locPlace.kind}`, icon: FolderOpen } as MenuEntry]
			: []),
		{ value: 'reveal', label: 'Reveal in file manager', icon: ExternalLink },
		confirmingDelete
			? { value: 'confirm-delete', label: 'Confirm delete', icon: Trash2, danger: true }
			: { value: 'delete', label: 'Delete document', icon: Trash2, keepOpen: true }
	]);

	async function revealDoc() {
		try {
			await flushAll();
			await revealItemInDir(`${source.path}/${relPath}`);
		} catch (e) {
			console.error('reveal failed', e);
		}
	}

	function onMenuSelect(value: string) {
		if (value === 'delete') {
			confirmingDelete = true;
			return;
		}
		menuOpen = false;
		if (value === 'props') propsOpen = !propsOpen;
		if (value === 'sections') sections?.toggle();
		if (value === 'parent') onOpenFolder?.(locPlace.id, locPlace.name);
		if (value === 'reveal') void revealDoc();
		if (value === 'confirm-delete') onDelete?.();
	}
</script>

{#snippet place(p: Place)}
	<span class="place">
		{#if p.emoji}
			<span class="place-emoji">{p.emoji}</span>
		{:else}
			<p.icon size={12} strokeWidth={1.75} />
		{/if}
		<span class="place-label">{p.label}</span>
	</span>
{/snippet}

<div class="side-head" bind:offsetHeight={height}>
	<div class="title-line">
		{#if back || forward}
			<div class="nav">
				{#if back}
					<button class="chip" type="button" title={back.label} onclick={back.go}>
						<span class="arrow"><ArrowLeft size={14} strokeWidth={2} /></span>
						{@render place(back)}
					</button>
				{/if}
				{#if forward}
					<button class="chip" type="button" title={forward.label} onclick={forward.go}>
						{@render place(forward)}
						<span class="arrow"><ArrowRight size={14} strokeWidth={2} /></span>
					</button>
				{/if}
			</div>
		{/if}
		{#if jumps}
			{#each ['back', 'forward'] as const as dir (dir)}
				<button
					class="kebab jump"
					type="button"
					title={jumps[dir]?.label}
					disabled={!jumps[dir]}
					onclick={() => clickJump(dir)}
					onpointerdown={(e) => e.button === 0 && holdJumps(dir, e.currentTarget)}
					onpointerup={() => clearTimeout(holdTimer)}
					onpointerenter={(e) => {
						const anchor = e.currentTarget;
						hoverTimer = setTimeout(() => openJumps(dir, anchor), HOVER_MS);
					}}
					onpointerleave={() => {
						clearTimeout(holdTimer);
						clearTimeout(hoverTimer);
					}}
					oncontextmenu={(e) => {
						e.preventDefault();
						openJumps(dir, e.currentTarget);
					}}
				>
					{#if dir === 'back'}
						<ArrowLeft size={14} strokeWidth={1.75} />
					{:else}
						<ArrowRight size={14} strokeWidth={1.75} />
					{/if}
				</button>
			{/each}
			<span class="sep tall"></span>
		{/if}
		<span class="title-field">
			<span class="title-ghost">{title || ' '}</span>
			<input
				class="title-input"
				class:invalid={titleTaken || titleIllegal}
				title={titleIllegal
					? (segmentProblem(`${title.trim()}${ext}`) ?? undefined)
					: titleTaken
						? 'A document with this name is already in this folder.'
						: title}
				bind:value={title}
				use:nameGuard
				onblur={commitTitle}
				onkeydown={onTitleKeydown}
				spellcheck="false"
			/>
		</span>
		<span class="sep"></span>
		<div class="meta-row">
			<button
				class="loc-chip"
				type="button"
				title="Move document from {fullPath}"
				onclick={() => (folderOpen = !folderOpen)}
			>
				{#if project?.emoji}
					<span class="loc-emoji">{project.emoji}</span>
				{:else if project}
					<Bookmark size={12} />
				{:else}
					<FolderInput size={12} />
				{/if}
				<span class="loc-part src">{project?.slug ?? srcName}</span>
				{#each locParts as part}
					<span class="crumb-sep">/</span>
					<span class="loc-part">{part}</span>
				{/each}
			</button>
			<span
				class="tags-chip"
				bind:this={tagAnchor}
				role="button"
				tabindex="-1"
				title={tagMenuOpen ? '' : 'Edit tags'}
				onclick={() => (tagMenuOpen = !tagMenuOpen)}
			>
				{#each chipTags as t (t.id)}
					{@const Icon = tagIcon(t.id)}
					<span class="tag">
						<Icon size={11} />{t.slug}
						<button
							class="tag-x"
							type="button"
							tabindex="-1"
							aria-label="Remove {t.slug}"
							onclick={(e) => {
								e.stopPropagation();
								void toggleTag(t);
							}}
						>
							<X size={9} strokeWidth={2.5} />
						</button>
					</span>
				{/each}
				{#if !chipTags.length}
					<span class="add-tags"><Plus size={11} />tag</span>
				{/if}
			</span>
			{#if isTodo && propsOpen}
				<span class="sep"></span>
				<TodoCard {handle} version={tagsSaved} onRemove={removeTodo} />
			{/if}
		</div>
		{#if extra}
			<div class="extra">{@render extra()}</div>
		{/if}
		{#if sectionMenu}
			<button
				class="kebab"
				type="button"
				title="Section: {sectionMenu.title}"
				onclick={(e) => sectionMenu.open(e.currentTarget)}
			>
				<ListTree size={15} strokeWidth={1.75} />
			</button>
		{/if}
		{#if digest}
			<button
				class="kebab"
				class:on={digest.on}
				type="button"
				title={digest.on ? 'Back to pages' : 'Annotations digest'}
				onclick={digest.toggle}
			>
				<MessageSquareQuote size={15} strokeWidth={1.75} />
			</button>
		{/if}
		<button
			class="kebab"
			bind:this={menuAnchor}
			title="More"
			onclick={() => (menuOpen = !menuOpen)}
		>
			<EllipsisVertical size={15} strokeWidth={1.75} />
		</button>
	</div>
	<DocProperties {handle} open={propsOpen} onCount={(n) => (propCount = n)} />
</div>

<Menu
	bind:open={menuOpen}
	anchor={menuAnchor}
	items={menuItems}
	onSelect={onMenuSelect}
	minWidth={140}
/>
<Menu
	bind:open={jumpsOpen}
	anchor={jumpsAnchor}
	items={jumpItems}
	onSelect={(value) => {
		jumpsOpen = false;
		jumps?.[jumpsDir]?.go(Number(value));
	}}
	minWidth={160}
/>
<MoveDialog bind:open={folderOpen} value={currentFolderId} name={title} onMove={onPickFolder} />
<TagMenu
	bind:open={tagMenuOpen}
	anchor={tagAnchor}
	selectedIds={tagList.map((t) => t.id)}
	onToggle={toggleTag}
	onCreate={createTag}
	onMutated={tagsMutated}
	builtinAddOnly
/>

<style>
	.side-head {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		padding: 6px 8px 6px 12px;
		border-radius: 8px;
		background: var(--chip-bg);
		font-family: var(--font-ui);
	}

	.title-line {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
	}

	.sep {
		flex-shrink: 0;
		width: 1px;
		height: 16px;
		margin: 0 6px;
		background: var(--color-border);
	}

	.title-field {
		position: relative;
		display: inline-flex;
		flex: 0 100 auto;
		min-width: 48px;
	}

	.title-ghost {
		overflow: hidden;
		visibility: hidden;
		white-space: pre;
	}

	.title-ghost,
	.title-input {
		min-width: 0;
		padding: 0;
		font-family: var(--font-ui);
		font-size: 14px;
		font-weight: 600;
		line-height: 24px;
		letter-spacing: -0.01em;
	}

	.title-input {
		position: absolute;
		inset: 0;
		width: 100%;
		border: none;
		outline: none;
		background: transparent;
		color: var(--color-text-primary);
		text-overflow: ellipsis;
	}

	.title-input.invalid {
		text-decoration: underline;
		text-decoration-color: var(--error-fg);
		text-underline-offset: 3px;
	}

	.kebab {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		padding: 0;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-dulled);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.kebab.jump:first-child {
		margin-left: -14px;
	}

	.kebab:last-child {
		margin-right: -14px;
	}

	.kebab.jump + .kebab.jump {
		margin-left: -4px;
	}

	.sep.tall {
		align-self: stretch;
		height: auto;
		margin: -9px 4px;
		background: var(--color-bg);
	}

	.kebab:disabled {
		opacity: 0.35;
		pointer-events: none;
	}

	.kebab:hover,
	.kebab.on {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.loc-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 100%;
		height: 24px;
		padding: 0 8px;
		border: none;
		border-radius: 6px;
		background: var(--chip-bg);
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 12px;
		white-space: nowrap;
		cursor: pointer;
		transition: color 120ms ease;
	}

	.loc-chip:hover {
		color: var(--color-text-primary);
	}

	.loc-chip :global(svg) {
		flex-shrink: 0;
	}

	.loc-emoji {
		font-size: 11px;
		line-height: 1;
	}

	.loc-part {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.loc-part.src {
		color: var(--color-text-secondary);
	}

	.crumb-sep {
		opacity: 0.5;
	}

	.meta-row {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		gap: 6px;
		min-width: 0;
		overflow: hidden;
	}

	.meta-row > :global(*) {
		flex-shrink: 0;
	}

	.tags-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		cursor: pointer;
	}

	.tag,
	.add-tags {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		height: 24px;
		padding: 0 9px 0 6px;
		border-radius: 999px;
		background: var(--chip-bg);
		color: var(--color-ui-dulled);
		font-family: var(--font-ui);
		font-size: 11px;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.add-tags {
		color: var(--color-ui-muted);
	}

	.tag :global(svg) {
		opacity: 0.7;
	}

	.tags-chip:hover .tag,
	.tags-chip:hover .add-tags {
		background: var(--chip-bg-hover);
	}

	.tag-x {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		margin: 0 -4px 0 1px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: inherit;
		opacity: 0.55;
		cursor: pointer;
	}

	.tag-x:hover {
		opacity: 1;
		background: rgba(127, 127, 127, 0.25);
	}

	.extra {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.nav {
		display: inline-flex;
		gap: 4px;
		height: 24px;
		max-width: 100%;
	}

	.chip {
		display: inline-flex;
		align-items: stretch;
		min-width: 0;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: var(--chip-bg);
		overflow: hidden;
		font-family: var(--font-ui);
		font-size: 12px;
		font-weight: 500;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.chip:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.arrow {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		padding: 0 7px;
		background: var(--accent-a14);
		color: var(--color-accent);
	}

	.place {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		padding: 0 8px 0 7px;
	}

	.place > :global(svg) {
		flex-shrink: 0;
	}

	.place-emoji {
		font-size: 10px;
		line-height: 1;
	}

	.place-label {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
</style>
