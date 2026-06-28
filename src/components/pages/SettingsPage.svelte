<script lang="ts">
    import {getAllSettings, setSetting, type SettingValue} from "$lib/models/Settings";
    import {listSources, removeSource, sourceName, type Source} from "$lib/models/Source";
    import {select} from "$lib/db";
    import {invoke} from "@tauri-apps/api/core";
    import {open} from "@tauri-apps/plugin-dialog";
    import {openPath} from "@tauri-apps/plugin-opener";
    import type Session from "$lib/models/Session";
    import type {ViewTab} from "$lib/models/Session";
    import {onMount} from "svelte";
    import {RotateCw, Search, FolderPlus, Folders, ExternalLink, Trash2, X} from "@lucide/svelte";

    let {viewTab, session}: { viewTab: ViewTab; session: Session } = $props();

    const APPEARANCE = 'appearance';
    const SOURCES = 'sources';
    const SCALE_KEY = 'ui_scale_percent';
    const SCALE_PRESETS = [75, 90, 100, 110, 125, 150, 175, 200];

    let settings: Record<string, SettingValue> = $state({});
    let scaleCustomMode = $state(false);

    let scalePercent = $derived.by(() => {
        const v = (settings[APPEARANCE] as Record<string, SettingValue> | undefined)?.[SCALE_KEY];
        return typeof v === 'number' ? v : 100;
    });
    let scaleShowCustom = $derived(scaleCustomMode || !SCALE_PRESETS.includes(scalePercent));
    let sections = $derived(Object.keys(settings).filter(s => s !== APPEARANCE));
    let allSections = $derived([APPEARANCE, SOURCES, ...sections]);
    let activeSection = $state('');
    let dirty = $state(false);
    let searchQuery = $state('');
    let themes: string[] = $state([]);

    // ── Sources tab ──────────────────────────────────────────────────────────
    let sources: Source[] = $state([]);
    let sourceCounts: Record<string, number> = $state({});
    let confirmingRemoveId: string | null = $state(null);
    let sourceError = $state('');

    async function loadSources() {
        sources = await listSources();
        confirmingRemoveId = null;
        for (const s of sources) countSource(s.id);
    }

    async function countSource(id: string) {
        try {
            const [row] = await select<{ c: number }>(
                `SELECT COUNT(*) as c FROM documents WHERE source_id = ?1 AND deleted_at IS NULL`,
                [id]
            );
            sourceCounts[id] = row?.c ?? 0;
        } catch { /* leave count unknown */ }
    }

    async function addSource() {
        sourceError = '';
        const selected = await open({directory: true, multiple: false});
        if (!selected || typeof selected !== 'string') return;
        const title = selected.split(/[\\/]/).filter(Boolean).pop() || 'Untitled';
        try {
            await invoke('create_source', {path: selected, title});
            await loadSources();
        } catch (e) {
            sourceError = String(e);
        }
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

    onMount(async () => {
        settings = await getAllSettings();
        themes = await session.listThemes();
        const saved = viewTab.state?.activeSection;
        activeSection = (saved && allSections.includes(saved)) ? saved : APPEARANCE;
        if (!SCALE_PRESETS.includes(scalePercent)) scaleCustomMode = true;
        loadSources();
    });

    function saveTabState() {
        if (!viewTab.state) viewTab.state = {};
        viewTab.state.activeSection = activeSection;
        session.persist();
    }

    interface FlatSetting {
        section: string;
        key: string;
        path: string;
        value: SettingValue;
    }

    let allSettings = $derived.by((): FlatSetting[] => {
        const result: FlatSetting[] = [];
        for (const section of allSections) {
            const obj = settings[section];
            if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) continue;
            for (const [key, value] of Object.entries(obj as Record<string, SettingValue>)) {
                result.push({section, key, path: `${section}.${key}`, value});
            }
        }
        return result;
    });

    let searchResults = $derived.by((): FlatSetting[] => {
        if (!searchQuery.trim()) return [];
        const q = searchQuery.toLowerCase();
        return allSettings.filter(s =>
            s.path.toLowerCase().includes(q) ||
            formatLabel(s.key).toLowerCase().includes(q) ||
            formatLabel(s.section).toLowerCase().includes(q)
        );
    });

    let isSearching = $derived(searchQuery.trim().length > 0);

    function sectionEntries(section: string): [string, SettingValue][] {
        const obj = settings[section];
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return [];
        return Object.entries(obj as Record<string, SettingValue>);
    }

    function formatLabel(key: string): string {
        return key.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    async function updateSetting(section: string, key: string, value: SettingValue) {
        (settings[section] as Record<string, SettingValue>)[key] = value;
        await setSetting(`${section}.${key}`, value);
        dirty = true;
    }

    function handleInput(section: string, key: string, current: SettingValue, e: Event) {
        const input = e.target as HTMLInputElement;
        if (typeof current === 'boolean') {
            updateSetting(section, key, input.checked);
        } else if (typeof current === 'number') {
            const num = Number(input.value);
            if (!isNaN(num)) updateSetting(section, key, num);
        } else {
            updateSetting(section, key, input.value);
        }
    }

    function selectSection(section: string) {
        activeSection = section;
        searchQuery = '';
        saveTabState();
    }
</script>

<div class="settings-page">
    <div class="settings-sidebar">
        <button
                class="section-btn"
                class:active={!isSearching && activeSection === APPEARANCE}
                onclick={() => selectSection(APPEARANCE)}
        >
            Appearance
        </button>
        <button
                class="section-btn"
                class:active={!isSearching && activeSection === SOURCES}
                onclick={() => selectSection(SOURCES)}
        >
            Sources
        </button>
        {#each sections as section}
            <button
                    class="section-btn"
                    class:active={!isSearching && activeSection === section}
                    onclick={() => selectSection(section)}
            >
                {formatLabel(section)}
            </button>
        {/each}
        <div class="sidebar-spacer"></div>
        <div class="search-bar">
            <Search size={14} />
            <input
                class="search-input"
                type="text"
                placeholder="Search settings..."
                bind:value={searchQuery}
            />
        </div>
    </div>

    <div class="settings-content">
        {#if isSearching}
            <div class="section-header">
                <h2 class="section-title">Search Results</h2>
                {#if dirty}
                    <button class="reload-btn" onclick={() => location.reload()}>
                        <RotateCw size={14} />
                        Reload to apply
                    </button>
                {/if}
            </div>
            <div class="settings-list">
                {#each searchResults as {section, key, path, value}}
                    <div class="setting-row">
                        <div class="setting-info">
                            <span class="setting-label">{formatLabel(key)}</span>
                            <span class="setting-key">{path}</span>
                        </div>
                        <div class="setting-control">
                            {#if typeof value === 'boolean'}
                                <label class="toggle">
                                    <input
                                            type="checkbox"
                                            checked={value}
                                            onchange={(e) => handleInput(section, key, value, e)}
                                    />
                                    <span class="toggle-slider"></span>
                                </label>
                            {:else if typeof value === 'number'}
                                <input
                                        class="input-number"
                                        type="number"
                                        {value}
                                        onchange={(e) => handleInput(section, key, value, e)}
                                />
                            {:else}
                                <input
                                        class="input-text"
                                        type="text"
                                        {value}
                                        onchange={(e) => handleInput(section, key, value, e)}
                                />
                            {/if}
                        </div>
                    </div>
                {:else}
                    <p class="empty">No matching settings</p>
                {/each}
            </div>
        {:else if activeSection === APPEARANCE}
            <div class="section-header">
                <h2 class="section-title">Appearance</h2>
                {#if dirty}
                    <button class="reload-btn" onclick={() => location.reload()}>
                        <RotateCw size={14} />
                        Reload to apply
                    </button>
                {/if}
            </div>
            <div class="settings-list">
                <div class="setting-row">
                    <div class="setting-info">
                        <span class="setting-label">Theme</span>
                        <span class="setting-key">Active: {session.activeTheme}</span>
                    </div>
                    <div class="setting-control">
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
                <div class="setting-row">
                    <div class="setting-info">
                        <span class="setting-label">UI Scale</span>
                        <span class="setting-key">{APPEARANCE}.{SCALE_KEY}</span>
                    </div>
                    <div class="setting-control scale-control">
                        <select
                                class="input-select"
                                value={scaleShowCustom ? 'custom' : String(scalePercent)}
                                onchange={(e) => {
                                    const v = (e.target as HTMLSelectElement).value;
                                    if (v === 'custom') {
                                        scaleCustomMode = true;
                                    } else {
                                        scaleCustomMode = false;
                                        updateSetting(APPEARANCE, SCALE_KEY, Number(v));
                                    }
                                }}
                        >
                            {#each SCALE_PRESETS as p}
                                <option value={String(p)}>{p}%</option>
                            {/each}
                            <option value="custom">Custom…</option>
                        </select>
                        {#if scaleShowCustom}
                            <input
                                    class="input-number scale-custom"
                                    type="number"
                                    min="25"
                                    max="500"
                                    value={scalePercent}
                                    onchange={(e) => {
                                        const n = Number((e.target as HTMLInputElement).value);
                                        if (!isNaN(n) && n > 0) updateSetting(APPEARANCE, SCALE_KEY, n);
                                    }}
                            />
                        {/if}
                    </div>
                </div>
                {#each sectionEntries(APPEARANCE) as [key, value]}
                    {#if key !== SCALE_KEY}
                    <div class="setting-row">
                        <div class="setting-info">
                            <span class="setting-label">{formatLabel(key)}</span>
                            <span class="setting-key">{APPEARANCE}.{key}</span>
                        </div>
                        <div class="setting-control">
                            {#if typeof value === 'boolean'}
                                <label class="toggle">
                                    <input
                                            type="checkbox"
                                            checked={value}
                                            onchange={(e) => handleInput(APPEARANCE, key, value, e)}
                                    />
                                    <span class="toggle-slider"></span>
                                </label>
                            {:else if typeof value === 'number'}
                                <input
                                        class="input-number"
                                        type="number"
                                        {value}
                                        onchange={(e) => handleInput(APPEARANCE, key, value, e)}
                                />
                            {:else}
                                <input
                                        class="input-text"
                                        type="text"
                                        {value}
                                        onchange={(e) => handleInput(APPEARANCE, key, value, e)}
                                />
                            {/if}
                        </div>
                    </div>
                    {/if}
                {/each}
            </div>
        {:else if activeSection === SOURCES}
            <div class="section-header">
                <h2 class="section-title">Sources</h2>
                <button class="add-source-btn" onclick={addSource}>
                    <FolderPlus size={14} />
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
                            <Folders size={16} />
                            <div class="src-text">
                                <span class="src-title">{sourceName(s)}</span>
                                <span class="src-path" title={s.path}>{s.path}</span>
                            </div>
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
                                <button class="src-btn" title="Cancel" onclick={() => confirmingRemoveId = null}>
                                    <X size={14} />
                                </button>
                                <button class="src-btn confirm" onclick={() => confirmRemove(s)}>Remove</button>
                            {:else}
                                <button class="src-btn" title="Reveal in file manager" onclick={() => revealSource(s)}>
                                    <ExternalLink size={14} />
                                </button>
                                <button class="src-btn danger" title="Remove source" onclick={() => confirmingRemoveId = s.id}>
                                    <Trash2 size={14} />
                                </button>
                            {/if}
                        </div>
                    </div>
                {:else}
                    <p class="sources-empty">No sources yet</p>
                {/each}
            </div>
        {:else if activeSection}
            <div class="section-header">
                <h2 class="section-title">{formatLabel(activeSection)}</h2>
                {#if dirty}
                    <button class="reload-btn" onclick={() => location.reload()}>
                        <RotateCw size={14} />
                        Reload to apply
                    </button>
                {/if}
            </div>
            <div class="settings-list">
                {#each sectionEntries(activeSection) as [key, value]}
                    <div class="setting-row">
                        <div class="setting-info">
                            <span class="setting-label">{formatLabel(key)}</span>
                            <span class="setting-key">{activeSection}.{key}</span>
                        </div>
                        <div class="setting-control">
                            {#if typeof value === 'boolean'}
                                <label class="toggle">
                                    <input
                                            type="checkbox"
                                            checked={value}
                                            onchange={(e) => handleInput(activeSection, key, value, e)}
                                    />
                                    <span class="toggle-slider"></span>
                                </label>
                            {:else if typeof value === 'number'}
                                <input
                                        class="input-number"
                                        type="number"
                                        {value}
                                        onchange={(e) => handleInput(activeSection, key, value, e)}
                                />
                            {:else}
                                <input
                                        class="input-text"
                                        type="text"
                                        {value}
                                        onchange={(e) => handleInput(activeSection, key, value, e)}
                                />
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>

<style>
    .settings-page {
        display: flex;
        height: 100%;
    }

    /* ── Sidebar ── */
    .settings-sidebar {
        display: flex;
        flex-direction: column;
        width: 180px;
        padding: 24px 12px;
        border-right: 1px solid var(--color-border);
        flex-shrink: 0;
        gap: 2px;
    }

    .sidebar-spacer {
        flex: 1;
    }

    .search-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-ui);
        color: var(--color-ui-muted);
    }

    .search-input {
        flex: 1;
        min-width: 0;
        background: transparent;
        border: none;
        outline: none;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 12px;
    }

    .search-input::placeholder {
        color: var(--color-ui-muted);
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

    /* ── Content ── */
    .settings-content {
        flex: 1;
        padding: 24px 32px;
        overflow-y: auto;
        scrollbar-width: none;
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
        font-size: 18px;
        font-weight: 600;
        color: var(--color-text-primary);
    }

    .reload-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border: none;
        border-radius: var(--radius-ui);
        background: var(--color-accent);
        color: white;
        font-family: var(--font-ui);
        font-size: 12px;
        cursor: pointer;
    }

    .reload-btn:hover {
        opacity: 0.9;
    }

    .settings-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    /* ── Setting row ── */
    .setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-radius: var(--radius-ui);
    }

    .setting-row:hover {
        background: rgba(255, 255, 255, 0.02);
    }

    .setting-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .setting-label {
        font-size: 14px;
        color: var(--color-text-primary);
    }

    .setting-key {
        font-size: 11px;
        color: var(--color-ui-muted);
        font-family: monospace;
    }

    .setting-control {
        flex-shrink: 0;
        margin-left: 24px;
    }

    .scale-control {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .scale-custom {
        width: 80px;
    }

    .empty {
        padding: 12px 16px;
        color: var(--color-ui-muted);
        font-size: 14px;
    }

    /* ── Toggle ── */
    .toggle {
        position: relative;
        display: inline-block;
        width: 36px;
        height: 20px;
        cursor: pointer;
    }

    .toggle input {
        opacity: 0;
        width: 0;
        height: 0;
    }

    .toggle-slider {
        position: absolute;
        inset: 0;
        background: var(--color-ui-muted);
        border-radius: 10px;
        transition: background 150ms ease;
    }

    .toggle-slider::before {
        content: '';
        position: absolute;
        left: 2px;
        top: 2px;
        width: 16px;
        height: 16px;
        background: white;
        border-radius: 50%;
        transition: transform 150ms ease;
    }

    .toggle input:checked + .toggle-slider {
        background: var(--color-accent);
    }

    .toggle input:checked + .toggle-slider::before {
        transform: translateX(16px);
    }

    /* ── Inputs ── */
    .input-number,
    .input-text {
        width: 120px;
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
    .input-text:focus,
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
        align-items: center;
        gap: 12px;
        min-width: 0;
    }

    .src-main :global(svg) {
        flex-shrink: 0;
        color: var(--color-ui-muted);
    }

    .src-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
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

    .src-btn.danger:hover {
        color: var(--color-accent);
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
