<script lang="ts">
    import {getAllSettings, setSetting, type SettingValue} from "$lib/models/Settings";
    import type Session from "$lib/models/Session";
    import type {ViewTab} from "$lib/models/Session";
    import {onMount} from "svelte";
    import {RotateCw, Search} from "@lucide/svelte";

    let {viewTab, session}: { viewTab: ViewTab; session: Session } = $props();

    let settings: Record<string, SettingValue> = $state({});
    let sections = $derived(Object.keys(settings));
    let activeSection = $state('');
    let dirty = $state(false);
    let searchQuery = $state('');

    onMount(async () => {
        settings = await getAllSettings();
        const saved = viewTab.state?.activeSection;
        activeSection = (saved && sections.includes(saved)) ? saved : sections[0] ?? '';
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
        for (const section of sections) {
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
    .input-text:focus {
        border-color: var(--color-accent);
    }
</style>
