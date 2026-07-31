<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import {
		Search,
		Folder,
		FolderOpen,
		FolderInput,
		FolderPlus,
		Notebook,
		BookOpen,
		ChevronRight,
		Check,
		ExternalLink,
		History,
		Pencil,
		X
	} from '@lucide/svelte';
	import Group, { GroupType } from '$lib/models/Group';
	import { listSources, sourceName } from '$lib/models/Source';
	import { contextMenu, ctxMenu, type CtxEntry } from '$lib/contextMenu.svelte';
	import { toasts } from '$lib/toasts.svelte';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { folderPath } from '$lib/views/createDefaults';
	import { isValidSegment } from '$lib/util/paths';

	type FolderNode = {
		id: string;
		slug: string;
		parentGroupId?: string;
		sourceId?: string;
		accessedAt: Date;
		touch?: () => Promise<void>;
	};

	let {
		open = $bindable(false),
		anchor,
		value,
		sourceId,
		rootOption = false,
		rootLabel,
		placement = 'auto',
		manage = false,
		loadFolders,
		onCreateFolder,
		onChange
	}: {
		open: boolean;
		anchor: HTMLElement | null;
		value: string | null;
		sourceId?: string;
		rootOption?: boolean;
		rootLabel?: string;
		placement?: 'auto' | 'below';
		manage?: boolean;
		loadFolders?: () => Promise<FolderNode[]>;
		onCreateFolder?: (
			name: string,
			parent: { id: string; path: string } | null
		) => Promise<FolderNode>;
		onChange: (id: string, path?: string) => void;
	} = $props();

	const POP_MAX_H = 420;

	let popEl: HTMLDivElement | null = $state(null);
	let searchEl: HTMLInputElement | null = $state(null);
	let pos: { top: number; left: number } = $state({ top: 0, left: 0 });
	let maxH = $state(Math.min(window.innerHeight - 16, POP_MAX_H));

	let folders: FolderNode[] = $state([]);
	let ready = $state(false);
	let sourcePaths: Map<string, string> = $state(new Map());

	let movingId: string | null = $state(null);
	let movingSourceId: string | null = $state(null);
	let movingSlug = $state('');
	let movingBusy = $state(false);

	let renamingId: string | null = $state(null);
	let renameDraft = $state('');
	let renameEl: HTMLInputElement | null = $state(null);
	let sourceNames: Map<string, string> = $state(new Map());
	let loadError = $state('');
	let query = $state('');
	let focusId: string | null = $state(null);

	const scoped = $derived(sourceId ? folders.filter((f) => f.sourceId === sourceId) : folders);

	const sourcesMode = $derived(!sourceId && !loadFolders);

	function isSrcNode(id: string): boolean {
		return id.startsWith('src:');
	}

	function nodeValue(id: string): string {
		return isSrcNode(id) ? id.slice(4) : id;
	}

	const sourceNodes = $derived.by((): FolderNode[] => {
		if (!sourcesMode) return [];
		return [...sourceNames.entries()].map(([id, name]) => ({
			id: `src:${id}`,
			slug: name,
			accessedAt: new Date(0)
		}));
	});

	const byId = $derived(new Map([...scoped, ...sourceNodes].map((f) => [f.id, f])));

	function parentKey(f: FolderNode): string | null {
		if (f.parentGroupId && byId.has(f.parentGroupId)) return f.parentGroupId;
		if (sourcesMode && !isSrcNode(f.id) && f.sourceId) return `src:${f.sourceId}`;
		return null;
	}

	const childrenByParent = $derived.by(() => {
		const map = new Map<string | null, FolderNode[]>();
		for (const f of scoped) {
			const key = parentKey(f);
			const list = map.get(key) ?? [];
			list.push(f);
			map.set(key, list);
		}
		for (const list of map.values()) list.sort((a, b) => a.slug.localeCompare(b.slug));
		if (sourcesMode) map.set(null, [...sourceNodes]);
		return map;
	});

	function subtreeOf(id: string): Set<string> {
		const ex = new Set<string>();
		const stack = [id];
		while (stack.length) {
			const cur = stack.pop()!;
			if (ex.has(cur)) continue;
			ex.add(cur);
			for (const c of childrenByParent.get(cur) ?? []) stack.push(c.id);
		}
		return ex;
	}

	const movingExcluded = $derived(movingId ? subtreeOf(movingId) : new Set<string>());

	function blockReasonFor(f: FolderNode, destKey: string | null): string | undefined {
		if (parentKey(f) === destKey) return 'Already here';
		const sibs = childrenByParent.get(destKey) ?? [];
		if (
			sibs.some(
				(o) =>
					o.id !== f.id && !isSrcNode(o.id) && o.slug.toLowerCase() === f.slug.toLowerCase()
			)
		)
			return `A folder named "${f.slug}" is already there`;
		return undefined;
	}

	function moveBlockReason(destKey: string | null): string | undefined {
		if (!movingId) return undefined;
		const moving = byId.get(movingId);
		return moving ? blockReasonFor(moving, destKey) : undefined;
	}

	const showRootRow = $derived.by(() => {
		if (focusId) return false;
		if (movingId) return !!sourceId && moveBlockReason(null) !== 'Already here';
		return rootOption;
	});

	const searching = $derived(query.trim() !== '');

	const focusFolder = $derived(focusId ? byId.get(focusId) : undefined);

	const focusChain = $derived.by(() => {
		const chain: FolderNode[] = [];
		let f = focusFolder;
		let guard = 0;
		while (f && guard++ < 32) {
			chain.unshift(f);
			const pid = parentKey(f);
			f = pid ? byId.get(pid) : undefined;
		}
		return chain;
	});

	let navDir = $state(1);
	let navAnimate = $state(false);

	const levelRows = $derived(
		(childrenByParent.get(focusId) ?? []).filter((f) => !movingExcluded.has(f.id))
	);

	const SEARCH_MAX = 50;
	const searchMatches = $derived.by(() => {
		if (!searching) return [] as FolderNode[];
		const q = query.trim().toLowerCase();
		const prefix: FolderNode[] = [];
		const rest: FolderNode[] = [];
		for (const f of scoped) {
			if (movingExcluded.has(f.id)) continue;
			if (movingId && f.sourceId !== movingSourceId) continue;
			const s = f.slug.toLowerCase();
			if (s.startsWith(q)) prefix.push(f);
			else if (s.includes(q)) rest.push(f);
		}
		const bySlug = (a: FolderNode, b: FolderNode) => a.slug.localeCompare(b.slug);
		return [...prefix.sort(bySlug), ...rest.sort(bySlug)].slice(0, SEARCH_MAX);
	});

	const RECENTS_MAX = 6;
	const recentFolders = $derived.by(() => {
		if (loadFolders) return [] as FolderNode[];
		const pool = scoped.filter(
			(f) => !movingExcluded.has(f.id) && (!movingId || f.sourceId === movingSourceId)
		);
		const current = value ? pool.find((f) => f.id === value) : undefined;
		const recents = pool
			.filter((f) => f.id !== value)
			.sort((a, b) => b.accessedAt.getTime() - a.accessedAt.getTime())
			.slice(0, RECENTS_MAX - (current ? 1 : 0));
		return current ? [current, ...recents] : recents;
	});

	let recentsOpen = $state(false);
	let recentsIndex = $state(0);
	let recentsRowEl: HTMLElement | null = $state(null);
	let flyPos = $state({ top: 0, left: 0 });
	let recentsHoverT = 0;

	function openRecents() {
		const r = recentsRowEl?.getBoundingClientRect();
		if (!r) return;
		const width = 260;
		let left = r.right - 2;
		let top = r.top - 4;
		if (left + width > window.innerWidth - 8) {
			left = Math.max(8, r.right - width);
			top = r.bottom - 2;
		}
		flyPos = { top: Math.max(8, Math.min(top, window.innerHeight - 8 - 248)), left };
		recentsIndex = 0;
		recentsOpen = true;
	}

	function closeRecents() {
		recentsOpen = false;
	}

	function recentsEnter() {
		recentsHoverT = window.setTimeout(() => openRecents(), 150);
	}

	function recentsLeave() {
		clearTimeout(recentsHoverT);
		closeRecents();
	}

	const rootCrumbLabel = $derived((sourceId && sourceNames.get(sourceId)) || 'All folders');

	const createSourceId = $derived.by(() => {
		if (sourceId) return sourceId;
		if (focusId) return isSrcNode(focusId) ? focusId.slice(4) : byId.get(focusId)?.sourceId;
		return new Set(folders.map((f) => f.sourceId)).size === 1 ? folders[0]?.sourceId : undefined;
	});
	const canCreate = $derived(!!onCreateFolder || !!createSourceId);

	function siblingExists(slug: string): boolean {
		const s = slug.trim().toLowerCase();
		if (!s) return false;
		return (childrenByParent.get(focusId ?? null) ?? []).some((f) => f.slug.toLowerCase() === s);
	}

	function validFolderName(name: string): boolean {
		const s = name.trim();
		return isValidSegment(s) && !s.startsWith('.');
	}

	const showCreate = $derived(
		searching && canCreate && validFolderName(query) && !siblingExists(query)
	);

	type NavEntry = { kind: 'folder'; folder: FolderNode } | { kind: 'root' } | { kind: 'create' };

	const navEntries = $derived.by((): NavEntry[] => {
		const out: NavEntry[] = [];
		if (searching) {
			for (const f of searchMatches) out.push({ kind: 'folder', folder: f });
			if (showCreate) out.push({ kind: 'create' });
			return out;
		}
		if (showRootRow) out.push({ kind: 'root' });
		for (const f of levelRows) out.push({ kind: 'folder', folder: f });
		return out;
	});

	const navCount = $derived(navEntries.length);
	const levelBase = $derived(searching || !showRootRow ? 0 : 1);
	let activeIndex = $state(0);

	$effect(() => {
		query;
		focusId;
		recentsOpen = false;
		if (activeIndex >= navCount) activeIndex = 0;
	});

	let creating = $state(false);

	async function createFolderNamed(slug: string) {
		const name = slug.trim();
		if (!validFolderName(name) || !canCreate || creating || siblingExists(name)) return;
		creating = true;
		try {
			const parent =
				focusId && !isSrcNode(focusId)
					? { id: focusId, path: folderPath(focusId, folders) }
					: null;
			const g = onCreateFolder
				? await onCreateFolder(name, parent)
				: await Group.createFolder(name, createSourceId!, parent ?? undefined);
			folders = [...folders, g];
			loadError = '';
			newName = '';
			focusFolderId(g.id);
			if (newFolderOpen) queueMicrotask(() => newFolderEl?.focus());
		} catch (e) {
			loadError = Group.describeOpError(e, "The folder couldn't be created.");
		} finally {
			creating = false;
		}
	}

	let newFolderOpen = $state(false);
	let newName = $state('');
	let newFolderEl: HTMLInputElement | null = $state(null);

	function openNewFolder() {
		newFolderOpen = true;
		newName = '';
		queueMicrotask(() => newFolderEl?.focus());
	}

	function closeNewFolder() {
		newFolderOpen = false;
		newName = '';
		searchEl?.focus();
	}

	function onNewFolderKey(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Enter') createFolderNamed(newName);
		else if (e.key === 'Escape') closeNewFolder();
	}

	function startMove(f: FolderNode) {
		movingId = f.id;
		movingSourceId = f.sourceId ?? null;
		movingSlug = f.slug;
		navAnimate = false;
		focusId = parentKey(f);
		activeIndex = 0;
		query = '';
	}

	function cancelMove() {
		movingId = null;
		movingSourceId = null;
		searchEl?.focus();
	}

	async function performMove(f: FolderNode, destKey: string | null): Promise<string | null> {
		if (!f.sourceId || movingBusy || blockReasonFor(f, destKey)) return null;
		if (destKey && subtreeOf(f.id).has(destKey)) return null;
		const src = f.sourceId;
		const oldPath = folderPath(f.id, folders);
		const destDir = destKey && !isSrcNode(destKey) ? folderPath(destKey, folders) : '';
		const newPath = destDir ? `${destDir}/${f.slug}` : f.slug;
		movingBusy = true;
		try {
			const newId = await Group.moveFolder(src, oldPath, newPath);
			await loadData();
			return newId;
		} catch (e) {
			toasts.push(Group.describeOpError(e, "The folder couldn't be moved."), {
				action: { label: 'Retry', run: () => performMove(f, destKey) }
			});
			return null;
		} finally {
			movingBusy = false;
		}
	}

	async function doMove(destKey: string | null) {
		if (!movingId) return;
		const moving = byId.get(movingId);
		if (!moving) return;
		const src = moving.sourceId;
		const newId = await performMove(moving, destKey);
		if (newId === null) return;
		movingId = null;
		movingSourceId = null;
		navAnimate = false;
		focusId = destKey ?? (sourcesMode ? `src:${src}` : null);
		queueMicrotask(() => {
			const i = navEntries.findIndex((n) => n.kind === 'folder' && n.folder.id === newId);
			if (i >= 0) activeIndex = i;
		});
	}

	function startRename(f: FolderNode) {
		if (searching) {
			navAnimate = false;
			focusId = parentKey(f);
			query = '';
		}
		renamingId = f.id;
		renameDraft = f.slug;
		queueMicrotask(() => {
			renameEl?.focus();
			renameEl?.select();
		});
	}

	function renameInvalid(f: FolderNode): boolean {
		const s = renameDraft.trim();
		if (s === f.slug || s === '') return false;
		if (!validFolderName(s)) return true;
		const sibs = childrenByParent.get(parentKey(f)) ?? [];
		return sibs.some((o) => o.id !== f.id && o.slug.toLowerCase() === s.toLowerCase());
	}

	function commitRename(f: FolderNode) {
		if (renamingId !== f.id) return;
		const s = renameDraft.trim();
		const invalid = renameInvalid(f);
		renamingId = null;
		if (!f.sourceId || s === f.slug || s === '' || invalid || !validFolderName(s)) return;
		const oldPath = folderPath(f.id, folders);
		const dir = oldPath.split('/').slice(0, -1).join('/');
		doRename(f.sourceId, oldPath, dir ? `${dir}/${s}` : s);
	}

	async function doRename(src: string, oldPath: string, newPath: string) {
		try {
			await Group.moveFolder(src, oldPath, newPath);
			await loadData();
		} catch (e) {
			toasts.push(Group.describeOpError(e, "The folder couldn't be renamed."), {
				action: { label: 'Retry', run: () => doRename(src, oldPath, newPath) }
			});
		}
	}

	function onRenameKey(e: KeyboardEvent, f: FolderNode) {
		e.stopPropagation();
		if (e.key === 'Enter') commitRename(f);
		else if (e.key === 'Escape') renamingId = null;
	}

	function revealFolder(f: FolderNode) {
		const root = f.sourceId ? sourcePaths.get(f.sourceId) : undefined;
		if (!root) return;
		revealItemInDir(`${root}/${folderPath(f.id, folders)}`).catch(() => {});
	}

	function folderCtxItems(f: FolderNode): CtxEntry[] | null {
		if (!manage || isSrcNode(f.id) || movingId || renamingId) return null;
		return [
			{ label: 'Rename', icon: Pencil, action: () => startRename(f) },
			{ label: 'Move to…', icon: FolderInput, action: () => startMove(f) },
			{
				label: 'New folder inside',
				icon: FolderPlus,
				action: () => {
					focusFolderId(f.id);
					openNewFolder();
				}
			},
			{ divider: true },
			{ label: 'Reveal in file manager', icon: ExternalLink, action: () => revealFolder(f) }
		];
	}

	function ancestorPath(folder: FolderNode): string {
		const parts: string[] = [];
		let pid = parentKey(folder);
		let guard = 0;
		while (pid && guard++ < 32) {
			const p = byId.get(pid);
			if (!p) break;
			parts.unshift(p.slug);
			pid = parentKey(p);
		}
		return parts.join(' / ');
	}

	function pick(id: string) {
		if (movingId) {
			doMove(id === '' ? null : id);
			return;
		}
		if (isSrcNode(id)) {
			onChange(nodeValue(id), '');
			open = false;
			return;
		}
		if (id)
			byId
				.get(id)
				?.touch?.()
				.catch(() => {});
		onChange(id, id ? folderPath(id, folders) : '');
		open = false;
	}

	function focusFolderId(id: string) {
		navAnimate = true;
		navDir = 1;
		focusId = id;
		activeIndex = 0;
		query = '';
	}

	function jumpTo(id: string | null) {
		navAnimate = true;
		navDir = -1;
		focusId = id;
		activeIndex = 0;
	}

	function goUp() {
		if (!focusId) return;
		if (movingId && isSrcNode(focusId)) return;
		const from = focusId;
		navAnimate = true;
		navDir = -1;
		focusId = focusFolder ? parentKey(focusFolder) : null;
		const i = navEntries.findIndex((n) => n.kind === 'folder' && n.folder.id === from);
		activeIndex = i >= 0 ? i : 0;
	}

	function revealValue() {
		if (!value) return;
		const target = folders.find((g) => g.id === value);
		if (target) focusId = parentKey(target);
		else if (byId.has(`src:${value}`)) focusId = `src:${value}`;
		else return;
		const i = navEntries.findIndex((n) => n.kind === 'folder' && nodeValue(n.folder.id) === value);
		if (i >= 0) activeIndex = i;
		queueMicrotask(() => {
			popEl?.querySelector('.folder-row.selected')?.scrollIntoView({ block: 'nearest' });
		});
	}

	function position() {
		if (!anchor || !popEl) return;
		const a = anchor.getBoundingClientRect();
		const m = popEl.getBoundingClientRect();
		const margin = 4;
		const listEl = popEl.querySelector('.list');
		const clipped = listEl ? listEl.scrollHeight - listEl.clientHeight : 0;
		const naturalH = m.height + clipped;
		const spaceBelow = window.innerHeight - 8 - (a.bottom + margin);
		const spaceAbove = a.top - margin - 8;
		let top: number;
		if (placement === 'below' || naturalH <= spaceBelow || spaceBelow >= spaceAbove) {
			top = a.bottom + margin;
			maxH = Math.min(spaceBelow, POP_MAX_H);
		} else {
			maxH = Math.min(spaceAbove, POP_MAX_H);
			top = Math.max(8, a.top - margin - Math.min(naturalH, maxH));
		}
		let left = a.left;
		if (left + m.width > window.innerWidth - 8) {
			left = Math.max(8, a.right - m.width);
		}
		pos = { top, left };
	}

	// ── Drag to move ────────────────────────────────────────────────────────────
	const DRAG_PX = 4;
	const SPRING_MS = 550;
	let dragArmed: { f: FolderNode; x: number; y: number } | null = null;
	let dragging: FolderNode | null = $state(null);
	let dragExcluded: Set<string> = new Set();
	let dragPos = $state({ x: 0, y: 0 });
	let dropKey: string | null = $state(null);
	let dropOk = $state(false);
	let justDragged = false;
	let springKey: string | null = null;
	let springT = 0;

	function dragArm(e: PointerEvent, f: FolderNode) {
		if (!manage || e.button !== 0 || isSrcNode(f.id) || movingId || renamingId) return;
		dragArmed = { f, x: e.clientX, y: e.clientY };
		window.addEventListener('pointermove', onDragMove);
		window.addEventListener('pointerup', onDragUp);
		window.addEventListener('keydown', onDragKey, true);
	}

	function dragCleanup() {
		window.removeEventListener('pointermove', onDragMove);
		window.removeEventListener('pointerup', onDragUp);
		window.removeEventListener('keydown', onDragKey, true);
		clearTimeout(springT);
		springKey = null;
		dragArmed = null;
		dragging = null;
		dropKey = null;
		dropOk = false;
	}

	function dragValid(f: FolderNode, destKey: string | null): boolean {
		if (destKey && dragExcluded.has(destKey)) return false;
		if (!destKey && sourcesMode) return false;
		if (destKey) {
			const d = byId.get(destKey);
			if (!d) return false;
			const destSource = isSrcNode(destKey) ? nodeValue(destKey) : d.sourceId;
			if (destSource !== f.sourceId) return false;
		}
		return !blockReasonFor(f, destKey);
	}

	function onDragMove(e: PointerEvent) {
		if (dragArmed && !dragging) {
			if (Math.hypot(e.clientX - dragArmed.x, e.clientY - dragArmed.y) < DRAG_PX) return;
			dragging = dragArmed.f;
			dragExcluded = subtreeOf(dragging.id);
		}
		if (!dragging) return;
		e.preventDefault();
		dragPos = { x: e.clientX, y: e.clientY };
		const el = document.elementFromPoint(e.clientX, e.clientY);
		const t = el?.closest('[data-drop]');
		if (!t || !popEl?.contains(t)) {
			dropKey = null;
			dropOk = false;
			springKey = null;
			clearTimeout(springT);
			return;
		}
		const raw = t.getAttribute('data-drop')!;
		dropKey = raw;
		dropOk = dragValid(dragging, raw === '' ? null : raw);
		const springable =
			raw !== '' &&
			!dragExcluded.has(raw) &&
			(isSrcNode(raw)
				? nodeValue(raw) === dragging.sourceId
				: byId.get(raw)?.sourceId === dragging.sourceId) &&
			(childrenByParent.get(raw)?.length ?? 0) > 0;
		if (springable && raw !== focusId) {
			if (springKey !== raw) {
				springKey = raw;
				clearTimeout(springT);
				springT = window.setTimeout(() => {
					if (dragging && springKey) focusFolderId(springKey);
				}, SPRING_MS);
			}
		} else {
			springKey = null;
			clearTimeout(springT);
		}
	}

	function onDragUp() {
		const f = dragging;
		const raw = dropKey;
		const ok = dropOk;
		dragCleanup();
		if (!f) return;
		justDragged = true;
		setTimeout(() => (justDragged = false), 0);
		if (raw !== null && ok) performMove(f, raw === '' ? null : raw);
	}

	function onDragKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && (dragging || dragArmed)) {
			e.stopPropagation();
			e.preventDefault();
			dragCleanup();
		}
	}

	function onPopClickCapture(e: MouseEvent) {
		if (justDragged) {
			e.stopPropagation();
			e.preventDefault();
			justDragged = false;
		}
	}

	function loadData(): Promise<void> {
		const load = loadFolders
			? loadFolders()
			: Group.list().then((gs) => gs.filter((g) => g.groupType === GroupType.Folder));
		return Promise.all([load, listSources().catch(() => [])])
			.then(([fs, ss]) => {
				folders = fs;
				sourceNames = new Map(ss.map((s) => [s.id, sourceName(s)]));
				sourcePaths = new Map(ss.map((s) => [s.id, s.path]));
				loadError = '';
				ready = true;
			})
			.catch((e) => {
				loadError = String(e);
				ready = true;
			});
	}

	function onDocPointerDown(e: PointerEvent) {
		if (!open) return;
		if (popEl?.contains(e.target as Node)) return;
		if (anchor?.contains(e.target as Node)) return;
		if ((e.target as Element | null)?.closest?.('.ctx-menu')) return;
		open = false;
	}

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		if (contextMenu.open) return;
		if (recentsOpen) {
			if (e.key === 'Escape' || e.key === 'ArrowLeft') {
				e.preventDefault();
				closeRecents();
				return;
			} else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
				e.preventDefault();
				if (recentFolders.length) recentsIndex = (recentsIndex + 1) % recentFolders.length;
				return;
			} else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
				e.preventDefault();
				if (recentFolders.length)
					recentsIndex = (recentsIndex - 1 + recentFolders.length) % recentFolders.length;
				return;
			} else if (e.key === 'Enter') {
				e.preventDefault();
				const f = recentFolders[recentsIndex];
				if (f) pick(f.id);
				return;
			}
			closeRecents();
		}
		const entry = navEntries[activeIndex];
		if (e.key === 'Escape') {
			if (focusId && !(movingId && isSrcNode(focusId))) {
				goUp();
			} else {
				open = false;
			}
			e.preventDefault();
		} else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
			e.preventDefault();
			if (navCount > 0) activeIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % navCount;
		} else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
			e.preventDefault();
			if (navCount > 0)
				activeIndex = activeIndex < 0 ? navCount - 1 : (activeIndex - 1 + navCount) % navCount;
		} else if (e.key === 'ArrowRight' && !searching) {
			if (entry?.kind === 'folder') {
				e.preventDefault();
				focusFolderId(entry.folder.id);
			}
		} else if (e.key === 'ArrowLeft' && !searching) {
			if (!focusId) return;
			e.preventDefault();
			goUp();
		} else if (e.key === 'Enter') {
			if (!entry) return;
			e.preventDefault();
			if (entry.kind === 'create') createFolderNamed(query);
			else if (entry.kind === 'root') pick('');
			else pick(entry.folder.id);
		}
	}

	if (!loadFolders) loadData();

	let wasOpen = false;

	$effect(() => {
		const isOpen = open;
		if (isOpen && !wasOpen) {
			wasOpen = true;
			untrack(() => {
				query = '';
				newFolderOpen = false;
				newName = '';
				recentsOpen = false;
				movingId = null;
				movingSourceId = null;
				renamingId = null;
				focusId = null;
				activeIndex = 0;
				navAnimate = false;
				ready = folders.length > 0;
				revealValue();
			});
			loadData().then(() => {
				revealValue();
				queueMicrotask(() => {
					position();
					searchEl?.focus();
				});
			});
			queueMicrotask(() => {
				position();
				searchEl?.focus();
			});
			window.addEventListener('resize', position);
			window.addEventListener('scroll', position, true);
			document.addEventListener('pointerdown', onDocPointerDown);
			document.addEventListener('keydown', onKey);
			return () => {
				window.removeEventListener('resize', position);
				window.removeEventListener('scroll', position, true);
				document.removeEventListener('pointerdown', onDocPointerDown);
				document.removeEventListener('keydown', onKey);
			};
		}
		if (!isOpen && wasOpen) {
			wasOpen = false;
			dragCleanup();
		}
	});

	$effect(() => {
		query;
		focusId;
		newFolderOpen;
		if (open) queueMicrotask(position);
	});
</script>

{#if open && ready}
	<div
		class="pop"
		class:dragging={!!dragging}
		bind:this={popEl}
		style:top="{pos.top}px"
		style:left="{pos.left}px"
		style:max-height="{maxH}px"
		role="menu"
		tabindex="-1"
		onclickcapture={onPopClickCapture}
	>
		<div class="search-row">
			<Search size={13} strokeWidth={1.75} />
			<input
				class="search-input"
				type="text"
				bind:value={query}
				bind:this={searchEl}
				placeholder="Search folders…"
			/>
			{#if query}
				<button
					class="clear-btn"
					type="button"
					title="Clear"
					onclick={() => {
						query = '';
						searchEl?.focus();
					}}
				>
					<X size={13} />
				</button>
			{:else if !loadFolders}
				<span
					class="recents-anchor"
					bind:this={recentsRowEl}
					onmouseenter={recentsEnter}
					onmouseleave={recentsLeave}
					role="presentation"
				>
					<button
						class="clear-btn"
						type="button"
						title="Recent folders"
						onclick={() => (recentsOpen ? closeRecents() : openRecents())}
					>
						<History size={13} strokeWidth={1.75} />
					</button>
					{#if recentsOpen}
						<div
							class="recents-fly"
							style:top="{flyPos.top}px"
							style:left="{flyPos.left}px"
							role="menu"
							tabindex="-1"
						>
							<div class="fly-label">Recent folders</div>
							{#each recentFolders as folder, i (folder.id)}
								{@const blockReason = movingId ? moveBlockReason(folder.id) : undefined}
								<div
									class="folder-row"
									class:selected={folder.id === value}
									class:active={i === recentsIndex}
								>
									<button
										class="folder-name"
										type="button"
										tabindex="-1"
										disabled={!!movingId && !!blockReason}
										title={movingId ? (blockReason ?? `Move into ${folder.slug}`) : undefined}
										onclick={() => pick(folder.id)}
										onmouseenter={() => (recentsIndex = i)}
									>
										<Folder size={13} strokeWidth={1.75} />
										<span class="name-label">{folder.slug}</span>
										{#if folder.id === value}
											<Check size={13} strokeWidth={2} />
										{/if}
										{#if ancestorPath(folder)}
											<span class="name-path">{ancestorPath(folder)}</span>
										{/if}
									</button>
								</div>
							{:else}
								<div class="empty">No recent folders</div>
							{/each}
						</div>
					{/if}
				</span>
			{/if}
		</div>

		{#if loadError}
			<div class="load-error">{loadError}</div>
		{/if}
		{#if movingId}
			<div class="move-head">
				<FolderInput size={12} strokeWidth={1.75} />
				<span class="move-label">Moving</span>
				<span class="move-name">{movingSlug}</span>
				<button class="move-cancel" type="button" title="Cancel move" onclick={cancelMove}>
					<X size={12} />
				</button>
			</div>
		{/if}
		{#if !searching && showRootRow}
			{@const rootBlock = moveBlockReason(null)}
			<div
				class="folder-row root-row"
				class:active={activeIndex === 0}
				class:drop-hot={dropKey === '' && dropOk}
				data-drop=""
			>
				<button
					class="folder-name"
					type="button"
					tabindex="-1"
					disabled={!!movingId && !!rootBlock}
					title={movingId ? (rootBlock ?? 'Place here') : undefined}
					onclick={() => pick('')}
					onmouseenter={() => (activeIndex = 0)}
				>
					<Notebook size={13} strokeWidth={1.75} />
					<span class="name-label"
						>{movingId
							? rootCrumbLabel
							: (rootLabel ?? ((sourceId && sourceNames.get(sourceId)) || 'No folder'))}</span
					>
				</button>
				<button
					class="row-select"
					type="button"
					tabindex="-1"
					disabled={!!movingId && !!rootBlock}
					title={movingId ? (rootBlock ?? '') : ''}
					onclick={() => pick('')}
				>
					{movingId ? 'Place here' : 'Select this source'}
				</button>
			</div>
			<div class="root-divider"></div>
		{/if}
		<div class="list" onmouseleave={() => (activeIndex = -1)} role="presentation">
			{#if searching}
				{#each searchMatches as folder, i (folder.id)}
					{@const blockReason = movingId ? moveBlockReason(folder.id) : undefined}
					<div
						class="folder-row"
						class:selected={folder.id === value}
						class:active={i === activeIndex}
						class:drop-hot={dropKey === folder.id && dropOk}
						data-drop={folder.id}
						onpointerdown={(e) => dragArm(e, folder)}
						use:ctxMenu={() => folderCtxItems(folder)}
					>
						<button
							class="folder-name"
							type="button"
							tabindex="-1"
							onclick={() => focusFolderId(folder.id)}
							onmouseenter={() => (activeIndex = i)}
						>
							<span class="row-icon"><Folder size={13} strokeWidth={1.75} /></span>
							<span class="row-icon open"><FolderOpen size={13} strokeWidth={1.75} /></span>
							<span class="name-label">{folder.slug}</span>
							{#if folder.id === value}
								<Check size={13} strokeWidth={2} />
							{/if}
							{#if ancestorPath(folder)}
								<span class="name-path">{ancestorPath(folder)}</span>
							{/if}
						</button>
						<button
							class="row-select"
							type="button"
							tabindex="-1"
							disabled={!!movingId && !!blockReason}
							title={movingId ? (blockReason ?? '') : ''}
							onclick={() => pick(folder.id)}
						>
							{movingId ? 'Place' : 'Select'}
						</button>
					</div>
				{/each}
				{#if showCreate}
					<div
						class="folder-row create"
						class:active={activeIndex === searchMatches.length}
					>
												<button
							class="folder-name"
							type="button"
							tabindex="-1"
							onclick={() => createFolderNamed(query)}
							onmouseenter={() => (activeIndex = searchMatches.length)}
						>
							<FolderPlus size={13} strokeWidth={1.75} />
							<span class="name-label">Create folder</span>
							<span class="create-name">{query.trim()}</span>
							<span class="create-hint">{focusFolder ? `in ${focusFolder.slug}` : 'at root'}</span>
						</button>
					</div>
				{:else if searchMatches.length === 0}
					<div class="empty">No folders</div>
				{/if}
			{:else}
				{#if true}
					<div class="section-label all-row">
						{#if sourcesMode && !movingId}
							<button
								class="crumb-root crumb-icon"
								type="button"
								disabled={!focusId}
								title="All sources"
								onclick={() => jumpTo(null)}
							>
								<BookOpen size={11} strokeWidth={1.75} />
								{#if !focusId}
									<span>YOUR SOURCES</span>
								{/if}
							</button>
						{:else if !sourcesMode}
							<button
								class="crumb-root"
								class:current={!focusId}
								class:drop-hot={dropKey === '' && dropOk}
								type="button"
								disabled={!focusId}
								data-drop=""
								onclick={() => jumpTo(null)}>{rootCrumbLabel}</button
							>
						{/if}
						{#if focusChain.length > 1}
							{@const first = focusChain[0]}
							<span class="crumb-sep"><ChevronRight size={9} strokeWidth={2.25} /></span>
							<button
								class="crumb"
								class:drop-hot={dropKey === first.id && dropOk}
								type="button"
								data-drop={first.id}
								onclick={() => jumpTo(first.id)}>{first.slug}</button
							>
						{/if}
						{#if focusChain.length > 3}
							<span class="crumb-sep"><ChevronRight size={9} strokeWidth={2.25} /></span>
							<span class="crumb-dots">…</span>
						{/if}
						{#if focusChain.length > 2}
							{@const parent = focusChain[focusChain.length - 2]}
							<span class="crumb-sep"><ChevronRight size={9} strokeWidth={2.25} /></span>
							<button
								class="crumb"
								class:drop-hot={dropKey === parent.id && dropOk}
								type="button"
								data-drop={parent.id}
								onclick={() => jumpTo(parent.id)}>{parent.slug}</button
							>
						{/if}
						{#if focusFolder}
							{@const focusValue = nodeValue(focusFolder.id)}
							{@const focusBlock = movingId && focusId ? moveBlockReason(focusId) : undefined}
							<span class="crumb-sep"><ChevronRight size={9} strokeWidth={2.25} /></span>
							<button
								class="focus-name"
								class:selected={focusValue === value}
								class:drop-hot={!!focusId && dropKey === focusId && dropOk}
								type="button"
								disabled={!!movingId && !!focusBlock}
								data-drop={focusId}
								title={movingId
									? (focusBlock ?? `Place in ${focusFolder.slug}`)
									: isSrcNode(focusFolder.id)
										? 'Use this source'
										: 'Use this folder'}
								onclick={() => focusId && pick(focusId)}
							>
								<span>{focusFolder.slug}</span>
								{#if focusValue === value}
									<Check size={12} strokeWidth={2} />
								{/if}
							</button>
						{/if}
						{#if canCreate}
							<button class="crumb-new" type="button" title="New folder" onclick={openNewFolder}>
								<FolderPlus size={12} strokeWidth={1.75} />
							</button>
						{/if}
					</div>
					<div class="crumb-divider"></div>
				{/if}
				{#key focusId}
					<div class="level" in:fly={{ x: 24 * navDir, duration: navAnimate ? 130 : 0 }}>
						{#if canCreate && newFolderOpen}
							<div class="folder-row new-row">
								<div class="folder-name new-edit">
									<FolderPlus size={13} strokeWidth={1.75} />
									<input
										class="new-input"
										class:invalid={newName.trim() !== '' &&
											(!validFolderName(newName) || siblingExists(newName))}
										type="text"
										bind:value={newName}
										bind:this={newFolderEl}
										placeholder="Folder name…"
										onkeydown={onNewFolderKey}
									/>
								</div>
							</div>
						{/if}
						{#each levelRows as folder, i (folder.id)}
							{@const navIndex = levelBase + i}
							{@const src = isSrcNode(folder.id)}
							{@const blockReason = movingId ? moveBlockReason(folder.id) : undefined}
							<div
								class="folder-row"
								class:selected={nodeValue(folder.id) === value}
								class:active={navIndex === activeIndex}
								class:drop-hot={dropKey === folder.id && dropOk}
								data-drop={folder.id}
								onpointerdown={(e) => dragArm(e, folder)}
								use:ctxMenu={() => folderCtxItems(folder)}
							>
								{#if renamingId === folder.id}
									<div class="folder-name new-edit">
										<Folder size={13} strokeWidth={1.75} />
										<input
											class="new-input"
											class:invalid={renameInvalid(folder)}
											type="text"
											bind:value={renameDraft}
											bind:this={renameEl}
											onkeydown={(e) => onRenameKey(e, folder)}
											onblur={() => commitRename(folder)}
										/>
									</div>
								{:else}
									<button
										class="folder-name"
										type="button"
										tabindex="-1"
										onclick={() => focusFolderId(folder.id)}
										onmouseenter={() => (activeIndex = navIndex)}
									>
										{#if src}
											<span class="row-icon"><Notebook size={13} strokeWidth={1.75} /></span>
											<span class="row-icon open"><BookOpen size={13} strokeWidth={1.75} /></span>
										{:else}
											<span class="row-icon"><Folder size={13} strokeWidth={1.75} /></span>
											<span class="row-icon open"><FolderOpen size={13} strokeWidth={1.75} /></span>
										{/if}
										<span class="name-label">{folder.slug}</span>
										{#if nodeValue(folder.id) === value || blockReason === 'Already here'}
											<Check size={13} strokeWidth={2} />
										{/if}
									</button>
									<button
										class="row-select"
										type="button"
										tabindex="-1"
										disabled={!!movingId && !!blockReason}
										title={movingId ? (blockReason ?? '') : ''}
										onclick={() => pick(folder.id)}
									>
										{movingId ? 'Place' : 'Select'}
									</button>
								{/if}
							</div>
						{:else}
							<div class="empty">
								{#if focusFolder && (!movingId || !moveBlockReason(focusId))}
									<span
										>{movingId ? 'No folders to move into,' : 'No folders inside,'}</span
									>
									<button class="empty-link" type="button" onclick={() => focusId && pick(focusId)}>
										{movingId
											? 'place it here?'
											: isSrcNode(focusFolder.id)
												? 'select this source?'
												: 'select this folder?'}
									</button>
								{:else if movingId}
									No folders to move into
								{:else if focusFolder}
									No folders inside
								{:else}
									No folders
								{/if}
							</div>
						{/each}
					</div>
				{/key}
			{/if}
		</div>
	</div>
	{#if dragging}
		<div
			class="drag-ghost"
			class:blocked={dropKey !== null && !dropOk}
			style:top="{dragPos.y + 14}px"
			style:left="{dragPos.x + 12}px"
		>
			<Folder size={12} strokeWidth={1.75} />
			<span>{dragging.slug}</span>
		</div>
	{/if}
{/if}

<style>
	.pop {
		position: fixed;
		z-index: 1000;
		width: 320px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: var(--menu-shadow);
		padding: 4px;
		font-family: var(--font-ui);
		font-size: 13px;
		line-height: 1.4;
		color: var(--color-text-primary);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.move-head {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: -4px -4px 4px;
		padding: 6px 12px;
		border-bottom: 1px solid var(--menu-search-divider);
		font-size: 11px;
		font-weight: 500;
		color: var(--color-ui-muted);
	}

	.move-head :global(svg) {
		flex-shrink: 0;
	}

	.move-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-primary);
	}

	.move-cancel {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		margin-left: auto;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
		flex-shrink: 0;
	}

	.move-cancel:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text-primary);
	}

	.folder-name:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.search-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: -4px -4px 4px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--menu-search-divider);
		color: var(--color-ui-muted);
	}

	.search-row :global(svg) {
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		font: inherit;
		font-size: 13px;
		color: var(--color-text-primary);
		outline: none;
		padding: 0;
	}

	.search-input::placeholder {
		color: var(--color-ui-dulled);
	}

	.clear-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
		flex-shrink: 0;
	}

	.clear-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text-primary);
	}

	.list {
		overflow-y: auto;
		overflow-x: hidden;
		flex: 1;
	}

	.list::-webkit-scrollbar {
		width: 1px;
	}

	.list::-webkit-scrollbar-track {
		background: transparent;
	}

	.list::-webkit-scrollbar-thumb {
		background: var(--color-border);
	}

	.section-label {
		padding: 6px 10px 2px;
		color: var(--color-ui-dulled);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.all-row {
		display: flex;
		align-items: center;
		gap: 3px;
		min-width: 0;
		height: 28px;
		box-sizing: border-box;
		padding: 0 10px;
		text-transform: none;
		letter-spacing: normal;
		font-size: 11px;
	}

	.crumb-root {
		display: inline-flex;
		align-items: center;
		height: 18px;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;
		text-transform: inherit;
		cursor: pointer;
		flex-shrink: 0;
	}

	.crumb-root:disabled {
		cursor: default;
	}

	.crumb-root.current {
		color: var(--color-text-primary);
	}

	.crumb-icon {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	.crumb-new {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		margin-left: auto;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--color-ui-dulled);
		cursor: pointer;
		flex-shrink: 0;
	}

	.crumb-new:hover {
		color: var(--color-text-primary);
	}

	.empty-link {
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-ui-muted);
		font: inherit;
		cursor: pointer;
	}

	.empty-link:hover {
		color: var(--color-text-primary);
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.recents-anchor {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
	}

	.fly-label {
		padding: 4px 8px 6px;
		font-size: 11px;
		font-weight: 500;
		color: var(--color-ui-muted);
	}

	.recents-fly {
		position: fixed;
		z-index: 1001;
		width: 260px;
		max-height: 240px;
		overflow-y: auto;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: var(--menu-shadow);
		padding: 4px;
	}

	.recents-fly::-webkit-scrollbar {
		width: 1px;
	}

	.recents-fly::-webkit-scrollbar-thumb {
		background: var(--color-border);
	}

	.crumb-root:not(:disabled):hover {
		color: var(--color-text-primary);
	}

	.crumb-sep {
		display: inline-flex;
		align-items: center;
		height: 18px;
		flex-shrink: 0;
		color: var(--color-ui-dulled);
		opacity: 0.7;
	}

	.crumb-dots {
		height: 18px;
		line-height: 18px;
		flex-shrink: 0;
		color: var(--color-ui-dulled);
	}

	.crumb {
		max-width: 70px;
		height: 18px;
		line-height: 18px;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;
		text-transform: inherit;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}

	.crumb:hover {
		color: var(--color-text-primary);
	}

	.level {
		min-width: 0;
	}

	.focus-name {
		display: inline-flex;
		align-items: center;
		height: 18px;
		gap: 3px;
		max-width: 150px;
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;
		text-transform: inherit;
		cursor: pointer;
	}

	.focus-name span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.focus-name:hover {
		color: var(--color-text-primary);
	}

	.focus-name :global(svg) {
		flex-shrink: 0;
		color: var(--color-accent);
	}

	.folder-row {
		display: flex;
		align-items: stretch;
		border-radius: 5px;
	}

	.row-icon {
		display: inline-flex;
	}

	.row-icon.open {
		display: none;
	}

	.folder-name:hover .row-icon {
		display: none;
	}

	.folder-name:hover .row-icon.open {
		display: inline-flex;
	}

	.folder-row.active .folder-name .row-icon {
		display: none;
	}

	.folder-row.active .folder-name .row-icon.open {
		display: inline-flex;
	}

	.row-select {
		display: none;
		align-items: center;
		flex-shrink: 0;
		margin: 3px 4px 3px 0;
		padding: 2px 8px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--color-ui-muted);
		font: inherit;
		font-size: 11px;
		cursor: pointer;
	}

	.folder-row:hover .row-select,
	.folder-row.active .row-select {
		display: inline-flex;
	}

	.row-select:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.row-select:disabled {
		opacity: 0.45;
		cursor: default;
		background: transparent;
	}

	.folder-row.selected {
		background: var(--chip-bg);
	}

	.folder-row.active,
	.folder-row.drop-hot {
		background: var(--menu-item-hover);
	}

	.crumb.drop-hot,
	.crumb-root.drop-hot,
	.focus-name.drop-hot {
		color: var(--color-text-primary);
	}

	.pop.dragging {
		user-select: none;
		cursor: grabbing;
	}

	.pop.dragging .row-select {
		display: none;
	}

	.drag-ghost {
		position: fixed;
		z-index: 2000;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 9px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 12px;
		color: var(--color-text-primary);
		pointer-events: none;
		white-space: nowrap;
	}

	.drag-ghost.blocked {
		opacity: 0.5;
	}

	.drag-ghost :global(svg) {
		color: var(--color-ui-muted);
		flex-shrink: 0;
	}

	.root-divider {
		height: 1px;
		margin: 4px -4px;
		background: var(--menu-search-divider);
		flex-shrink: 0;
	}

	.crumb-divider {
		height: 1px;
		margin: 2px -4px 4px;
		background: var(--menu-search-divider);
		flex-shrink: 0;
	}

	.root-row .name-label {
		color: var(--color-ui-muted);
	}

	.root-row.active .name-label {
		color: var(--color-text-primary);
	}

	.folder-name {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		padding: 6px 8px 6px 10px;
		border: 0;
		background: transparent;
		border-radius: 5px;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
	}

	.folder-name :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	/* Highlight is driven by .folder-row.active (set on mouseenter), so hover and
       keyboard nav share one cursor */

	.name-label {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.name-path {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 11px;
		color: var(--color-ui-dulled);
	}

	.folder-row.create .name-label {
		color: var(--color-ui-muted);
	}

	.new-edit {
		cursor: default;
	}

	.new-input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		font: inherit;
		color: var(--color-text-primary);
		outline: none;
		padding: 0;
	}

	.new-input::placeholder {
		color: var(--color-ui-dulled);
	}

	.new-input.invalid {
		text-decoration: underline;
		text-decoration-color: var(--error-fg);
		text-underline-offset: 3px;
	}

	.create-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.create-hint {
		flex-shrink: 0;
		margin-left: auto;
		padding-left: 8px;
		font-size: 11px;
		color: var(--color-ui-dulled);
	}

	.empty {
		padding: 8px 10px;
		color: var(--color-ui-muted);
		font-size: 12px;
	}

	.load-error {
		margin: 0 2px 4px;
		padding: 6px 10px;
		font-size: 11px;
		color: var(--error-fg);
		background: var(--error-bg);
		border-radius: 5px;
	}
</style>
