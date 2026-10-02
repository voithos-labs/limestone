<script lang="ts">
	import DocHandle from '$lib/models/DocHandle';
	import { sourceName, listSources, onSourceReconciled, type Source } from '$lib/models/Source';
	import Folder, { folderId, folderIdPath, folderIdSource } from '$lib/models/Folder';
	import type Tag from '$lib/models/Tag';
	import { tagId } from '$lib/models/Tag';
	import { formatDateFriendly } from '$lib/views/dateFormat';
	import { folderDir, fileName } from '$lib/views/fieldValue';
	import { folderPath } from '$lib/views/createDefaults';
	import { isValidSegment } from '$lib/util/paths';
	import type { MenuEntry } from '$lib/views/menuTypes';
	import Menu from './views/Menu.svelte';
	import TagMenu from './views/TagMenu.svelte';
	import MoveDialog from './MoveDialog.svelte';
	import DocProperties from './views/DocProperties.svelte';
	import TodoCard from './TodoCard.svelte';
	import {
		Hash,
		EllipsisVertical,
		Trash2,
		FolderInput,
		FolderOpen,
		Plus,
		Copy,
		SlidersHorizontal,
		ExternalLink,
		TriangleAlert,
		FileText,
		RefreshCw,
		History,
		ArrowLeft,
		X,
		GitBranch,
		FileLock,
		ArrowUpRight
	} from '@lucide/svelte';
	import { onMount, untrack, type Component } from 'svelte';
	import { readTextFile } from '@tauri-apps/plugin-fs';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { flushAll } from '$lib/util/flush';

	let {
		handle,
		onDelete,
		onDuplicated,
		compact = false,
		loaded = true,
		frontmatterError = null,
		onFrontmatterFix,
		propsOpen = $bindable(false),
		historyOpen = $bindable(false),
		back,
		onOpenFolder,
		showOpenFolder = true,
		onFolderMeta,
		textTags = [],
		onTextTag,
		onRemoveTextTag
	}: {
		handle: DocHandle;
		onDelete?: () => void;
		onDuplicated?: (copy: DocHandle) => void;
		compact?: boolean;
		loaded?: boolean;
		frontmatterError?: string | null;
		onFrontmatterFix?: (mode: 'keep' | 'rebuild') => void;
		propsOpen?: boolean;
		historyOpen?: boolean;
		// where this tab was before, if it navigated here
		back?: { label: string; icon: Component; emoji?: string; go: () => void };
		onOpenFolder?: (unitId: string, name: string, newTab?: boolean) => void;
		showOpenFolder?: boolean;
		onFolderMeta?: (unitId: string, name: string) => void; // the folder, and its metadata setting
		// tags written in the note's text; shown read-only, and a click finds them in the text
		textTags?: { slug: string; places: unknown[] }[];
		onTextTag?: (slug: string) => void;
		onRemoveTextTag?: (slug: string) => Promise<void>;
	} = $props();

	let fmMenuOpen = $state(false);
	let fmAnchor: HTMLElement | null = $state(null);

	const fmItems: MenuEntry[] = [
		{ value: 'keep', label: 'Keep as text', icon: FileText },
		{ value: 'rebuild', label: 'Discard and rebuild', icon: RefreshCw, danger: true },
		{ kind: 'divider' },
		{ value: 'reveal', label: 'Reveal in file manager', icon: ExternalLink }
	];

	function onFmSelect(value: string) {
		fmMenuOpen = false;
		if (value === 'reveal') revealDoc();
		else onFrontmatterFix?.(value as 'keep' | 'rebuild');
	}

	let title = $state(untrack(() => handle.title));
	const wasNew = untrack(() => handle.isNew);
	const draftTitle = untrack(() => handle.title);
	let relPath = $state(untrack(() => handle.relPath));
	let source = $state<Source>(untrack(() => handle.source));
	let meta = $state(untrack(() => ({ writes: handle.writesMeta, repo: handle.inRepo })));
	const syncMeta = () => (meta = { writes: handle.writesMeta, repo: handle.inRepo });
	let folderList: Folder[] = $state([]);
	let sources: Source[] = $state([]);
	let tagList: Tag[] = $state(untrack(() => (loaded ? handle.tags : [])));

	$effect(() => {
		if (loaded) tagList = handle.tags;
	});

	const folders = $derived(folderList);

	let tagMenuOpen = $state(false);
	let tagsSaved = $state(0);
	let tagAnchor: HTMLElement | null = $state(null);

	async function createTag(q: string) {
		const slug = q.trim();
		if (!slug || tagList.some((t) => t.slug === slug)) return;
		try {
			await handle.setTags([...tagList.map((t) => t.slug), slug]);
			tagList = handle.tags;
			tagsSaved++;
		} catch (e) {
			console.error('create tag failed', e);
		}
	}

	async function toggleTag(tag: Tag) {
		const inText = textTagPlaces.has(tag.id);
		const has = tagList.some((t) => t.id === tag.id);
		if (inText) {
			try {
				await onRemoveTextTag?.(tag.slug);
			} catch (e) {
				console.error('remove text tag failed', e);
			}
			if (!has) return;
		}
		const next = has ? tagList.filter((t) => t.id !== tag.id) : [...tagList, tag];
		tagList = next;
		try {
			await handle.setTags(next.map((t) => t.slug));
			tagList = handle.tags;
			tagsSaved++;
		} catch (e) {
			console.error('set tags failed', e);
			tagList = handle.tags;
		}
	}

	// the tag chip edits in place: open, and the chips grow an ×; the menu under it searches

	// the todo card carries #todo: it's not among the chips, and its × is the way off
	const TODO_ID = 'tag:todo';
	const isTodo = $derived(tagList.some((t) => t.id === TODO_ID));
	const chipTags = $derived(tagList.filter((t) => t.id !== TODO_ID));
	// a tag in both the frontmatter and the text is the frontmatter's chip, so it shows once
	const textTagPlaces = $derived(new Map(textTags.map((t) => [tagId(t.slug), t.places.length])));
	const textOnlyTags = $derived(
		textTags.filter((t) => !tagList.some((x) => x.id === tagId(t.slug)))
	);
	function removeTodo() {
		const t = tagList.find((x) => x.id === TODO_ID);
		if (t) void toggleTag(t);
	}

	async function tagsMutated() {
		try {
			await handle.fetchTags();
			tagList = handle.tags;
		} catch (e) {
			console.error('refresh tags failed', e);
		}
	}

	$effect(() =>
		onSourceReconciled(async (sourceId) => {
			if (sourceId !== source.id) return;
			if (await handle.refreshPath()) relPath = handle.relPath;
			await handle.refreshMeta();
			syncMeta();
		})
	);

	const ext = $derived(relPath.match(/\.[^.]+$/)?.[0] ?? '.md');
	const srcName = $derived(sourceName(source));
	const dirParts = $derived(folderDir(relPath).split('/').filter(Boolean));

	const currentFolderId = $derived.by(() => {
		const dir = folderDir(relPath);

		// EXAMPLE: this is shit code I wrote that was making it walk the damn entire folder tree, noticable
		// first open delay. DNR.
		// if (!dir) return null;
		// return (
		// 		folders.find((f) => f.sourceId === source.id && folderPath(f.id) === dir)?.id ?? null
		// );

		return folderId(source.id, dir);
	});

	// ── Title rename ───────────────────────────────────────────────────────────
	let titleInput: HTMLInputElement | null = $state(null);
	let titleTaken = $state(false);
	// catch & display os-level errors, etc.
	let titleFailed = $state(false);
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
		DocHandle.pathTaken(source, titleCandidate(next)).then((taken) => {
			if (token === titleCheckToken) titleTaken = taken;
		});
	});

	async function commitTitle() {
		const next = title.trim();
		if (!next || next === handle.title || !isValidSegment(`${next}${ext}`)) {
			title = handle.title;
			return;
		}
		try {
			const caseOnly = titleCandidate(next).toLowerCase() === relPath.toLowerCase();
			if (!caseOnly && (await DocHandle.pathTaken(source, titleCandidate(next)))) {
				title = handle.title;
				return;
			}
			await handle.rename(next);
			relPath = handle.relPath;
		} catch (e) {
			console.error('rename failed', e);
			title = handle.title;
			titleFailed = true;
		}
	}

	function onTitleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			(e.currentTarget as HTMLInputElement).blur();
		} else if (e.key === 'Escape') {
			title = handle.title;
			(e.currentTarget as HTMLInputElement).blur();
		}
	}

	// ── Move flow ──────────────────────────────────────────────────────────────
	// One location chip unscoped folder picker (sources are selectable roots).
	// Nothing moves until a folder or source is picked.
	let folderOpen = $state(false);
	let pickAnchor: HTMLElement | null = $state(null);

	async function onPickFolder(groupId: string, path?: string) {
		const targetSourceId = folderIdSource(groupId);
		const target = sources.find((s) => s.id === targetSourceId) ?? source;
		const dir = path ?? folderIdPath(groupId);
		const file = fileName(relPath);
		const newRel = dir ? `${dir}/${file}` : file;
		if (target.id === source.id && newRel === relPath) return;
		try {
			if (target.id === source.id) {
				await handle.moveToPath(newRel);
			} else {
				await handle.moveToSource(target, newRel);
				source = target;
			}
			relPath = newRel;
			syncMeta();
			folderList = await Folder.list();
		} catch (e) {
			console.error('move failed', e);
		}
	}

	// ── Kebab menu ─────────────────────────────────────────────────────────────
	let menuOpen = $state(false);
	let menuAnchor: HTMLElement | null = $state(null);

	// The back card sits above the title, and lifts off to float at the top of the scroller once
	// the reader scrolls past it. Its slot keeps the space so the document doesn't jump
	let innerEl: HTMLElement | null = $state(null);
	let innerWidth = $state(0);
	let backSlot: HTMLElement | null = $state(null);
	let backEl: HTMLElement | null = $state(null);
	let floating = $state(false);
	let floatAt = $state({ x: 0, y: 0 });
	const FLOAT_INSET = 14;
	$effect(() => {
		void innerWidth;
		const slot = backSlot;
		const inner = innerEl;
		if (!slot || !inner) return;
		let scroller: HTMLElement | null = slot.parentElement;
		while (scroller) {
			const oy = getComputedStyle(scroller).overflowY;
			if (oy === 'auto' || oy === 'scroll') break;
			scroller = scroller.parentElement;
		}
		if (!scroller) return;
		const update = () => {
			const top = scroller!.getBoundingClientRect().top + FLOAT_INSET;
			const r = slot.getBoundingClientRect();
			floating = r.top < top;
			floatAt = { x: r.left, y: top };
		};
		update();
		scroller.addEventListener('scroll', update, { passive: true });
		window.addEventListener('resize', update);
		return () => {
			scroller!.removeEventListener('scroll', update);
			window.removeEventListener('resize', update);
		};
	});
	let confirmingDelete = $state(false);

	// Properties panel: the toggle lives in the meta bar, the panel renders below.
	// Open state is owned by the caller so it can be persisted on the tab.
	let propCount = $state(0);

	$effect(() => {
		if (!menuOpen) confirmingDelete = false;
	});

	$effect(() => {
		if (folderOpen || tagMenuOpen) return;
		if (!wasNew || handle.title !== draftTitle) return;
		const active = document.activeElement;
		if (active && active !== document.body && active !== pickAnchor && active !== tagAnchor) return;
		titleInput?.focus();
		titleInput?.select();
	});

	let metaRow: HTMLElement | null = $state(null);
	$effect(() => {
		const row = metaRow;
		if (!row) return;
		const mark = () => {
			for (const sep of row.querySelectorAll<HTMLElement>('[data-sep]')) {
				const next = sep.nextElementSibling;
				const wrapped =
					!next || next.getBoundingClientRect().top >= sep.getBoundingClientRect().bottom;
				sep.style.visibility = wrapped ? 'hidden' : '';
			}
		};
		const resize = new ResizeObserver(mark);
		resize.observe(row);
		const mutate = new MutationObserver(mark);
		mutate.observe(row, { childList: true, subtree: true });
		mark();
		return () => {
			resize.disconnect();
			mutate.disconnect();
		};
	});

	let lineWidth = $state(0);
	let titleWidth = $state(0);
	let actionsMeasured = $state(0);
	let actionsWidth = $state(0);
	$effect(() => {
		if (actionsMeasured > 0) actionsWidth = actionsMeasured;
	});
	const showProps = $derived(propCount > 0 && !(meta.writes && frontmatterError));
	const actionsInMenu = $derived(lineWidth > 0 && titleWidth + 12 + actionsWidth > lineWidth - 30);

	const menuItems: MenuEntry[] = $derived([
		...(actionsInMenu
			? ([
					{
						value: 'history',
						label: historyOpen ? 'Hide history' : 'Show history',
						icon: History
					},
					...(showProps
						? [
								{
									value: 'props',
									label: propsOpen ? 'Hide properties' : 'Show properties',
									icon: SlidersHorizontal
								}
							]
						: []),
					{ kind: 'divider' }
				] as MenuEntry[])
			: []),
		...(onOpenFolder
			? [{ value: 'parent', label: 'Go to folder', icon: FolderOpen } as MenuEntry]
			: []),
		{ value: 'duplicate', label: 'Duplicate document', icon: Copy },
		{ value: 'reveal', label: 'Reveal in file manager', icon: ExternalLink },
		confirmingDelete
			? { value: 'confirm-delete', label: 'Confirm delete', icon: Trash2, danger: true }
			: { value: 'delete', label: 'Delete document', icon: Trash2, keepOpen: true }
	]);

	async function duplicateDoc() {
		try {
			await flushAll();
			const raw = await readTextFile(`${source.path}/${relPath}`).catch(() => '');
			const { body } = DocHandle.deserialize(raw);
			const dir = folderDir(relPath);
			const newRel = await DocHandle.uniqueRelPath(source, dir, `${handle.title} copy`);
			const newTitle = newRel.split('/').pop()!.replace(/\.md$/i, '');
			const copy = await DocHandle.create(
				source,
				newTitle,
				newRel,
				handle.tags.map((t) => t.id),
				JSON.parse(JSON.stringify(handle.properties))
			);
			await copy.saveContent(body);
			onDuplicated?.(copy);
		} catch (e) {
			console.error('duplicate failed', e);
		}
	}

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
		if (value === 'history') historyOpen = !historyOpen;
		if (value === 'props') propsOpen = !propsOpen;
		if (value === 'parent') onOpenFolder?.(currentFolderId, dirParts.at(-1) ?? srcName);
		if (value === 'duplicate') duplicateDoc();
		if (value === 'reveal') revealDoc();
		if (value === 'confirm-delete') onDelete?.();
	}

	onMount(() => {
		if (wasNew) {
			titleInput?.focus();
			titleInput?.select();
		}
		Folder.list()
			.then((fs) => (folderList = fs))
			.catch(() => {});
		listSources()
			.then((ss) => (sources = ss))
			.catch(() => {});
		// the handle this hero mounted with: by teardown the prop may have moved on, and it is
		// this document's opening that wants recording
		const opened = handle;
		return () => opened?.markOpened();
	});
</script>

{#snippet backCard()}
	{#if back}
		<div class="back-slot" bind:this={backSlot}>
			<button
				class="back"
				class:floating
				bind:this={backEl}
				style:left={floating ? `${floatAt.x}px` : null}
				style:top={floating ? `${floatAt.y}px` : null}
				type="button"
				title="Back"
				onclick={back.go}
			>
				<span class="back-arrow"><ArrowLeft size={14} strokeWidth={2} /></span>
				<span class="back-place">
					{#if back.emoji}
						<span class="back-emoji">{back.emoji}</span>
					{:else}
						<back.icon size={12} strokeWidth={1.75} />
					{/if}
					<span class="back-label">{back.label}</span>
				</span>
			</button>
		</div>
	{/if}
{/snippet}

<div class="doc-hero">
	<div class="hero-inner" class:compact bind:this={innerEl} bind:clientWidth={innerWidth}>
		{#if back}{@render backCard()}{/if}
		<div class="head-row">
			<div class="title-line" bind:clientWidth={lineWidth}>
				<span class="title-left">
					<span class="title-field">
						<span class="title-ghost" bind:offsetWidth={titleWidth}>{title || ' '}</span>
						<input
							class="title-input"
							class:invalid={titleTaken || titleIllegal || titleFailed}
							bind:this={titleInput}
							bind:value={title}
							oninput={() => (titleFailed = false)}
							onblur={commitTitle}
							onkeydown={onTitleKeydown}
							spellcheck="false"
						/>
					</span>
				</span>
				<div class="top-actions">
					{#if !actionsInMenu}
						<span class="collapsible" bind:offsetWidth={actionsMeasured}>
							<button
								class="props-chip history-chip"
								class:open={historyOpen}
								title={historyOpen ? 'Hide history' : 'Show history'}
								onclick={() => (historyOpen = !historyOpen)}
							>
								<History size={12} strokeWidth={1.75} />
								<span>Updated {formatDateFriendly(handle.updatedAt)}</span>
							</button>
							{#if showProps}
								<button
									class="props-chip"
									class:open={propsOpen}
									title={propsOpen ? 'Hide properties' : 'Show properties'}
									onclick={() => (propsOpen = !propsOpen)}
								>
									<SlidersHorizontal size={12} strokeWidth={1.75} />
									<span class="props-count">{propCount}</span>
								</button>
							{/if}
						</span>
					{/if}
					{#if meta.writes && frontmatterError}
						<button
							class="props-chip fm-error"
							class:open={fmMenuOpen}
							bind:this={fmAnchor}
							title="Frontmatter couldn't be parsed"
							onclick={() => (fmMenuOpen = !fmMenuOpen)}
						>
							<TriangleAlert size={12} strokeWidth={1.75} />
						</button>
					{/if}
				</div>
				<button
					class="kebab"
					bind:this={menuAnchor}
					title="More"
					onclick={() => (menuOpen = !menuOpen)}
				>
					<EllipsisVertical size={15} strokeWidth={1.75} />
				</button>
			</div>

			<div class="meta-row" bind:this={metaRow}>
				<span class="loc-stack" class:stacked={!!onOpenFolder && showOpenFolder}>
					<button
						class="loc-chip"
						bind:this={pickAnchor}
						title="Move document"
						onclick={() => (folderOpen = !folderOpen)}
					>
						<FolderInput size={12} />
						<span class="loc-part src">{srcName}</span>
						{#each dirParts as part}
							<span class="crumb-sep">/</span>
							<span class="loc-part">{part}</span>
						{/each}
					</button>
					{#if onOpenFolder && showOpenFolder}
						<button
							class="loc-open"
							type="button"
							title="Open folder in a new tab"
							onclick={() => onOpenFolder(currentFolderId, dirParts.at(-1) ?? srcName, true)}
						>
							<ArrowUpRight size={12} />
						</button>
					{/if}
				</span>
				{#if !meta.writes}
					<button
						class="props-chip meta-off"
						class:linked={!!onFolderMeta}
						type="button"
						disabled={!onFolderMeta}
						title={meta.repo
							? "Inside a Git repo: metadata isn't written to this file. Click to change it for the folder"
							: "This folder doesn't store metadata in its files. Click to change it for the folder"}
						onclick={() => onFolderMeta?.(currentFolderId, dirParts.at(-1) ?? srcName)}
					>
						{#if meta.repo}<GitBranch size={12} strokeWidth={1.75} />{:else}<FileLock
								size={12}
								strokeWidth={1.75}
							/>{/if}
					</button>
					{#each tagList as t (t.id)}
						<span class="tag"><Hash size={11} />{t.slug}</span>
					{/each}
				{:else}
					<span
						class="tags-chip"
						class:has-tags={chipTags.length > 0}
						class:editing={tagMenuOpen}
						bind:this={tagAnchor}
						role="button"
						tabindex="-1"
						title={tagMenuOpen ? '' : 'Edit tags'}
						onclick={() => (tagMenuOpen = !tagMenuOpen)}
					>
						{#each chipTags as t (t.id)}
							<span class="tag">
								<Hash size={11} />{t.slug}
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
				{/if}
				{#each textOnlyTags as t (t.slug)}
					<button
						class="tag from-text"
						type="button"
						title="Tagged in the text. Click to find it"
						onclick={() => onTextTag?.(t.slug)}
					>
						<Hash size={11} />{t.slug}
					</button>
				{/each}
				{#if meta.writes && isTodo}
					<span class="meta-sep" data-sep></span>
					<TodoCard {handle} version={tagsSaved} onRemove={removeTodo} />
				{/if}
				{#if meta.writes}
					<DocProperties {handle} open={propsOpen} inline onCount={(n) => (propCount = n)} />
				{/if}
			</div>
		</div>
	</div>
</div>

<Menu
	bind:open={menuOpen}
	anchor={menuAnchor}
	items={menuItems}
	onSelect={onMenuSelect}
	minWidth={140}
/>

<Menu bind:open={fmMenuOpen} anchor={fmAnchor} items={fmItems} onSelect={onFmSelect} minWidth={220}>
	{#snippet header()}
		<div class="fm-error-head">
			<span class="fm-error-title">Frontmatter couldn't be parsed</span>
			<span class="fm-error-msg">{frontmatterError}</span>
			<span class="fm-error-msg"
				>Fix it in place, keep it as text under new frontmatter, or rebuild from what the app has
				(tags and properties in the block are not recovered).</span
			>
		</div>
	{/snippet}
</Menu>
<MoveDialog
	bind:open={folderOpen}
	value={currentFolderId}
	name={title}
	onMove={(id) => onPickFolder(id)}
/>
<TagMenu
	bind:open={tagMenuOpen}
	anchor={tagAnchor}
	selectedIds={[...tagList.map((t) => t.id), ...textTagPlaces.keys()]}
	inText={textTagPlaces}
	onToggle={toggleTag}
	onCreate={createTag}
	onMutated={tagsMutated}
/>

<style>
	.doc-hero {
		flex-shrink: 0;
	}

	.hero-inner {
		position: relative;
		max-width: var(--page-max-width, 1200px);
		margin: 0 auto;
		padding: 34px 24px 20px;
	}

	.hero-inner.compact {
		padding: 2px 24px 6px;
	}

	.meta-sep {
		flex-shrink: 0;
		width: 1px;
		height: 16px;
		margin: 0 4px;
		background: var(--color-border);
	}

	.top-actions,
	.collapsible {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		gap: 4px;
	}

	.title-line {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.title-left {
		display: flex;
		align-items: baseline;
		flex: 1 1 auto;
		min-width: 0;
	}

	.title-field {
		position: relative;
		display: inline-flex;
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
	}

	/* Pinned: the hero is the editor's header, so it would inherit the document's 1.6
	   line-height and the 22px kebab beside the title would no longer centre on it. */
	.title-ghost,
	.title-input {
		font-family: var(--font-ui);
		font-size: 18px;
		font-weight: 600;
		line-height: 22px;
		letter-spacing: -0.01em;
		padding: 0;
	}

	.title-ghost {
		white-space: pre;
		visibility: hidden;
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
		margin-left: -4px;
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

	/* A small card naming the place the reader came from: arrow, then the place's own icon
	   and name. It floats at the top of the scroller once scrolled past; the slot holds its
	   space so the document doesn't jump when it lifts off. */
	/* The slot is its own row above the title */
	.back-slot {
		height: 24px;
		margin-bottom: 10px;
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 0;
		height: 24px;
		max-width: 100%;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: var(--color-accent);
		font-family: var(--font-ui);
		font-size: 12px;
		font-weight: 500;
		color: #fff;
		cursor: pointer;
		transition:
			filter 120ms ease,
			box-shadow 120ms ease;
	}

	.back.floating {
		position: fixed;
		z-index: 4;
		box-shadow: var(--menu-shadow);
	}

	.back-arrow {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		padding: 0 7px;
		opacity: 0.75;
	}

	/* The place is split from the arrow by a full-height rule */
	.back-place {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		height: 24px;
		padding: 0 8px 0 7px;
		border-left: 1px solid rgba(255, 255, 255, 0.3);
	}

	.back-place > :global(svg) {
		flex-shrink: 0;
		opacity: 0.85;
	}

	.back-emoji {
		font-size: 10px;
		line-height: 1;
	}

	.back-label {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.back:hover .back-arrow {
		opacity: 1;
	}

	.back:hover {
		filter: brightness(1.08);
	}

	.kebab:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	/* ── Metadata ── */
	.meta-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		min-width: 0;
		margin-top: 10px;
		font-family: var(--font-ui);
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.loc-stack {
		display: inline-flex;
		min-width: 0;
	}

	.loc-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
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

	.loc-stack.stacked .loc-chip {
		border-radius: 6px 0 0 6px;
	}

	.loc-open {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		height: 24px;
		margin-left: 1px;
		padding: 0 6px;
		border: none;
		border-radius: 0 6px 6px 0;
		background: var(--chip-bg);
		color: var(--color-ui-muted);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.loc-open:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.loc-chip :global(svg) {
		color: var(--color-ui-muted);
		flex-shrink: 0;
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

	.props-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
		height: 24px;
		padding: 0 6px;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 12px;
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.props-chip:hover,
	.props-chip.open {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.props-chip.meta-off {
		cursor: default;
	}

	.props-chip.meta-off:hover:not(.linked) {
		background: transparent;
		color: var(--color-ui-muted);
	}

	.props-chip.meta-off.linked {
		cursor: pointer;
	}

	.props-chip.fm-error {
		color: var(--error-fg);
	}

	.props-chip.fm-error:hover,
	.props-chip.fm-error.open {
		background: var(--error-bg);
		color: var(--error-fg);
	}

	.fm-error-head {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 2px 6px;
		max-width: 260px;
	}

	.fm-error-title {
		font-size: 12px;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.fm-error-msg {
		font-size: 11px;
		line-height: 1.35;
		color: var(--color-ui-muted);
		overflow-wrap: anywhere;
	}

	.props-count {
		color: var(--color-ui-dulled);
	}

	.props-chip:hover .props-count,
	.props-chip.open .props-count {
		color: var(--color-text-secondary);
	}

	/* ── Tags ── */
	.tags-chip {
		position: relative;
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		min-width: 0;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
	}

	.add-tags {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		height: 24px;
		padding: 0 9px 0 6px;
		border-radius: 999px;
		background: var(--chip-bg);
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 11px;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.tags-chip:hover .add-tags {
		background: var(--chip-bg-hover);
		color: var(--color-text-secondary);
	}

	.tag {
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
	}

	.tag :global(svg) {
		opacity: 0.7;
	}

	.tags-chip:hover .tag {
		background: var(--chip-bg-hover);
	}

	/* a tag from the note's text: outlined, since the bar can't edit it */
	.tag.from-text {
		border: 1px solid var(--color-border);
		background: transparent;
		cursor: pointer;
	}

	.tag.from-text:hover {
		color: var(--color-text-secondary);
		border-color: var(--color-ui-muted);
	}

	/* editing: the chip row is the field; chips get an × and a query input joins the end */
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
</style>
