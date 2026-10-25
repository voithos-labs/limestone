<script lang="ts">
	import { addSourceRequest, describeError, reportError } from '#lib/overlays.svelte.js';
	import {
		resetAllSettings,
		getAppInfo,
		getSetting,
		setSetting,
		SETTINGS_REGISTRY,
		settingEquals,
		type AppInfo,
		type SettingCategory,
		type SettingDef,
		type SettingValue
	} from '#lib/models/Settings.svelte.js';
	import { ACCENT_PRESETS, resolveAccent } from '#lib/services/theme.svelte.js';
	import {
		getDefaultSourceId,
		listSources,
		removeSource,
		setDefaultSource,
		sourceName,
		type Source
	} from '#lib/models/Source.js';
	import { select } from '#lib/services/db.js';
	import { openPath } from '@tauri-apps/plugin-opener';
	import SourceDialog from '../dialogs/SourceDialog.svelte';
	import SourceMenu from '../dialogs/SourceMenu.svelte';
	import Toggle from '../ui/Toggle.svelte';
	import { updater } from '#lib/services/updater.svelte.js';
	import Menu from '../ui/Menu.svelte';
	import ScrollThumb from '../ui/ScrollThumb.svelte';
	import type { MenuEntry, MenuItem } from '#lib/overlays.svelte.js';
	import type Session from '#lib/models/Session.svelte.js';
	import type { ThemeEntry, ViewTab } from '#lib/models/Session.svelte.js';
	import {
		actions,
		keyTokens,
		keysFor,
		specFromEvent,
		keyCapture,
		SHORTCUT_CATEGORIES,
		type Action
	} from '#lib/shortcuts.js';
	import { onDestroy, onMount, type Component } from 'svelte';
	import {
		RotateCcw,
		Search,
		ChevronDown,
		SlidersHorizontal,
		Palette,
		Copy,
		Check,
		FolderPlus,
		FolderInput,
		EllipsisVertical,
		X,
		Keyboard,
		PenLine,
		LayoutGrid,
		AppWindow,
		FileText,
		Compass,
		Eye,
		ArrowUp,
		RotateCw,
		Scale,
		Plus
	} from '@lucide/svelte';

	let { viewTab, session }: { viewTab: ViewTab; session: Session } = $props();

	// sent here to add a source (the bookmark menu). An effect rather than a flag read at mount:
	// the page may already be open, in which case there is no mount to read it
	$effect(() => {
		if (!addSourceRequest.pending) return;
		addSourceRequest.take();
		activeSection = SOURCES;
		addSource();
	});

	const settings = $derived(session.settings);
	const GENERAL = 'general';
	const SOURCES = 'sources';
	const SHORTCUTS = 'shortcuts';
	const CUSTOM = 'custom';
	const registryTabs = SETTINGS_REGISTRY.filter((c) => c.id !== SOURCES);
	const sourcesCategory = SETTINGS_REGISTRY.find((c) => c.id === SOURCES);
	const sectionIds = [GENERAL, ...registryTabs.map((c) => c.id), SHORTCUTS, SOURCES];

	let activeSection = $state('');
	let contentEl: HTMLElement | null = $state(null);
	let themes: ThemeEntry[] = $state([]);
	let customKeys: string[] = $state([]);
	let confirmingReset = $state(false);
	let resetBusy = $state(false);
	function openNotices() {
		session.editors[0]?.openLicenses();
	}

	let activeCategory = $derived(SETTINGS_REGISTRY.find((c) => c.id === activeSection));

	// ── Settings search ───────────────────────────────────────────────────────
	let searchQuery = $state('');
	let headerWidth = $state(0);
	let isSearching = $derived(searchQuery.trim().length > 0);

	function matchesQuery(haystack: string): boolean {
		const tokens = searchQuery.trim().toLowerCase().split(/\s+/);
		const hay = haystack.toLowerCase();
		return tokens.every((t) => hay.includes(t));
	}

	const appearanceCategory = SETTINGS_REGISTRY.find((c) => c.id === 'appearance') ?? null;

	let themeMatches = $derived(
		searchQuery.trim().length > 0 && matchesQuery('Appearance Theme Active color theme accent')
	);

	let searchGroups = $derived.by((): { category: SettingCategory; defs: SettingDef[] }[] => {
		if (!searchQuery.trim()) return [];
		const groups: { category: SettingCategory; defs: SettingDef[] }[] = [];
		for (const category of SETTINGS_REGISTRY) {
			const defs = category.settings.filter((def) =>
				matchesQuery(`${category.label} ${def.label} ${def.key} ${def.description ?? ''}`)
			);
			const themed = themeMatches && category === appearanceCategory;
			if (defs.length > 0 || themed) groups.push({ category, defs });
		}
		return groups;
	});

	let resultCount = $derived(
		searchGroups.reduce((n, g) => n + g.defs.length, 0) + (themeMatches ? 2 : 0)
	);

	const sectionItems: MenuItem[] = [
		{ value: GENERAL, label: 'General', icon: SlidersHorizontal },
		...registryTabs.map((c) => ({
			value: c.id,
			label: c.label,
			icon: c.id === 'appearance' ? Palette : c.id === 'editor' ? PenLine : undefined
		})),
		{ value: SHORTCUTS, label: 'Shortcuts', icon: Keyboard },
		{ value: SOURCES, label: 'Sources', icon: FolderInput }
	];

	let currentItem = $derived(sectionItems.find((i) => i.value === activeSection));

	let sectionMenuOpen = $state(false);
	let sectionAnchor: HTMLElement | null = $state(null);

	function onSectionSelect(value: string) {
		sectionMenuOpen = false;
		selectSection(value);
	}

	// ── General tab ────────────────────────────────────────────────────────────
	let appInfo: AppInfo | null = $state(null);
	let keyCopied = $state(false);

	const updateStatus = $derived.by(() => {
		switch (updater.phase) {
			case 'checking':
				return 'Checking for updates…';
			case 'up-to-date':
				return "You're on the latest version.";
			case 'available':
				return `Limestone ${updater.version} is ready to install.`;
			case 'downloading':
				return `Downloading… ${Math.round(updater.progress * 100)}%`;
			case 'installing':
				return 'Installing. Limestone will restart.';
			case 'error':
				return updater.error || 'Update check failed.';
			default:
				return 'Check whether a newer version is available.';
		}
	});

	async function loadGeneral() {
		try {
			appInfo = await getAppInfo();
		} catch (e) {
			console.error('app info failed', e);
		}
	}

	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	async function copyDeviceKey() {
		if (!appInfo) return;
		try {
			await navigator.clipboard.writeText(appInfo.device_key);
			keyCopied = true;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => (keyCopied = false), 1400);
		} catch (e) {
			console.error('copy failed', e);
		}
	}

	// ── Sources tab ──────────────────────────────────────────────────────────
	let sources: Source[] = $state([]);
	let sourceCounts: Record<string, number> = $state({});
	let sourceError = $state('');

	let dialogOpen = $state(false);
	let dialogMode: 'create' | 'edit' = $state('create');
	let dialogSource: Source | null = $state(null);

	async function loadSources() {
		sources = await listSources();
		defaultSourceId = await getDefaultSourceId();
		for (const s of sources) countSource(s.id);
	}

	let defaultSourceId: string | null = $state(null);

	async function toggleDefaultSource(s: Source) {
		try {
			await setDefaultSource(s.id === defaultSourceId ? null : s.id);
			defaultSourceId = await getDefaultSourceId();
		} catch (e) {
			sourceError = describeError(e, "The default source couldn't be changed.");
		}
	}

	async function countSource(id: string) {
		try {
			const [row] = await select<{ c: number }>(
				`SELECT COUNT(*) as c
                     FROM documents
                     WHERE source_id = ?1
                       AND deleted_at IS NULL`,
				[id]
			);
			sourceCounts[id] = row?.c ?? 0;
		} catch {
			/* leave count unknown */
		}
	}

	function addSource() {
		sourceError = '';
		dialogMode = 'create';
		dialogSource = null;
		dialogOpen = true;
	}

	function editSource(s: Source) {
		sourceError = '';
		dialogMode = 'edit';
		dialogSource = s;
		dialogOpen = true;
	}

	async function removeSourceAction(s: Source) {
		try {
			await removeSource(s.id);
			await loadSources();
		} catch (e) {
			sourceError = describeError(e, "That source couldn't be removed.");
		}
	}

	async function revealSource(s: Source) {
		try {
			await openPath(s.path);
		} catch (e) {
			console.error('reveal failed', e);
		}
	}

	let srcMenuOpen = $state(false);
	let srcMenuAnchor: HTMLElement | null = $state(null);
	let menuSource: Source | null = $state(null);

	function openSourceMenu(s: Source, e: MouseEvent) {
		menuSource = s;
		srcMenuAnchor = e.currentTarget as HTMLElement;
		srcMenuOpen = true;
	}

	onMount(async () => {
		themes = await session.listThemes();
		accentSetting = (await getSetting<string>('appearance.accent')) ?? 'default';
		const saved = viewTab.state?.activeSection;
		activeSection = saved && sectionIds.includes(saved) ? saved : sectionIds[0];
		loadSources();
		loadGeneral();
	});

	// ── Accent ───────────────────────────────────────────────────────────────
	let accentSetting = $state('default');

	const themeType = $derived(session.themeType);
	const activeThemeName = $derived(
		themes.find((t) => t.key === session.activeTheme)?.name ?? session.activeTheme
	);
	const modeDef = $derived(
		appearanceCategory?.settings.find((d) => d.key === 'appearance.mode') ?? null
	);
	const accentIsCustom = $derived(accentSetting.startsWith('#'));

	function swatchColor(key: string): string {
		return resolveAccent(key, themeType)?.accent ?? 'transparent';
	}

	async function setAccent(value: string) {
		accentSetting = value;
		await setSetting('appearance.accent', value);
		await session.applyCurrentTheme();
	}

	let customDebounce: ReturnType<typeof setTimeout> | null = null;

	function onCustomAccent(e: Event) {
		const hex = (e.target as HTMLInputElement).value;
		if (customDebounce) clearTimeout(customDebounce);
		customDebounce = setTimeout(() => setAccent(hex), 120);
	}

	function saveTabState() {
		if (!viewTab.state) viewTab.state = {};
		viewTab.state.activeSection = activeSection;
		session.persist();
	}

	function selectSection(section: string) {
		activeSection = section;
		searchQuery = '';
		confirmingReset = false;
		stopCapture();
		saveTabState();
	}

	// ── Shortcuts tab ─────────────────────────────────────────────────────────
	let editing = $state<{ action: Action; index: number } | null>(null);
	let draftSpec = $state<string | null>(null);

	const editingExisting = $derived(
		!!editing && editing.index < keysFor(editing.action, settings).length
	);

	const draftConflict = $derived.by(() => {
		if (!editing || !draftSpec) return null;
		for (const a of actions) {
			const keys = keysFor(a, settings);
			for (let i = 0; i < keys.length; i++) {
				if (keys[i] !== draftSpec) continue;
				if (a.id === editing.action.id && i === editing.index) continue;
				return a;
			}
		}
		return null;
	});

	const CATEGORY_ICON: Record<string, Component> = {
		global: LayoutGrid,
		tabs: AppWindow,
		documents: FileText,
		navigation: Compass,
		views: Eye
	};

	const groupedShortcuts = $derived(
		SHORTCUT_CATEGORIES.map((cat) => ({
			cat,
			items: actions.filter((a) => a.category === cat.id)
		})).filter((g) => g.items.length > 0)
	);

	function setActionKeys(action: Action, keys: string[]) {
		const map = $state.snapshot(settings.get<Record<string, string[]>>('shortcuts')) ?? {};
		if (settingEquals(keys, action.defaultKeys ?? [])) delete map[action.id];
		else map[action.id] = keys;
		settings.set('shortcuts', map);
	}

	function startCapture(action: Action, index: number) {
		editing = { action, index };
		draftSpec = keysFor(action, settings)[index] ?? null;
		keyCapture.active = true;
	}

	function stopCapture() {
		editing = null;
		draftSpec = null;
		keyCapture.active = false;
	}

	function saveBinding() {
		if (editing && draftSpec) {
			const keys = [...keysFor(editing.action, settings)];
			keys[editing.index] = draftSpec;
			setActionKeys(editing.action, keys);
		}
		stopCapture();
	}

	function removeBinding() {
		if (editing) {
			const keys = [...keysFor(editing.action, settings)];
			keys.splice(editing.index, 1);
			setActionKeys(editing.action, keys);
		}
		stopCapture();
	}

	onDestroy(stopCapture);

	function onCaptureKey(e: KeyboardEvent) {
		if (!editing) return;
		if (e.key === 'Escape') return stopCapture();
		const bare = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
		if (e.key === 'Enter' && bare) return saveBinding();
		e.preventDefault();
		e.stopPropagation();
		const spec = specFromEvent(e);
		if (spec) draftSpec = spec;
	}

	function setValue(def: SettingDef, value: SettingValue) {
		settings.set(def.key, value);
	}

	async function resetOne(def: SettingDef) {
		customKeys = customKeys.filter((k) => k !== def.key);
		await settings.reset(def.key);
	}

	function commitNumber(def: SettingDef, e: Event) {
		const input = e.target as HTMLInputElement;
		let n = Number(input.value);
		if (isNaN(n)) {
			input.value = String(settings.get<number>(def.key));
			return;
		}
		if (def.min !== undefined) n = Math.max(def.min, n);
		if (def.max !== undefined) n = Math.min(def.max, n);
		input.value = String(n);
		setValue(def, n);
	}

	function applySelect(def: SettingDef, v: string) {
		if (v === CUSTOM) {
			if (!customKeys.includes(def.key)) customKeys.push(def.key);
			return;
		}
		customKeys = customKeys.filter((k) => k !== def.key);
		const option = def.options?.find((o) => String(o.value) === v);
		if (option) setValue(def, option.value);
	}

	// ── App-styled dropdowns (native <select> option lists can't match our menus) ─
	let themeMenuOpen = $state(false);
	let themeAnchor: HTMLElement | null = $state(null);
	const themeItems = $derived<MenuEntry[]>(
		themes.filter((t) => t.type === themeType).map((t) => ({ value: t.key, label: t.name }))
	);

	let selectMenuOpen = $state(false);
	let selectAnchor: HTMLElement | null = $state(null);
	let openSelectDef: SettingDef | null = $state(null);

	const openSelectItems = $derived.by((): MenuEntry[] => {
		const def = openSelectDef;
		if (!def) return [];
		const items: MenuEntry[] = (def.options ?? []).map((o) => ({
			value: String(o.value),
			label: o.label
		}));
		if (def.allowCustom) items.push({ value: CUSTOM, label: 'Custom…' });
		return items;
	});

	const openSelectValue = $derived.by(() => {
		const def = openSelectDef;
		if (!def) return '';
		const value = settings.get(def.key);
		const inOptions = (def.options ?? []).some((o) => o.value === value);
		const showCustom = def.allowCustom && (customKeys.includes(def.key) || !inOptions);
		return showCustom ? CUSTOM : String(value);
	});

	function openSelect(def: SettingDef, e: MouseEvent) {
		if (selectMenuOpen && openSelectDef === def) {
			selectMenuOpen = false;
			return;
		}
		openSelectDef = def;
		selectAnchor = e.currentTarget as HTMLElement;
		selectMenuOpen = true;
	}

	function onSelectMenu(v: string) {
		selectMenuOpen = false;
		if (openSelectDef) applySelect(openSelectDef, v);
	}

	async function confirmResetAll() {
		resetBusy = true;
		try {
			await resetAllSettings();
			await settings.load();
			customKeys = [];
			confirmingReset = false;
		} catch (e) {
			reportError(e, "Settings couldn't be reset.", confirmResetAll);
		}
		resetBusy = false;
	}
</script>

{#snippet groupHead(label: string, icon?: Component, trailing?: import('svelte').Snippet)}
	{@const Icon = icon}
	<div class="group-head">
		<span class="group-label">
			{#if Icon}<Icon size={12} strokeWidth={1.75} />{/if}
			{label}
		</span>
		<span class="rule"></span>
		{#if trailing}{@render trailing()}{/if}
	</div>
{/snippet}

{#snippet themeItem()}
	<div class="row">
		<div class="row-info">
			<span class="row-label">Theme</span>
			<span class="row-desc">Active color theme.</span>
		</div>
		<div class="row-control">
			<button
				class="chip-select"
				type="button"
				bind:this={themeAnchor}
				onclick={() => (themeMenuOpen = !themeMenuOpen)}
			>
				<span class="chip-select-value">{activeThemeName}</span>
				<ChevronDown size={13} strokeWidth={2} />
			</button>
		</div>
	</div>
{/snippet}

{#snippet accentItem()}
	<div class="row">
		<div class="row-info">
			<span class="row-label">Accent</span>
			<span class="row-desc">Accent color, applied over the active theme.</span>
		</div>
		<div class="row-control">
			<div class="accent-row">
				<button
					class="accent-swatch default-swatch"
					class:active={accentSetting === 'default'}
					type="button"
					title="Theme default"
					onclick={() => setAccent('default')}
				></button>
				{#each Object.entries(ACCENT_PRESETS) as [key, preset] (key)}
					<button
						class="accent-swatch"
						class:active={accentSetting === key}
						type="button"
						title={preset.name}
						style:background={swatchColor(key)}
						onclick={() => setAccent(key)}
					></button>
				{/each}
				<label
					class="accent-swatch custom"
					class:active={accentIsCustom}
					title="Custom"
					style:background={accentIsCustom ? accentSetting : undefined}
				>
					<input
						type="color"
						value={accentIsCustom ? accentSetting : '#C56836'}
						oninput={onCustomAccent}
					/>
					{#if !accentIsCustom}<Plus size={11} strokeWidth={2.25} />{/if}
				</label>
			</div>
		</div>
	</div>
{/snippet}

{#snippet numberField(def: SettingDef)}
	<span class="chip-input" class:has-unit={def.unit}>
		<input
			type="number"
			min={def.min}
			max={def.max}
			step={def.step}
			value={settings.get<number>(def.key)}
			onchange={(e) => commitNumber(def, e)}
		/>
		{#if def.unit}<span class="unit">{def.unit}</span>{/if}
	</span>
{/snippet}

{#snippet settingItem(def: SettingDef)}
	{@const modified = settings.isModified(def.key)}
	<div class="row">
		<div class="row-info">
			<span class="row-label">
				{#if def.icon}<def.icon size={13} strokeWidth={1.75} />{/if}
				{def.label}
				{#if modified}
					<button
						class="row-reset"
						type="button"
						title="Reset to default"
						onclick={() => resetOne(def)}
					>
						<RotateCcw size={11} strokeWidth={2} />
					</button>
				{/if}
			</span>
			{#if def.description}
				<span class="row-desc">{def.description}</span>
			{/if}
		</div>
		<div class="row-control">
			{#if def.control === 'toggle'}
				<Toggle
					bind:checked={() => settings.get<boolean>(def.key) ?? false, (v) => setValue(def, v)}
				/>
			{:else if def.control === 'stepper'}
				{@render numberField(def)}
			{:else if def.control === 'select'}
				{@const value = settings.get(def.key)}
				{@const inOptions = (def.options ?? []).some((o) => o.value === value)}
				{@const showCustom = def.allowCustom && (customKeys.includes(def.key) || !inOptions)}
				{#if showCustom}
					{@render numberField(def)}
				{/if}
				<button class="chip-select" type="button" onclick={(e) => openSelect(def, e)}>
					<span class="chip-select-value">
						{showCustom
							? 'Custom'
							: ((def.options ?? []).find((o) => o.value === value)?.label ?? String(value))}
					</span>
					<ChevronDown size={13} strokeWidth={2} />
				</button>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet combo(spec: string)}
	{#each keyTokens(spec) as tok, t (t)}
		{#if t > 0}<span class="key-plus">+</span>{/if}
		<kbd class="keycap">{tok}</kbd>
	{/each}
{/snippet}

{#snippet addSourceButton()}
	<button class="chip-btn" type="button" onclick={addSource}>
		<FolderPlus size={13} strokeWidth={1.75} />
		<span>Add source</span>
	</button>
{/snippet}

<svelte:window onkeydowncapture={onCaptureKey} />

<div class="settings-page">
	<div class="settings-top">
		<div
			class="bar"
			class:narrow={headerWidth > 0 && headerWidth < 760}
			bind:clientWidth={headerWidth}
		>
			<div class="section-tabs">
				{#each sectionItems as item (item.value)}
					{@const Icon = item.icon}
					<button
						class="section-tab"
						class:active={activeSection === item.value && !isSearching}
						type="button"
						onclick={() => selectSection(item.value)}
					>
						{#if Icon}<Icon size={14} strokeWidth={1.75} />{/if}
						<span>{item.label}</span>
					</button>
				{/each}
			</div>
			<button
				class="section-select"
				type="button"
				bind:this={sectionAnchor}
				onclick={() => (sectionMenuOpen = !sectionMenuOpen)}
			>
				{#if currentItem?.icon}
					{@const Icon = currentItem.icon}
					<Icon size={14} strokeWidth={1.75} />
				{/if}
				<span>{currentItem?.label ?? ''}</span>
				<ChevronDown size={13} strokeWidth={2} />
			</button>

			<label class="search-chip">
				<Search size={14} strokeWidth={1.75} />
				<input
					class="search-input"
					type="text"
					placeholder="Search settings"
					bind:value={searchQuery}
					onkeydown={(e) => {
						if (e.key !== 'Escape') return;
						if (searchQuery) searchQuery = '';
						else e.currentTarget.blur();
					}}
				/>
				{#if searchQuery}
					<button
						class="search-clear"
						type="button"
						aria-label="Clear search"
						onclick={() => (searchQuery = '')}
					>
						<X size={12} strokeWidth={2} />
					</button>
				{/if}
			</label>
		</div>
	</div>

	<div class="settings-body" bind:this={contentEl}>
		<div class="settings-inner">
			{#if isSearching}
				{#if resultCount === 0}
					<p class="empty">Nothing matches “{searchQuery.trim()}”</p>
				{:else}
					{#each searchGroups as group (group.category.id)}
						<section class="group">
							{@render groupHead(group.category.label)}
							{#if themeMatches && group.category === appearanceCategory}
								{@render themeItem()}
								{@render accentItem()}
							{/if}
							{#each group.defs as def (def.key)}
								{@render settingItem(def)}
							{/each}
						</section>
					{/each}
				{/if}
			{:else if activeSection === GENERAL}
				<section class="group">
					{@render groupHead('Limestone')}
					<div class="row">
						<div class="row-info">
							<span class="row-label">Version</span>
							<span class="row-desc">{updateStatus}</span>
							{#if updater.phase === 'downloading'}
								<span class="progress">
									<span class="progress-bar" style:width="{Math.round(updater.progress * 100)}%"
									></span>
								</span>
							{/if}
						</div>
						<div class="row-control">
							<code class="mono">{appInfo?.version ?? '…'}</code>
							{#if updater.phase === 'available'}
								<button class="chip-btn primary" type="button" onclick={() => updater.install()}>
									<ArrowUp size={13} strokeWidth={2.25} />
									Install {updater.version}
								</button>
							{:else if updater.phase === 'downloading' || updater.phase === 'installing'}
								<button class="chip-btn" type="button" disabled>
									{updater.phase === 'installing' ? 'Installing…' : 'Downloading…'}
								</button>
							{:else}
								<button
									class="chip-btn"
									type="button"
									disabled={updater.busy}
									onclick={() => updater.check()}
								>
									<RotateCw size={13} strokeWidth={2} />
									Check for updates
								</button>
							{/if}
						</div>
					</div>
					<div class="row">
						<div class="row-info">
							<span class="row-label">Automatic updates</span>
							<span class="row-desc">Download and install new versions on launch.</span>
						</div>
						<div class="row-control">
							<Toggle
								bind:checked={
									() => settings.get<boolean>('updates.auto_install') ?? false,
									(v) => settings.set('updates.auto_install', v)
								}
							/>
						</div>
					</div>
					<div class="row">
						<div class="row-info">
							<span class="row-label">Open source licenses</span>
							<span class="row-desc">Third-party components included in Limestone.</span>
						</div>
						<div class="row-control">
							<button class="chip-btn" type="button" onclick={openNotices}>
								<Scale size={13} strokeWidth={2} />
								View licenses
							</button>
						</div>
					</div>
				</section>

				<section class="group">
					{@render groupHead('Behavior')}
					<div class="row">
						<div class="row-info">
							<span class="row-label">Undo hints</span>
							<span class="row-desc">
								Show an Undo button for a few seconds after deleting a note.
							</span>
						</div>
						<div class="row-control">
							<Toggle
								bind:checked={
									() => settings.get<boolean>('general.action_hints') ?? true,
									(v) => settings.set('general.action_hints', v)
								}
							/>
						</div>
					</div>
				</section>

				<section class="group">
					{@render groupHead('This device')}
					<div class="row">
						<div class="row-info">
							<span class="row-label">Device key</span>
							<span class="row-desc">Local identifier for this device.</span>
						</div>
						<div class="row-control">
							<code class="mono">{appInfo?.device_key ?? '…'}</code>
							<button
								class="icon-btn"
								type="button"
								title="Copy device key"
								onclick={copyDeviceKey}
							>
								{#if keyCopied}
									<Check size={13} strokeWidth={2} />
								{:else}
									<Copy size={13} strokeWidth={1.75} />
								{/if}
							</button>
						</div>
					</div>
				</section>

				<div class="foot">
					{#if confirmingReset}
						<span class="foot-text"
							>Restore every setting to its default? Sources and themes stay.</span
						>
						<button class="chip-btn quiet" type="button" onclick={() => (confirmingReset = false)}>
							Cancel
						</button>
						<button
							class="chip-btn danger"
							type="button"
							disabled={resetBusy}
							onclick={confirmResetAll}
						>
							Reset all
						</button>
					{:else}
						<button class="text-btn" type="button" onclick={() => (confirmingReset = true)}>
							<RotateCcw size={12} strokeWidth={2} />
							Reset all settings
						</button>
					{/if}
				</div>
			{:else if activeSection === SHORTCUTS}
				{#each groupedShortcuts as group (group.cat.id)}
					<section class="group">
						{@render groupHead(group.cat.label, CATEGORY_ICON[group.cat.id])}
						{#each group.items as action (action.id)}
							{@const keys = keysFor(action, settings)}
							{@const live = editing?.action.id === action.id ? editing : null}
							<div class="row shortcut" class:listening={!!live}>
								<div class="row-info">
									<span class="row-label">{action.title}</span>
									{#if live && draftConflict}
										<span class="row-desc conflict">
											{#if draftConflict.id === action.id}
												This command already has that binding.
											{:else}
												Also used by “{draftConflict.title}”.
											{/if}
										</span>
									{:else if live}
										<span class="row-desc"
											>Press the keys you want. Enter saves, Escape cancels.</span
										>
									{/if}
								</div>
								<div class="row-control keys">
									{#if live}
										<span class="capture" class:empty={!draftSpec}>
											{#if draftSpec}
												{@render combo(draftSpec)}
											{:else}
												Press keys…
											{/if}
										</span>
										{#if editingExisting}
											<button class="chip-btn quiet remove" type="button" onclick={removeBinding}>
												Remove
											</button>
										{/if}
										<button class="chip-btn quiet" type="button" onclick={stopCapture}
											>Cancel</button
										>
										<button
											class="chip-btn primary"
											type="button"
											disabled={!draftSpec}
											onclick={saveBinding}
										>
											Save
										</button>
									{:else}
										<button
											class="chip-btn quiet add-bind"
											type="button"
											title="Add a binding"
											onclick={() => startCapture(action, keys.length)}
										>
											<Plus size={12} strokeWidth={2} />
											bind
										</button>
										{#each keys as key, i (i)}
											{#if i > 0}<span class="key-sep"></span>{/if}
											<button
												class="combo"
												type="button"
												title="Edit binding"
												onclick={() => startCapture(action, i)}
											>
												{@render combo(key)}
											</button>
										{/each}
									{/if}
								</div>
							</div>
						{/each}
					</section>
				{/each}
			{:else if activeSection === SOURCES}
				<section class="group">
					{@render groupHead('Sources', undefined, addSourceButton)}
					{#if sourceError}
						<p class="source-error">{sourceError}</p>
					{/if}
					{#each sources as s (s.id)}
						<div class="row source" class:unavailable={session.missingSources.has(s.id)}>
							<span class="source-icon"><FolderInput size={14} strokeWidth={1.75} /></span>
							<div class="row-info">
								<span class="row-label">
									{sourceName(s)}
									{#if s.id === defaultSourceId}
										<span class="default-pill">Default</span>
									{/if}
								</span>
								<span class="row-desc path" title={s.path}>{s.path}</span>
							</div>
							<div class="row-control">
								<span class="count">
									{#if sourceCounts[s.id] === undefined}
										…
									{:else}
										{sourceCounts[s.id]} {sourceCounts[s.id] === 1 ? 'doc' : 'docs'}
									{/if}
								</span>
								<button
									class="icon-btn"
									type="button"
									title="More"
									onclick={(e) => openSourceMenu(s, e)}
								>
									<EllipsisVertical size={14} strokeWidth={1.75} />
								</button>
							</div>
						</div>
					{:else}
						<p class="empty">No sources yet</p>
					{/each}
				</section>
				{#if sourcesCategory}
					<section class="group">
						{@render groupHead('Behavior')}
						{#each sourcesCategory.settings as def (def.key)}
							{@render settingItem(def)}
						{/each}
					</section>
				{/if}
			{:else if activeCategory}
				<section class="group">
					{#if activeCategory.id === 'appearance'}
						{#if modeDef}{@render settingItem(modeDef)}{/if}
						{@render themeItem()}
						{@render accentItem()}
					{/if}
					{#each activeCategory.settings.filter((d) => d !== modeDef) as def (def.key)}
						{@render settingItem(def)}
					{/each}
				</section>
			{/if}
		</div>
	</div>
	<ScrollThumb scroller={contentEl} top={12} />
</div>

<Menu
	bind:open={sectionMenuOpen}
	anchor={sectionAnchor}
	items={sectionItems}
	selected={activeSection}
	onSelect={onSectionSelect}
	minWidth={200}
/>

<Menu
	bind:open={themeMenuOpen}
	anchor={themeAnchor}
	items={themeItems}
	selected={session.activeTheme}
	onSelect={(v) => {
		themeMenuOpen = false;
		session.setTheme(v).catch((e) => console.error('set theme failed', e));
	}}
	minWidth={148}
/>

<Menu
	bind:open={selectMenuOpen}
	anchor={selectAnchor}
	items={openSelectItems}
	selected={openSelectValue}
	onSelect={onSelectMenu}
	minWidth={148}
/>

<SourceMenu
	bind:open={srcMenuOpen}
	anchor={srcMenuAnchor}
	source={menuSource}
	{defaultSourceId}
	missing={!!menuSource && session.missingSources.has(menuSource.id)}
	minWidth={180}
	onConfigure={editSource}
	onReveal={revealSource}
	onToggleDefault={toggleDefaultSource}
	onRemove={removeSourceAction}
/>

<SourceDialog
	bind:open={dialogOpen}
	mode={dialogMode}
	source={dialogSource}
	missing={!!dialogSource && session.missingSources.has(dialogSource.id)}
	onSaved={loadSources}
/>

<style>
	.settings-page {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		font-family: var(--font-ui);
		color: var(--color-text-primary);
	}

	/* ── Top bar ── */
	.settings-top {
		flex-shrink: 0;
		width: 100%;
		max-width: var(--view-max-width, 1000px);
		margin: 0 auto;
		padding: 47px 24px 0;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 24px 16px 14px;
	}

	.section-tabs {
		display: flex;
		align-items: center;
		gap: 2px;
		min-width: 0;
	}

	.section-tab,
	.section-select {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 32px;
		padding: 0 11px 0 10px;
		flex-shrink: 0;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 13px;
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.section-tab:hover {
		background: var(--chip-bg);
		color: var(--color-text-secondary);
	}

	.section-tab.active,
	.section-select {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.section-select:hover {
		background: var(--chip-bg-hover);
	}

	.section-select :global(svg:last-child) {
		color: var(--color-ui-muted);
	}

	.section-select {
		display: none;
	}

	.bar.narrow .section-tabs {
		display: none;
	}

	.bar.narrow .section-select {
		display: inline-flex;
	}

	.search-chip {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 32px;
		margin-left: auto;
		padding: 0 13px;
		flex: 0 1 260px;
		min-width: 120px;
		background: var(--chip-bg);
		border-radius: 999px;
		color: var(--color-ui-muted);
		font-size: 13px;
		cursor: text;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.search-chip:hover,
	.search-chip:focus-within,
	.search-chip:has(.search-input:not(:placeholder-shown)) {
		background: var(--chip-bg-hover);
		color: var(--color-text-secondary);
	}

	.search-input {
		flex: 1;
		min-width: 0;
		padding: 0;
		border: 0;
		outline: none;
		background: transparent;
		font: inherit;
		color: var(--color-text-primary);
	}

	.search-input::placeholder {
		color: var(--color-ui-muted);
	}

	.search-clear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.search-clear:hover {
		color: var(--color-text-primary);
		background: var(--chip-bg-hover);
	}

	/* ── Body ── */
	.settings-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		scrollbar-width: none;
	}

	.settings-body::-webkit-scrollbar {
		display: none;
	}

	.settings-inner {
		max-width: var(--view-max-width, 1000px);
		margin: 0 auto;
		padding: 6px 48px 72px;
	}

	.group {
		margin-top: 22px;
	}

	.group:first-child {
		margin-top: 4px;
	}

	.group-head {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 28px;
		margin-bottom: 2px;
	}

	.group-label {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-ui-muted);
	}

	.rule {
		flex: 1;
		height: 1px;
		margin: 0 14px 0 10px;
		background: var(--chip-divider);
	}

	.rule:last-child {
		margin-right: 0;
	}

	.empty {
		padding: 12px 0;
		font-size: 13px;
		color: var(--color-ui-muted);
	}

	/* ── Rows ── */
	.row {
		display: flex;
		align-items: center;
		gap: 16px;
		min-height: 44px;
		margin: 0 -10px;
		padding: 7px 10px;
		border-radius: 8px;
		transition: background-color 80ms ease;
	}

	.row:hover {
		background: var(--row-hover-bg, rgba(127, 127, 127, 0.06));
	}

	.row-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.row-label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 18px;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.row-label :global(svg) {
		color: var(--color-ui-muted);
	}

	.row-desc {
		font-size: 12px;
		line-height: 1.4;
		color: var(--color-ui-muted);
	}

	.row-desc.conflict {
		color: var(--error-fg);
	}

	.row-reset {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--color-ui-muted);
		opacity: 0;
		cursor: pointer;
		transition: opacity 80ms ease;
	}

	.row:hover .row-reset {
		opacity: 1;
	}

	.row-reset:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.row-control {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		flex-shrink: 0;
	}

	/* ── Controls ── */
	.chip-select,
	.chip-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 10px;
		border: 0;
		border-radius: 6px;
		background: var(--chip-bg);
		font-family: var(--font-ui);
		font-size: 12px;
		font-weight: 500;
		line-height: 1;
		color: var(--color-text-primary);
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease,
			opacity 120ms ease;
	}

	.chip-select {
		gap: 4px;
		min-width: 110px;
		padding-right: 7px;
	}

	.chip-select-value {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: left;
	}

	.chip-select :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.chip-select:hover,
	.chip-btn:hover:not(:disabled) {
		background: var(--chip-bg-hover);
	}

	.chip-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.chip-btn :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.chip-btn.quiet {
		background: transparent;
		color: var(--color-ui-muted);
	}

	.chip-btn.quiet:hover:not(:disabled) {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.chip-btn.primary,
	.chip-btn.primary :global(svg) {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
	}

	.chip-btn.primary:hover:not(:disabled) {
		background: var(--color-accent);
		opacity: 0.9;
	}

	.chip-btn.danger {
		background: var(--error-bg);
		color: var(--error-fg);
	}

	.chip-btn.danger:hover:not(:disabled) {
		background: var(--error-bg);
		opacity: 0.85;
	}

	.chip-btn.remove {
		margin-right: auto;
		color: var(--error-fg);
	}

	.chip-btn.remove:hover:not(:disabled) {
		background: var(--error-bg);
		color: var(--error-fg);
	}

	.chip-input {
		position: relative;
		display: inline-flex;
		align-items: center;
		height: 28px;
		width: 88px;
		border-radius: 6px;
		background: var(--chip-bg);
		transition: background-color 120ms ease;
	}

	.chip-input:hover,
	.chip-input:focus-within {
		background: var(--chip-bg-hover);
	}

	.chip-input input {
		width: 100%;
		height: 100%;
		padding: 0 10px;
		border: 0;
		outline: none;
		background: transparent;
		font-family: var(--font-ui);
		font-size: 12px;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.chip-input.has-unit input {
		padding-right: 34px;
	}

	.unit {
		position: absolute;
		right: 10px;
		font-size: 11px;
		color: var(--color-ui-muted);
		pointer-events: none;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.icon-btn:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.text-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 0;
		border: none;
		background: none;
		font-family: var(--font-ui);
		font-size: 12px;
		font-weight: 500;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.text-btn:hover {
		color: var(--color-text-primary);
		text-decoration: underline;
	}

	.mono {
		max-width: 260px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.progress {
		display: block;
		width: 180px;
		height: 3px;
		margin-top: 6px;
		border-radius: 2px;
		background: var(--chip-divider);
		overflow: hidden;
	}

	.progress-bar {
		display: block;
		height: 100%;
		background: var(--color-accent);
		transition: width 120ms linear;
	}

	.foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 36px;
	}

	.foot-text {
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	/* ── Accent ── */
	.accent-row {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	.accent-swatch {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		border-radius: 50%;
		cursor: pointer;
	}

	.default-swatch {
		background: var(--color-accent-default);
	}

	.default-swatch::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--color-bg);
		transform: translate(-50%, -50%);
	}

	.accent-swatch.active {
		outline: 2px solid var(--color-ui-muted);
		outline-offset: 2px;
	}

	.accent-swatch.custom {
		background: var(--chip-bg);
		color: var(--color-ui-muted);
	}

	.accent-swatch.custom:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.accent-swatch.custom input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}

	.accent-swatch.custom :global(svg) {
		pointer-events: none;
	}

	/* ── Sources ── */
	.source-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		background: var(--chip-bg);
		color: var(--color-ui-muted);
	}

	.default-pill {
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--accent-a14);
		color: var(--color-accent);
		font-size: 11px;
		font-weight: 500;
		white-space: nowrap;
	}

	.row-desc.path {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.count {
		font-size: 12px;
		color: var(--color-ui-muted);
		white-space: nowrap;
	}

	.row.source .icon-btn {
		opacity: 0;
	}

	.row.source:hover .icon-btn {
		opacity: 1;
	}

	.row.unavailable .source-icon,
	.row.unavailable .row-label,
	.row.unavailable .count {
		opacity: 0.45;
	}

	.source-error {
		margin: 4px 0 8px;
		padding: 8px 12px;
		border-radius: 6px;
		background: var(--error-bg);
		color: var(--error-fg);
		font-size: 12px;
	}

	/* ── Shortcuts ── */
	.row.shortcut {
		min-height: 40px;
	}

	.row.listening {
		background: var(--chip-bg);
	}

	.keys {
		gap: 6px;
	}

	.combo {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 0;
		border: none;
		background: transparent;
		font: inherit;
		cursor: pointer;
	}

	.keycap {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		height: 22px;
		padding: 0 6px;
		border-radius: 5px;
		background: var(--chip-bg);
		box-shadow: inset 0 -1.5px 0 var(--chip-divider);
		font-family: var(--font-ui);
		font-size: 11px;
		font-weight: 500;
		color: var(--color-text-secondary);
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.combo:hover .keycap {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.key-plus {
		font-size: 11px;
		color: var(--color-ui-muted);
	}

	.key-sep {
		flex-shrink: 0;
		width: 1px;
		height: 14px;
		margin: 0 4px;
		border-radius: 999px;
		background: var(--color-border);
	}

	.add-bind {
		height: 22px;
		padding: 0 7px 0 5px;
		font-size: 11px;
		opacity: 0;
	}

	.row.shortcut:hover .add-bind {
		opacity: 1;
	}

	.capture {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		min-width: 110px;
		height: 28px;
		padding: 0 10px;
		border-radius: 6px;
		background: var(--accent-a14);
		font-size: 12px;
		color: var(--color-accent);
	}

	.capture.empty {
		justify-content: center;
	}

	.capture .keycap {
		background: var(--color-bg);
		color: var(--color-text-primary);
	}
</style>
