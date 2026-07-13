<script lang="ts">
    import {
        resetAllSettings,
        SETTINGS_REGISTRY,
        type SettingCategory,
        type SettingDef
    } from '$lib/models/Settings.svelte';
    import {listSources, removeSource, sourceName, type Source} from '$lib/models/Source';
    import {select} from '$lib/services/db';
    import {openPath} from '@tauri-apps/plugin-opener';
    import SourceDialog from '../SourceDialog.svelte';
    import Toggle from '../Toggle.svelte';
    import Menu from '../views/Menu.svelte';
    import type {MenuEntry} from '$lib/views/menuTypes';
    import type Session from '$lib/models/Session';
    import type {ViewTab} from '$lib/models/Session';
    import {onMount} from 'svelte';
    import {
        RotateCcw,
        Search,
        FolderPlus,
        Folders,
        ExternalLink,
        EllipsisVertical,
        Trash2,
        X,
        Pencil
    } from '@lucide/svelte';

    let {viewTab, session}: { viewTab: ViewTab; session: Session } = $props();

    const settings = $derived(session.settings);
    const SOURCES = 'sources';
    const CUSTOM = 'custom';
    const sectionIds = [...SETTINGS_REGISTRY.map((c) => c.id), SOURCES];

    let activeSection = $state('');
    let searchQuery = $state('');
    let themes: string[] = $state([]);
    let customKeys: string[] = $state([]);
    let resetDialogOpen = $state(false);
    let resetBusy = $state(false);

    let isSearching = $derived(searchQuery.trim().length > 0);
    let activeCategory = $derived(SETTINGS_REGISTRY.find((c) => c.id === activeSection));

    function matchesQuery(haystack: string): boolean {
        const tokens = searchQuery.trim().toLowerCase().split(/\s+/);
        const hay = haystack.toLowerCase();
        return tokens.every((t) => hay.includes(t));
    }

    let searchResults = $derived.by((): { category: SettingCategory; def: SettingDef }[] => {
        if (!searchQuery.trim()) return [];
        const results: { category: SettingCategory; def: SettingDef }[] = [];
        for (const category of SETTINGS_REGISTRY) {
            for (const def of category.settings) {
                if (matchesQuery(`${category.label} ${def.label} ${def.key} ${def.description ?? ''}`)) {
                    results.push({category, def});
                }
            }
        }
        return results;
    });

    const appearanceCategory = SETTINGS_REGISTRY.find((c) => c.id === 'appearance') ?? null;
    let themeMatches = $derived(
        searchQuery.trim().length > 0 && matchesQuery('Appearance Theme Active color theme')
    );
    let resultCount = $derived(searchResults.length + (themeMatches ? 1 : 0));
    let matchedCategoryIds = $derived(new Set(searchResults.map((r) => r.category.id)));
    let sourcesMatches = $derived(searchQuery.trim().length > 0 && matchesQuery('Sources'));

    // ── Sources tab ──────────────────────────────────────────────────────────
    let sources: Source[] = $state([]);
    let sourceCounts: Record<string, number> = $state({});
    let confirmingRemoveId: string | null = $state(null);
    let sourceError = $state('');

    let dialogOpen = $state(false);
    let dialogMode: 'create' | 'edit' = $state('create');
    let dialogSource: Source | null = $state(null);

    async function loadSources() {
        sources = await listSources();
        confirmingRemoveId = null;
        for (const s of sources) countSource(s.id);
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

    async function confirmRemove(s: Source) {
        try {
            await removeSource(s.id);
            confirmingRemoveId = null;
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
    const srcMenuItems: MenuEntry[] = [
        {value: 'edit', label: 'Edit', icon: Pencil},
        {value: 'reveal', label: 'Reveal in file manager', icon: ExternalLink},
        {kind: 'divider'},
        {value: 'remove', label: 'Remove', icon: Trash2}
    ];

    function openSourceMenu(s: Source, e: MouseEvent) {
        menuSource = s;
        srcMenuAnchor = e.currentTarget as HTMLElement;
        srcMenuOpen = true;
    }

    function onSourceMenuSelect(value: string) {
        srcMenuOpen = false;
        const s = menuSource;
        if (!s) return;
        if (value === 'edit') editSource(s);
        else if (value === 'reveal') revealSource(s);
        else if (value === 'remove') confirmingRemoveId = s.id;
    }

    onMount(async () => {
        themes = await session.listThemes();
        const saved = viewTab.state?.activeSection;
        activeSection = saved && sectionIds.includes(saved) ? saved : sectionIds[0];
        loadSources();
    });

    function saveTabState() {
        if (!viewTab.state) viewTab.state = {};
        viewTab.state.activeSection = activeSection;
        session.persist();
    }

    function selectSection(section: string) {
        activeSection = section;
        searchQuery = '';
        saveTabState();
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

    function commitSelect(def: SettingDef, e: Event) {
        const v = (e.target as HTMLSelectElement).value;
        if (v === CUSTOM) {
            if (!customKeys.includes(def.key)) customKeys.push(def.key);
            return;
        }
        customKeys = customKeys.filter((k) => k !== def.key);
        const option = def.options?.find((o) => String(o.value) === v);
        if (option) setValue(def, option.value as number);
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
                    {#if category}<span class="item-cat">{category.label}:</span> {/if}Theme
                </span>
            </div>
            <p class="item-desc">Active color theme.</p>
        </div>
        <div class="item-control">
            <select
                    class="input-select"
                    value={session.activeTheme}
                    onchange={async (e) => {
						await session.setTheme((e.target as HTMLSelectElement).value);
					}}
            >
                {#each themes as name}
                    <option value={name}>{name}</option>
                {/each}
            </select>
        </div>
    </div>
{/snippet}

{#snippet settingItem(def: SettingDef, category: SettingCategory | null)}
    {@const modified = settings.isModified(def.key)}
    <div class="setting-item" class:modified>
        <div class="item-info">
            <div class="item-head">
                <span class="item-label">
                    {#if category}<span class="item-cat">{category.label}:</span> {/if}{def.label}
                </span>
                {#if modified}
                    <button class="item-reset" title="Reset to default" onclick={() => resetOne(def)}>
                        <RotateCcw size={12}/>
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
                        bind:checked={
                            () => settings.get<boolean>(def.key) ?? false,
                            (v) => setValue(def, v)
                        }
                />
            {:else if def.control === 'stepper'}
                <input
                        class="input-number"
                        type="number"
                        min={def.min}
                        max={def.max}
                        step={def.step}
                        value={settings.get<number>(def.key)}
                        onchange={(e) => commitNumber(def, e)}
                />
            {:else if def.control === 'select'}
                {@const value = settings.get(def.key)}
                {@const inOptions = (def.options ?? []).some((o) => o.value === value)}
                {@const showCustom = def.allowCustom && (customKeys.includes(def.key) || !inOptions)}
                <div class="select-control">
                    <select
                            class="input-select"
                            value={showCustom ? CUSTOM : String(value)}
                            onchange={(e) => commitSelect(def, e)}
                    >
                        {#each def.options ?? [] as option}
                            <option value={String(option.value)}>{option.label}</option>
                        {/each}
                        {#if def.allowCustom}
                            <option value={CUSTOM}>Custom…</option>
                        {/if}
                    </select>
                    {#if showCustom}
                        <input
                                class="input-number"
                                type="number"
                                min={def.min}
                                max={def.max}
                                value={settings.get<number>(def.key)}
                                onchange={(e) => commitNumber(def, e)}
                        />
                    {/if}
                </div>
            {/if}
        </div>
    </div>
{/snippet}

<div class="settings-page">
    <div class="settings-topbar">
        <div class="search-bar">
            <Search size={14}/>
            <input
                    class="search-input"
                    type="text"
                    placeholder="Search settings"
                    bind:value={searchQuery}
                    onkeydown={(e) => e.key === 'Escape' && (searchQuery = '')}
            />
            {#if searchQuery}
                <button class="search-clear" title="Clear search" onclick={() => (searchQuery = '')}>
                    <X size={12}/>
                </button>
            {/if}
        </div>
    </div>

    <div class="settings-body">
        <nav class="settings-sidebar">
            {#each SETTINGS_REGISTRY as category}
                {#if !isSearching || matchedCategoryIds.has(category.id) || (category.id === 'appearance' && themeMatches)}
                    <button
                            class="section-btn"
                            class:active={!isSearching && activeSection === category.id}
                            onclick={() => selectSection(category.id)}
                    >
                        {category.label}
                    </button>
                {/if}
            {/each}
            {#if !isSearching || sourcesMatches}
                <button
                        class="section-btn"
                        class:active={!isSearching && activeSection === SOURCES}
                        onclick={() => selectSection(SOURCES)}
                >
                    Sources
                </button>
            {/if}
            <div class="sidebar-spacer"></div>
            <button class="reset-settings-btn" onclick={() => (resetDialogOpen = true)}>
                <RotateCcw size={14}/>
                Reset settings
            </button>
        </nav>

        <div class="settings-content">
            {#if isSearching}
                <h2 class="section-title">
                    {resultCount}
                    {resultCount === 1 ? 'setting' : 'settings'} found
                </h2>
                <div class="settings-list">
                    {#if themeMatches}
                        {@render themeItem(appearanceCategory)}
                    {/if}
                    {#each searchResults as {category, def} (def.key)}
                        {@render settingItem(def, category)}
                    {/each}
                    {#if resultCount === 0}
                        <p class="empty">No matching settings</p>
                    {/if}
                </div>
            {:else if activeSection === SOURCES}
                <div class="section-header">
                    <h2 class="section-title">Sources</h2>
                    <button class="add-source-btn" onclick={addSource}>
                        <FolderPlus size={14}/>
                        Add source
                    </button>
                </div>
                {#if sourceError}
                    <p class="source-error">{sourceError}</p>
                {/if}
                <div class="sources-list">
                    {#each sources as s (s.id)}
                        <div class="source-card">
                            <div class="src-main">
                                <div class="src-title-row">
                                    <Folders size={13}/>
                                    <span class="src-title">{sourceName(s)}</span>
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
                                {#if confirmingRemoveId === s.id}
                                    <span class="confirm-text">Remove?</span>
                                    <button class="src-btn" title="Cancel" onclick={() => (confirmingRemoveId = null)}>
                                        <X size={14}/>
                                    </button>
                                    <button class="src-btn confirm" onclick={() => confirmRemove(s)}>Remove</button>
                                {:else}
                                    <button class="src-btn" title="More" onclick={(e) => openSourceMenu(s, e)}>
                                        <EllipsisVertical size={14}/>
                                    </button>
                                {/if}
                            </div>
                        </div>
                    {:else}
                        <p class="sources-empty">No sources yet</p>
                    {/each}
                </div>
            {:else if activeCategory}
                <h2 class="section-title">{activeCategory.label}</h2>
                <div class="settings-list">
                    {#if activeCategory.id === 'appearance'}
                        {@render themeItem(null)}
                    {/if}
                    {#each activeCategory.settings as def (def.key)}
                        {@render settingItem(def, null)}
                    {/each}
                </div>
            {/if}
        </div>
    </div>
</div>

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

<Menu
        bind:open={srcMenuOpen}
        anchor={srcMenuAnchor}
        items={srcMenuItems}
        onSelect={onSourceMenuSelect}
        minWidth={180}
/>

<SourceDialog
        bind:open={dialogOpen}
        mode={dialogMode}
        source={dialogSource}
        onSaved={loadSources}
/>

<style>
    .settings-page {
        display: flex;
        flex-direction: column;
        height: 100%;
        font-family: var(--font-ui);
    }

    /* ── Top bar ── */
    .settings-topbar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 24px 24px 8px;
    }

    .search-bar {
        display: flex;
        align-items: center;
        flex: 1;
        gap: 8px;
        padding: 9px 14px;
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

    /* ── Body ── */
    .settings-body {
        display: flex;
        flex: 1;
        min-height: 0;
    }

    .settings-sidebar {
        position: relative;
        display: flex;
        flex-direction: column;
        width: 220px;
        padding: 20px 24px;
        flex-shrink: 0;
        gap: 4px;
    }

    .settings-sidebar::after {
        content: '';
        position: absolute;
        top: 20px;
        right: 0;
        bottom: 20px;
        width: 1px;
        background: var(--color-border);
    }

    .sidebar-spacer {
        flex: 1;
    }

    .section-btn {
        padding: 8px 12px;
        border: none;
        border-radius: var(--radius-ui);
        background: transparent;
        color: var(--color-ui-dulled);
        font-family: var(--font-ui);
        font-size: 13px;
        text-align: left;
        cursor: pointer;
    }

    .section-btn:hover {
        color: var(--color-text-primary);
    }

    .section-btn.active {
        background: var(--color-bg);
        color: var(--color-text-primary);
    }

    .reset-settings-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-ui);
        background: transparent;
        color: var(--color-ui-dulled);
        font-family: var(--font-ui);
        font-size: 12px;
        cursor: pointer;
    }

    .reset-settings-btn:hover {
        background: var(--chip-bg);
        color: var(--color-text-primary);
    }

    /* ── Content ── */
    .settings-content {
        flex: 1;
        max-width: var(--page-max-width, none);
        margin-left: auto;
        margin-right: auto;
        padding: 20px 32px 48px 24px;
        overflow-y: auto;
        scrollbar-width: none;
        mask-image: linear-gradient(
            to bottom,
            transparent,
            black 20px,
            black calc(100% - 28px),
            transparent
        );
        -webkit-mask-image: linear-gradient(
            to bottom,
            transparent,
            black 20px,
            black calc(100% - 28px),
            transparent
        );
    }

    .settings-content::-webkit-scrollbar {
        display: none;
    }

    .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 24px;
    }

    .section-title {
        margin: 0 0 24px;
        font-size: 18px;
        font-weight: 600;
        color: var(--color-text-primary);
    }

    .section-header .section-title {
        margin: 0;
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
        background: rgba(255, 255, 255, 0.02);
    }

    .setting-item.modified::before {
        content: '';
        position: absolute;
        left: 6px;
        top: 12px;
        bottom: 12px;
        width: 2px;
        border-radius: 1px;
        background: var(--color-accent);
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
    }

    .select-control {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .empty {
        padding: 12px 0;
        color: var(--color-ui-muted);
        font-size: 14px;
    }

    /* ── Inputs ── */
    .input-number {
        width: 100px;
        padding: 6px 10px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-ui);
        background: var(--color-bg);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 13px;
        outline: none;
    }

    .input-number:focus,
    .input-select:focus {
        border-color: var(--focus-border);
    }

    .input-select {
        padding: 6px 10px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-ui);
        background: var(--color-surface);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 13px;
        outline: none;
        cursor: pointer;
    }

    .input-select option {
        background: var(--color-surface);
        color: var(--color-text-primary);
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

    .btn.danger {
        border-color: transparent;
        background: var(--color-accent);
        color: white;
    }

    .btn.danger:hover {
        opacity: 0.9;
        color: white;
    }

    .btn:disabled {
        opacity: 0.6;
        cursor: default;
    }

    /* ── Sources tab ── */
    .add-source-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-ui);
        background: transparent;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 12px;
        cursor: pointer;
    }

    .add-source-btn:hover {
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

    .confirm-text {
        font-size: 12px;
        color: var(--color-text-secondary);
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

    .src-btn.confirm {
        background: var(--color-accent);
        color: white;
    }

    .src-btn.confirm:hover {
        opacity: 0.9;
        color: white;
    }

    .sources-empty {
        padding: 12px 4px;
        color: var(--color-ui-muted);
        font-size: 13px;
    }
</style>
