<script lang="ts">
	import {
		resetAllSettings,
		getAppInfo,
		getSetting,
		setSetting,
		SETTINGS_REGISTRY,
		settingEquals,
		type AppInfo,
		type SettingCategory,
		type SettingDef
	} from '$lib/models/Settings.svelte';
	import { ACCENT_PRESETS, BUILTIN_THEMES, resolveAccent } from '$lib/services/theme';
	import {
		getDefaultSourceId,
		listSources,
		removeSource,
		setDefaultSource,
		sourceName,
		type Source
	} from '$lib/models/Source';
	import { select } from '$lib/services/db';
	import { openPath } from '@tauri-apps/plugin-opener';
	import SourceDialog from '../SourceDialog.svelte';
	import SourceMenu from '../SourceMenu.svelte';
	import Toggle from '../Toggle.svelte';
	import { updater } from '$lib/services/updater.svelte';
	import Menu from '../views/Menu.svelte';
	import ScrollThumb from '../ScrollThumb.svelte';
	import type { MenuEntry, MenuItem } from '$lib/views/menuTypes';
	import type Session from '$lib/models/Session.svelte.js';
	import type { ViewTab } from '$lib/models/Session.svelte.js';
	import {
		actions,
		keyTokens,
		keysFor,
		specFromEvent,
		keyCapture,
		SHORTCUT_CATEGORIES,
		type Action
	} from '$lib/actions';
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
		Folders,
		EllipsisVertical,
		X,
		Keyboard,
		LayoutGrid,
		AppWindow,
		FileText,
		Compass,
		Eye,
		ArrowUp,
		RotateCw
	} from '@lucide/svelte';

	let { viewTab, session }: { viewTab: ViewTab; session: Session } = $props();

	const settings = $derived(session.settings);
	const GENERAL = 'general';
	const SOURCES = 'sources';
	const SHORTCUTS = 'shortcuts';
	const CUSTOM = 'custom';
	const sectionIds = [GENERAL, ...SETTINGS_REGISTRY.map((c) => c.id), SHORTCUTS, SOURCES];

	let activeSection = $state('');
	let contentEl: HTMLElement | null = $state(null);
	let themes: string[] = $state([]);
	let customKeys: string[] = $state([]);
	let resetDialogOpen = $state(false);
	let resetBusy = $state(false);

	let activeCategory = $derived(SETTINGS_REGISTRY.find((c) => c.id === activeSection));

	// ── Settings search ───────────────────────────────────────────────────────
	let searchQuery = $state('');
	let isSearching = $derived(searchQuery.trim().length > 0);

	function matchesQuery(haystack: string): boolean {
		const tokens = searchQuery.trim().toLowerCase().split(/\s+/);
		const hay = haystack.toLowerCase();
		return tokens.every((t) => hay.includes(t));
	}

	const appearanceCategory = SETTINGS_REGISTRY.find((c) => c.id === 'appearance') ?? null;

	let searchResults = $derived.by((): { category: SettingCategory; def: SettingDef }[] => {
		if (!searchQuery.trim()) return [];
		const results: { category: SettingCategory; def: SettingDef }[] = [];
		for (const category of SETTINGS_REGISTRY) {
			for (const def of category.settings) {
				if (matchesQuery(`${category.label} ${def.label} ${def.key} ${def.description ?? ''}`)) {
					results.push({ category, def });
				}
			}
		}
		return results;
	});

	let themeMatches = $derived(
		searchQuery.trim().length > 0 && matchesQuery('Appearance Theme Active color theme accent')
	);
	let resultCount = $derived(searchResults.length + (themeMatches ? 1 : 0));

	const sectionItems: MenuItem[] = [
		{ value: GENERAL, label: 'General', icon: SlidersHorizontal },
		...SETTINGS_REGISTRY.map((c) => ({
			value: c.id,
			label: c.label,
			icon: c.id === 'appearance' ? Palette : undefined
		})),
		{ value: SHORTCUTS, label: 'Shortcuts', icon: Keyboard },
		{ value: SOURCES, label: 'Sources', icon: Folders }
	];

	function sectionLabel(id: string): string {
		if (id === GENERAL) return 'General';
		if (id === SOURCES) return 'Sources';
		if (id === SHORTCUTS) return 'Shortcuts';
		return SETTINGS_REGISTRY.find((c) => c.id === id)?.label ?? id;
	}

	let currentLabel = $derived(sectionLabel(activeSection));

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
			sourceError = String(e);
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
			sourceError = String(e);
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

	const themeType = $derived(BUILTIN_THEMES[session.activeTheme]?.type ?? 'dark');
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
		closeBindingDialog();
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

	function openBindingDialog(action: Action, index: number) {
		editing = { action, index };
		draftSpec = keysFor(action, settings)[index] ?? null;
		keyCapture.active = true;
	}

	function closeBindingDialog() {
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
		closeBindingDialog();
	}

	function removeBinding() {
		if (editing) {
			const keys = [...keysFor(editing.action, settings)];
			keys.splice(editing.index, 1);
			setActionKeys(editing.action, keys);
		}
		closeBindingDialog();
	}

	onDestroy(closeBindingDialog);

	function onDialogKey(e: KeyboardEvent) {
		if (!editing) return;
		if (e.key === 'Escape') return closeBindingDialog();
		const bare = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
		if (e.key === 'Enter' && bare) return saveBinding();
		e.preventDefault();
		e.stopPropagation();
		const spec = specFromEvent(e);
		if (spec) draftSpec = spec;
	}

	function setValue(def: SettingDef, value: boolean | number) {
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
		if (option) setValue(def, option.value as number);
	}

	// ── App-styled dropdowns (native <select> option lists can't match our menus) ─
	let themeMenuOpen = $state(false);
	let themeAnchor: HTMLElement | null = $state(null);
	const themeItems = $derived<MenuEntry[]>(themes.map((name) => ({ value: name, label: name })));

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
			resetDialogOpen = false;
		} catch (e) {
			console.error('reset settings failed', e);
		}
		resetBusy = false;
	}
</script>

{#snippet themeItem(category: SettingCategory | null)}
	<div class="setting-item">
		<div class="item-info">
			<div class="item-head">
				<span class="item-label">
					{#if category}<span class="item-cat">{category.label}:</span>
					{/if}Theme
				</span>
			</div>
			<p class="item-desc">Active color theme.</p>
		</div>
		<div class="item-control">
			<div class="select-field">
				<button
					class="input-select select-trigger"
					bind:this={themeAnchor}
					onclick={() => (themeMenuOpen = !themeMenuOpen)}
				>
					<span class="select-value">{session.activeTheme}</span>
				</button>
				<span class="select-chevron"><ChevronDown size={14} strokeWidth={2} /></span>
			</div>
		</div>
	</div>
{/snippet}

{#snippet accentItem(category: SettingCategory | null)}
	<div class="setting-item">
		<div class="item-info">
			<div class="item-head">
				<span class="item-label">
					{#if category}<span class="item-cat">{category.label}:</span>
					{/if}Accent
				</span>
			</div>
			<p class="item-desc">Accent color, applied over the active theme.</p>
		</div>
		<div class="item-control">
			<div class="accent-row">
				<button
					class="accent-swatch default-swatch"
					class:active={accentSetting === 'default'}
					title="Theme default"
					onclick={() => setAccent('default')}
				></button>
				{#each Object.entries(ACCENT_PRESETS) as [key, preset] (key)}
					<button
						class="accent-swatch"
						class:active={accentSetting === key}
						title={preset.name}
						style:background={swatchColor(key)}
						onclick={() => setAccent(key)}
					></button>
				{/each}
				<label
					class="accent-swatch custom"
					class:active={accentIsCustom}
					title="Custom"
					style:background={accentIsCustom ? accentSetting : 'transparent'}
				>
					<input
						type="color"
						value={accentIsCustom ? accentSetting : '#567b67'}
						oninput={onCustomAccent}
					/>
					{#if !accentIsCustom}<span class="custom-mark">+</span>{/if}
				</label>
			</div>
		</div>
	</div>
{/snippet}

{#snippet numberField(def: SettingDef)}
	<div class="num-field">
		<input
			class="input-number"
			class:has-unit={def.unit}
			type="number"
			min={def.min}
			max={def.max}
			step={def.step}
			value={settings.get<number>(def.key)}
			onchange={(e) => commitNumber(def, e)}
		/>
		{#if def.unit}<span class="num-unit">{def.unit}</span>{/if}
	</div>
{/snippet}

{#snippet settingItem(def: SettingDef, category: SettingCategory | null)}
	{@const modified = settings.isModified(def.key)}
	<div class="setting-item" class:modified>
		<div class="item-info">
			<div class="item-head">
				<span class="item-label">
					{#if category}<span class="item-cat">{category.label}:</span>
					{/if}{def.label}
				</span>
				{#if modified}
					<button class="item-reset" title="Reset to default" onclick={() => resetOne(def)}>
						<RotateCcw size={12} />
					</button>
				{/if}
			</div>
			{#if def.description}
				<p class="item-desc">{def.description}</p>
			{/if}
		</div>
		<div class="item-control">
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
				<div class="select-control">
					<div class="select-field">
						<button class="input-select select-trigger" onclick={(e) => openSelect(def, e)}>
							<span class="select-value">
								{showCustom
									? 'Custom…'
									: ((def.options ?? []).find((o) => o.value === value)?.label ?? String(value))}
							</span>
						</button>
						<span class="select-chevron"><ChevronDown size={14} strokeWidth={2} /></span>
					</div>
					{#if showCustom}
						{@render numberField(def)}
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/snippet}

<svelte:window onkeydowncapture={onDialogKey} />

<div class="settings-page">
	<div class="settings-header">
		<div class="section-nav">
			<div class="section-tabs">
				{#each sectionItems as item (item.value)}
					{@const Icon = item.icon}
					<button
						class="section-tab"
						class:active={activeSection === item.value}
						onclick={() => selectSection(item.value)}
					>
						{#if Icon}<Icon size={14} strokeWidth={1.75} />{/if}
						<span>{item.label}</span>
					</button>
				{/each}
			</div>
			<button
				class="section-select"
				bind:this={sectionAnchor}
				onclick={() => (sectionMenuOpen = !sectionMenuOpen)}
			>
				<span class="section-select-label">{currentLabel}</span>
				<ChevronDown size={14} strokeWidth={2} />
			</button>
		</div>
		<div class="header-actions">
			<div class="search-bar">
				<Search size={14} />
				<input
					class="search-input"
					type="text"
					placeholder="Search settings"
					bind:value={searchQuery}
					onkeydown={(e) => e.key === 'Escape' && (searchQuery = '')}
				/>
				{#if searchQuery}
					<button class="search-clear" title="Clear search" onclick={() => (searchQuery = '')}>
						<X size={12} />
					</button>
				{/if}
			</div>
		</div>
	</div>

	<div class="settings-scroll">
		<div class="settings-content" bind:this={contentEl}>
			<div class="settings-inner">
				{#if isSearching}
					<p class="results-count">
						{resultCount}
						{resultCount === 1 ? 'setting' : 'settings'} found
					</p>
					<div class="settings-list">
						{#if themeMatches}
							{@render themeItem(appearanceCategory)}
							{@render accentItem(appearanceCategory)}
						{/if}
						{#each searchResults as { category, def } (def.key)}
							{@render settingItem(def, category)}
						{/each}
						{#if resultCount === 0}
							<p class="empty">No matching settings</p>
						{/if}
					</div>
				{:else if activeSection === GENERAL}
					<div class="settings-list">
						<!-- prettier-ignore -->
						<div class="general-banner">
<pre class="ascii-logo">              ,,
`7MMF'        db                                      mm
  MM                                                  MM
  MM        `7MM  `7MMpMMMb.pMMMb.  .gP"Ya  ,pP"Ybd mmMMmm ,pW"Wq.`7MMpMMMb.  .gP"Ya
  MM          MM    MM    MM    MM ,M'   Yb 8I   `"   MM  6W'   `Wb MM    MM ,M'   Yb
  MM      ,   MM    MM    MM    MM 8M"""""" `YMMMa.   MM  8M     M8 MM    MM 8M""""""
  MM     ,M   MM    MM    MM    MM YM.    , L.   I8   MM  YA.   ,A9 MM    MM YM.    ,
.JMMmmmmMMM .JMML..JMML  JMML  JMML.`Mbmmd' M9mmmP'   `Mbmo`Ybmd9'.JMML  JMML.`Mbmmd'</pre>
				</div>
						<div class="info-list">
							<div class="info-row">
								<div class="item-info">
									<span class="item-label">Version</span>
									<p class="item-desc">Installed application version.</p>
								</div>
								<div class="info-value">
									<code class="info-mono">{appInfo?.version ?? '…'}</code>
								</div>
							</div>
							<div class="info-row">
								<div class="item-info">
									<span class="item-label">Updates</span>
									<p class="item-desc">{updateStatus}</p>
									{#if updater.phase === 'downloading'}
										<div class="update-progress">
											<div
												class="update-progress-bar"
												style="width: {Math.round(updater.progress * 100)}%"
											></div>
										</div>
									{/if}
								</div>
								<div class="info-value">
									{#if updater.phase === 'available'}
										<button class="update-btn primary" onclick={() => updater.install()}>
											<ArrowUp size={13} strokeWidth={2.25} />
											Install {updater.version}
										</button>
									{:else if updater.phase === 'downloading' || updater.phase === 'installing'}
										<button class="update-btn" disabled>
											{updater.phase === 'installing' ? 'Installing…' : 'Downloading…'}
										</button>
									{:else}
										<button
											class="update-btn"
											disabled={updater.busy}
											onclick={() => updater.check()}
										>
											<RotateCw size={13} strokeWidth={2.25} />
											Check for updates
										</button>
									{/if}
								</div>
							</div>
							<div class="info-row">
								<div class="item-info">
									<span class="item-label">Automatic updates</span>
									<p class="item-desc">Download and install new versions on launch.</p>
								</div>
								<div class="info-value">
									<Toggle
										bind:checked={
											() => settings.get<boolean>('updates.auto_install') ?? false,
											(v) => settings.set('updates.auto_install', v)
										}
									/>
								</div>
							</div>
							<div class="info-row">
								<div class="item-info">
									<span class="item-label">Device key</span>
									<p class="item-desc">Local identifier for this device.</p>
								</div>
								<div class="info-value">
									<code class="info-mono">{appInfo?.device_key ?? '…'}</code>
									<button class="copy-btn" title="Copy device key" onclick={copyDeviceKey}>
										{#if keyCopied}
											<Check size={13} />
										{:else}
											<Copy size={13} />
										{/if}
									</button>
								</div>
							</div>
						</div>

						<button class="reset-settings-btn" onclick={() => (resetDialogOpen = true)}>
							<RotateCcw size={14} />
							Reset all settings to defaults
						</button>
					</div>
				{:else if activeSection === SHORTCUTS}
					<div class="shortcuts">
						{#each groupedShortcuts as group (group.cat.id)}
							{@const CatIcon = CATEGORY_ICON[group.cat.id]}
							<div class="shortcut-group">
								<div class="shortcut-head">
									{#if CatIcon}<CatIcon size={13} strokeWidth={1.75} />{/if}
									<span>{group.cat.label}</span>
								</div>
								{#each group.items as action (action.id)}
									{@const keys = keysFor(action, settings)}
									<div class="shortcut-row">
										<span class="shortcut-label">{action.title}</span>
										<span class="shortcut-keys">
											<button
												class="new-bind"
												title="Add binding"
												onclick={() => openBindingDialog(action, keys.length)}
											>
												new bind
											</button>
											{#each keys as key, i (i)}
												{#if i > 0}<span class="key-sep">,</span>{/if}
												<button
													class="combo"
													title="Edit binding"
													onclick={() => openBindingDialog(action, i)}
												>
													{#each keyTokens(key) as tok, t (t)}
														{#if t > 0}<span class="key-plus">+</span>{/if}
														<kbd class="keycap">{tok}</kbd>
													{/each}
												</button>
											{/each}
										</span>
									</div>
								{/each}
							</div>
						{/each}
					</div>
				{:else if activeSection === SOURCES}
					{#if sourceError}
						<p class="source-error">{sourceError}</p>
					{/if}
					<div class="sources-list">
						<button class="source-card add-source-card" onclick={addSource}>
							<FolderPlus size={14} />
							<span>Add source</span>
						</button>
						{#each sources as s (s.id)}
							<div class="source-card">
								<div class="src-main">
									<div class="src-title-row">
										<Folders size={13} />
										<span class="src-title">{sourceName(s)}</span>
										{#if s.id === defaultSourceId}
											<span class="src-default">Default</span>
										{/if}
									</div>
									<span class="src-path" title={s.path}>{s.path}</span>
								</div>
								<div class="src-right">
									<span class="src-count">
										{#if sourceCounts[s.id] === undefined}
											…
										{:else}
											{sourceCounts[s.id]} {sourceCounts[s.id] === 1 ? 'doc' : 'docs'}
										{/if}
									</span>
									<button class="src-btn" title="More" onclick={(e) => openSourceMenu(s, e)}>
										<EllipsisVertical size={14} />
									</button>
								</div>
							</div>
						{:else}
							<p class="sources-empty">No sources yet</p>
						{/each}
					</div>
				{:else if activeCategory}
					<div class="settings-list">
						{#if activeCategory.id === 'appearance'}
							{@render themeItem(null)}
							{@render accentItem(null)}
						{/if}
						{#each activeCategory.settings as def (def.key)}
							{@render settingItem(def, null)}
						{/each}
					</div>
				{/if}
			</div>
		</div>
		<ScrollThumb scroller={contentEl} top={12} />
	</div>
</div>

<Menu
	bind:open={sectionMenuOpen}
	anchor={sectionAnchor}
	items={sectionItems}
	selected={activeSection}
	onSelect={onSectionSelect}
	searchable
	minWidth={220}
	placeholder="Search sections…"
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

{#if resetDialogOpen}
	<div class="overlay" onclick={() => (resetDialogOpen = false)} role="presentation">
		<div
			class="dialog"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && (resetDialogOpen = false)}
			role="dialog"
			tabindex="-1"
		>
			<h3 class="dialog-title">Reset settings</h3>
			<p class="dialog-text">
				Restore every setting to its default value? Sources and themes are not affected.
			</p>
			<div class="dialog-actions">
				<button class="btn" onclick={() => (resetDialogOpen = false)}>Cancel</button>
				<button class="btn danger" disabled={resetBusy} onclick={confirmResetAll}>
					Reset all
				</button>
			</div>
		</div>
	</div>
{/if}

{#if editing}
	<div class="overlay" onclick={closeBindingDialog} role="presentation">
		<div class="dialog" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
			<h3 class="dialog-title">{editing.action.title}</h3>
			<p class="dialog-text">Press the keys you want, then Enter to save. Escape to cancel.</p>
			<div class="capture" class:empty={!draftSpec}>
				{#if draftSpec}
					<span class="combo">
						{#each keyTokens(draftSpec) as tok, t (t)}
							{#if t > 0}<span class="key-plus">+</span>{/if}
							<kbd class="keycap">{tok}</kbd>
						{/each}
					</span>
				{:else}
					<span class="capture-ph">Press desired keys…</span>
				{/if}
			</div>
			{#if draftConflict}
				<p class="conflict">
					{#if draftConflict.id === editing.action.id}
						This command already has that binding.
					{:else}
						Also used by “{draftConflict.title}”.
					{/if}
				</p>
			{/if}
			<div class="dialog-actions">
				{#if editingExisting}
					<button class="btn remove" onclick={removeBinding}>Remove</button>
				{/if}
				<button class="btn" onclick={closeBindingDialog}>Cancel</button>
				<button class="btn danger" disabled={!draftSpec} onclick={saveBinding}>Save</button>
			</div>
		</div>
	</div>
{/if}

<SourceMenu
	bind:open={srcMenuOpen}
	anchor={srcMenuAnchor}
	source={menuSource}
	{defaultSourceId}
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
	onSaved={loadSources}
/>

<style>
	.settings-page {
		--control-w: 148px;
		display: flex;
		flex-direction: column;
		height: 100%;
		font-family: var(--font-ui);
	}

	/* ── Header (section tabs / dropdown) ── */
	.settings-header {
		container-type: inline-size;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		max-width: var(--page-max-width, none);
		margin: 0 auto;
		padding: 24px 32px 14px;
		box-sizing: border-box;
	}

	.section-nav {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	/* Wide: a row of tabs. Narrow: collapses to the dropdown (see @container below). */
	.section-tabs {
		display: flex;
		align-items: center;
		gap: 2px;
		margin-left: -6px;
	}

	.section-tab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 12px;
		border: none;
		border-radius: var(--radius-ui);
		background: transparent;
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 14px;
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.section-tab :global(svg) {
		color: var(--color-ui-muted);
		transition: color 120ms ease;
	}

	.section-tab:hover {
		background: var(--chip-bg);
		color: var(--color-text-secondary);
	}

	.section-tab.active {
		background: var(--chip-bg);
		color: var(--color-text-primary);
		font-weight: 600;
	}

	.section-tab.active :global(svg) {
		color: var(--color-text-primary);
	}

	.section-select {
		display: none;
	}

	@container (max-width: 720px) {
		.section-tabs {
			display: none;
		}

		.section-select {
			display: inline-flex;
		}
	}

	.settings-header::after {
		content: '';
		position: absolute;
		left: 32px;
		right: 32px;
		bottom: 0;
		height: 1px;
		background: var(--color-border);
	}

	/* Visibility is owned by the header container query above; matches an active tab. */
	.section-select {
		align-items: center;
		gap: 6px;
		margin-left: -6px;
		padding: 7px 12px;
		border: none;
		border-radius: var(--radius-ui);
		background: var(--chip-bg);
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}

	.section-select:hover {
		background: var(--chip-bg-hover);
	}

	.section-select :global(svg) {
		color: var(--color-ui-muted);
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.search-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 240px;
		max-width: 40vw;
		padding: 7px 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-ui);
		color: var(--color-ui-muted);
	}

	.search-bar:focus-within {
		border-color: var(--focus-border);
	}

	.search-input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		outline: none;
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 13px;
	}

	.search-input::placeholder {
		color: var(--color-ui-muted);
	}

	.search-clear {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
		border: none;
		border-radius: var(--radius-ui);
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.search-clear:hover {
		color: var(--color-text-primary);
	}

	.results-count {
		margin: 0 0 18px;
		font-size: 13px;
		color: var(--color-ui-muted);
	}

	.empty {
		padding: 12px 0;
		color: var(--color-ui-muted);
		font-size: 14px;
	}

	.reset-settings-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 36px;
		padding: 8px 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-ui);
		background: transparent;
		color: var(--color-ui-dulled);
		font-family: var(--font-ui);
		font-size: 12px;
		cursor: pointer;
		align-self: flex-end;
	}

	.reset-settings-btn:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	/* ── Content ── */
	.settings-scroll {
		position: relative;
		display: flex;
		flex: 1;
		min-height: 0;
		width: 100%;
		max-width: var(--page-max-width, none);
		margin-left: auto;
		margin-right: auto;
	}

	.settings-content {
		flex: 1;
		min-width: 0;
		padding: 24px 32px 48px;
		box-sizing: border-box;
		overflow-y: auto;
		scrollbar-width: none;
		mask-image: linear-gradient(
			to bottom,
			transparent,
			black 12px,
			black calc(100% - 28px),
			transparent
		);
		-webkit-mask-image: linear-gradient(
			to bottom,
			transparent,
			black 12px,
			black calc(100% - 28px),
			transparent
		);
	}

	.settings-content::-webkit-scrollbar {
		display: none;
	}

	/* ── General tab ── */
	.general-banner {
		container-type: inline-size;
		width: 100%;
		padding: 12px 0 40px;
		text-align: center;
	}

	.ascii-logo {
		display: inline-block;
		margin: 0;
		font-family: var(--font-editor, monospace);
		font-size: min(calc(100cqw / 80), 13px);
		line-height: 1.15;
		white-space: pre;
		text-align: left;
		color: var(--color-ui-muted);
	}

	.info-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 20px;
	}

	.info-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		padding: 12px 16px;
		margin: 0 -16px;
		border-radius: var(--radius-ui);
	}

	.info-row:hover {
		background: var(--chip-bg);
	}

	.info-value {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.info-mono {
		font-family: var(--font-editor, monospace);
		font-size: 12px;
		color: var(--color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.copy-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		padding: 4px;
		border: none;
		border-radius: var(--radius-ui);
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.copy-btn:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.update-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		padding: 5px 10px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-ui);
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 12px;
		line-height: 1;
		cursor: pointer;
	}

	.update-btn:hover:not(:disabled) {
		background: var(--chip-bg);
	}

	.update-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.update-btn.primary {
		border-color: var(--color-accent);
		background: var(--color-accent);
		color: var(--color-accent-contrast);
	}

	.update-progress {
		margin-top: 8px;
		width: 180px;
		height: 4px;
		border-radius: 2px;
		background: var(--color-border);
		overflow: hidden;
	}

	.update-progress-bar {
		height: 100%;
		background: var(--color-accent);
		transition: width 0.12s linear;
	}

	.settings-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	/* ── Setting item ── */
	.setting-item {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		padding: 14px 16px;
		margin: 0 -16px;
		border-radius: var(--radius-ui);
	}

	.item-info {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.setting-item:hover {
		background: var(--chip-bg);
	}

	.item-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.item-label {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.item-cat {
		color: var(--color-ui-muted);
	}

	.item-reset {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
		border: none;
		border-radius: var(--radius-ui);
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
		opacity: 0;
	}

	.setting-item:hover .item-reset {
		opacity: 1;
	}

	.item-reset:hover {
		color: var(--color-text-primary);
	}

	.item-desc {
		margin: 0;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.item-control {
		display: flex;
		flex-shrink: 0;
		justify-content: flex-end;
		min-width: var(--control-w);
	}

	.select-control {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	/* ── Inputs ── */
	.input-number,
	.input-select {
		width: var(--control-w);
		box-sizing: border-box;
		height: 32px;
		padding: 0 10px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-ui);
		background: var(--chip-bg);
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 13px;
		outline: none;
		transition:
			background-color 120ms ease,
			border-color 120ms ease;
	}

	.input-select {
		appearance: none;
		-webkit-appearance: none;
		width: 100%;
		padding-right: 30px;
		cursor: pointer;
	}

	.select-field {
		position: relative;
		display: inline-flex;
		align-items: center;
		width: var(--control-w);
	}

	.select-trigger {
		display: inline-flex;
		align-items: center;
		text-align: left;
	}

	.select-value {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.select-chevron {
		position: absolute;
		right: 11px;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		color: var(--color-ui-dulled);
		pointer-events: none;
	}

	.input-number::-webkit-inner-spin-button,
	.input-number::-webkit-outer-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}

	.num-field {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	.input-number.has-unit {
		padding-right: 30px;
	}

	.num-unit {
		position: absolute;
		right: 11px;
		top: 50%;
		transform: translateY(-50%);
		font-size: 12px;
		color: var(--color-ui-dulled);
		pointer-events: none;
	}

	.input-number:hover,
	.input-select:hover {
		background: var(--chip-bg-hover);
	}

	.input-number:focus,
	.input-select:focus {
		border-color: var(--focus-border);
		background: var(--chip-bg-hover);
	}

	/* ── Reset dialog ── */
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 1500;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
	}

	.dialog {
		width: 380px;
		max-width: calc(100vw - 32px);
		padding: 20px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
	}

	.dialog-title {
		margin: 0 0 10px;
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.dialog-text {
		margin: 0 0 18px;
		font-size: 13px;
		color: var(--color-text-secondary);
		line-height: 1.5;
	}

	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.btn {
		padding: 6px 14px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-ui);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 13px;
		cursor: pointer;
	}

	.btn:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.accent-row {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	.accent-swatch {
		position: relative;
		width: 20px;
		height: 20px;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		cursor: pointer;
	}

	/* Theme-default accent: the base accent with a small surface dot in the center. */
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
		background: var(--color-surface);
		transform: translate(-50%, -50%);
	}

	.accent-swatch.active {
		outline: 2px solid var(--color-ui-muted);
		outline-offset: 2px;
	}

	.accent-swatch.custom {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-style: dashed;
		color: var(--color-ui-muted);
	}

	.accent-swatch.custom input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}

	.custom-mark {
		font-size: 13px;
		line-height: 1;
		pointer-events: none;
	}

	.btn.danger {
		border-color: transparent;
		background: var(--color-accent);
		color: var(--color-accent-contrast);
	}

	.btn.danger:hover {
		opacity: 0.9;
		color: var(--color-accent-contrast);
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.btn.remove {
		margin-right: auto;
		border-color: transparent;
		color: var(--error-fg);
	}

	.btn.remove:hover {
		background: var(--error-bg);
		color: var(--error-fg);
	}

	.capture {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 54px;
		margin: 2px 0 16px;
		padding: 12px;
		border: 1px dashed var(--color-border);
		border-radius: 8px;
		background: var(--chip-bg);
	}

	.capture-ph {
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.conflict {
		margin: -8px 0 14px;
		font-size: 12px;
		color: var(--error-fg);
	}

	/* ── Sources tab ── */
	.source-card.add-source-card {
		justify-content: center;
		gap: 8px;
		width: 100%;
		border-style: dashed;
		background: transparent;
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 13px;
		cursor: pointer;
	}

	.add-source-card :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.source-card.add-source-card:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.source-error {
		margin: 0 0 12px;
		padding: 8px 12px;
		font-size: 12px;
		color: var(--color-accent);
		background: var(--error-bg);
		border-radius: var(--radius-ui);
	}

	.sources-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.source-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 14px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-ui);
	}

	.src-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.src-main :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.src-title-row {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.src-title {
		font-size: 14px;
		color: var(--color-text-primary);
	}

	.src-default {
		padding: 1px 7px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		color: var(--color-accent);
		font-size: 11px;
		white-space: nowrap;
	}

	.src-path {
		font-size: 12px;
		color: var(--color-ui-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.src-right {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.src-count {
		font-size: 12px;
		color: var(--color-ui-muted);
		white-space: nowrap;
	}

	.src-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 26px;
		height: 26px;
		padding: 0 8px;
		border: none;
		border-radius: var(--radius-ui);
		background: transparent;
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 12px;
		cursor: pointer;
	}

	.src-btn:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.sources-empty {
		padding: 12px 4px;
		color: var(--color-ui-muted);
		font-size: 13px;
	}

	/* ── Shortcuts tab ── */
	.shortcuts {
		display: flex;
		flex-direction: column;
		gap: 22px;
	}

	.shortcut-group {
		display: flex;
		flex-direction: column;
	}

	.shortcut-head {
		display: flex;
		align-items: center;
		gap: 7px;
		margin-bottom: 4px;
		padding: 0 2px;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-ui-muted);
	}

	.shortcut-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		min-height: 40px;
		padding: 4px 2px;
		border-bottom: 1px solid var(--color-border);
	}

	.shortcut-row:last-child {
		border-bottom: none;
	}

	.shortcut-label {
		font-size: 13px;
		color: var(--color-text-primary);
	}

	.shortcut-keys {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 6px;
		flex-shrink: 0;
	}

	.combo {
		display: inline-flex;
		align-items: center;
		gap: 4px;
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
		border: 1px solid var(--color-border);
		border-bottom-width: 2px;
		border-radius: 5px;
		background: var(--color-surface);
		box-shadow: 0 1px 1px rgba(0, 0, 0, 0.06);
		font-family: var(--font-ui);
		font-size: 11px;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.combo:hover .keycap {
		border-color: var(--focus-border);
		color: var(--color-text-primary);
	}

	.key-plus {
		font-size: 11px;
		color: var(--color-ui-muted);
	}

	.key-sep {
		color: var(--color-ui-muted);
		font-size: 12px;
	}

	.new-bind {
		height: 22px;
		padding: 0 8px;
		border: 1px solid var(--color-border);
		border-radius: 5px;
		background: transparent;
		font-family: var(--font-ui);
		font-size: 11px;
		color: var(--color-ui-muted);
		white-space: nowrap;
		cursor: pointer;
		opacity: 0;
	}

	.shortcut-row:hover .new-bind {
		opacity: 1;
	}

	.new-bind:hover {
		border-color: var(--focus-border);
		color: var(--color-text-primary);
	}
</style>
