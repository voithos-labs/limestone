<script lang="ts">
    import DocHandle from "$lib/models/DocHandle";
    import {sourceName, listSources, type Source} from "$lib/models/Source";
    import Group, {GroupType} from "$lib/models/Group";
    import {formatDateFriendly} from "$lib/views/dateFormat";
    import {folderDir, fileName} from "$lib/views/fieldValue";
    import {folderPath} from "$lib/views/createDefaults";
    import type {MenuEntry} from "$lib/views/menuTypes";
    import Menu from "./views/Menu.svelte";
    import FolderValueEditor from "./views/FolderValueEditor.svelte";
    import {Hash, EllipsisVertical, Trash2, Folders} from "@lucide/svelte";
    import {onMount} from "svelte";

    let {handle, onDelete, compact = false}: { handle: DocHandle; onDelete?: () => void; compact?: boolean } = $props();

    let title = $state(handle.title);
    let relPath = $state(handle.relPath);
    let source = $state<Source>(handle.source);
    let folders: Group[] = $state([]);
    let sources: Source[] = $state([]);

    const ext = $derived(relPath.match(/\.[^.]+$/)?.[0] ?? '.md');
    const srcName = $derived(sourceName(source));
    const dirParts = $derived(folderDir(relPath).split('/').filter(Boolean));

    const currentFolderId = $derived.by(() => {
        const dir = folderDir(relPath);
        if (!dir) return null;
        return folders.find(f => f.sourceId === source.id && folderPath(f.id, folders) === dir)?.id ?? null;
    });

    // ── Title rename ───────────────────────────────────────────────────────────
    let titleTaken = $state(false);
    let titleCheckToken = 0;

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
        DocHandle.pathExists(source.id, titleCandidate(next)).then((taken) => {
            if (token === titleCheckToken) titleTaken = taken;
        });
    });

    async function commitTitle() {
        const next = title.trim();
        if (!next || next === handle.title) {
            title = handle.title;
            return;
        }
        try {
            if (await DocHandle.pathExists(source.id, titleCandidate(next))) {
                title = handle.title;
                return;
            }
            await handle.rename(next + ext);
            relPath = handle.relPath;
        } catch (e) {
            console.error('rename failed', e);
            title = handle.title;
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
    // Clicking the path crumbs → folder picker scoped to the current source.
    // Clicking the source chip → source dropdown, then a scoped folder picker for
    // the chosen source. Nothing moves until a folder (or "Source root") is picked.
    let sourceMenuOpen = $state(false);
    let sourceAnchor: HTMLElement | null = $state(null);
    let folderOpen = $state(false);
    let pickAnchor: HTMLElement | null = $state(null);
    let pendingSource = $state<Source | null>(null);

    const sourceItems: MenuEntry[] = $derived(
        sources.map(s => ({value: s.id, label: sourceName(s), icon: Folders}))
    );
    const folderPickerValue = $derived(
        pendingSource && pendingSource.id === source.id ? currentFolderId : null
    );

    function openSourceMenu() {
        sourceMenuOpen = !sourceMenuOpen;
    }

    function openCurrentSourceFolder() {
        pendingSource = source;
        pickAnchor = pathAnchorEl;
        folderOpen = true;
    }

    function onSelectSource(id: string) {
        sourceMenuOpen = false;
        pendingSource = sources.find(s => s.id === id) ?? source;
        pickAnchor = sourceAnchor;
        folderOpen = true;
    }

    async function onPickFolder(groupId: string) {
        const target = pendingSource ?? source;
        const dir = groupId ? folderPath(groupId, folders) : '';
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
            folders = (await Group.list()).filter(g => g.groupType === GroupType.Folder);
        } catch (e) {
            console.error('move failed', e);
        }
    }

    // ── Kebab menu ─────────────────────────────────────────────────────────────
    let menuOpen = $state(false);
    let menuAnchor: HTMLElement | null = $state(null);
    let pathAnchorEl: HTMLElement | null = $state(null);
    const menuItems: MenuEntry[] = [{value: 'delete', label: 'Delete', icon: Trash2}];

    function onMenuSelect(value: string) {
        menuOpen = false;
        if (value === 'delete') onDelete?.();
    }

    onMount(() => {
        Group.list()
            .then(gs => folders = gs.filter(g => g.groupType === GroupType.Folder))
            .catch(() => {});
        listSources()
            .then(ss => sources = ss)
            .catch(() => {});
    });
</script>

<div class="doc-hero">
    <div class="hero-inner" class:compact>
        <div class="title-row">
            <span class="title-left">
                <span class="title-field">
                    <span class="title-ghost">{title || ' '}</span>
                    <input
                            class="title-input"
                            class:invalid={titleTaken}
                            bind:value={title}
                            onblur={commitTitle}
                            onkeydown={onTitleKeydown}
                            spellcheck="false"
                    />
                </span>
                <span class="ext">{ext}</span>
            </span>
            <button class="kebab" bind:this={menuAnchor} title="More" onclick={() => menuOpen = !menuOpen}>
                <EllipsisVertical size={18}/>
            </button>
        </div>

        <div class="meta-row">
            <span class="path-crumb">
                <button class="src-chip" bind:this={sourceAnchor} title="Move to another source" onclick={openSourceMenu}>
                    <Folders size={12}/>{srcName}
                </button>
                <button class="crumb-path" bind:this={pathAnchorEl} title="Move within this source" onclick={openCurrentSourceFolder}>
                    {#if dirParts.length}
                        {#each dirParts as part}
                            <span class="crumb-sep">/</span>
                            <span class="crumb-part">{part}</span>
                        {/each}
                    {:else}
                        <span class="crumb-sep">/</span>
                        <span class="crumb-root">root</span>
                    {/if}
                </button>
            </span>
            <span class="meta-dot">·</span>
            <span class="meta-date">Updated {formatDateFriendly(handle.updatedAt)}</span>
        </div>

        {#if handle.tags.length}
            <div class="tags">
                {#each handle.tags as t (t.id)}
                    <span class="tag"><Hash size={11}/>{t.slug}</span>
                {/each}
            </div>
        {/if}
    </div>
</div>

<Menu bind:open={menuOpen} anchor={menuAnchor} items={menuItems} onSelect={onMenuSelect} minWidth={140}/>
<Menu bind:open={sourceMenuOpen} anchor={sourceAnchor} items={sourceItems} onSelect={onSelectSource} minWidth={180} searchable placeholder="Search sources…"/>
<FolderValueEditor
        bind:open={folderOpen}
        anchor={pickAnchor}
        value={folderPickerValue}
        sourceId={pendingSource?.id}
        rootOption
        onChange={onPickFolder}
/>

<style>
    .doc-hero {
        flex-shrink: 0;
    }

    .hero-inner {
        max-width: var(--page-max-width, 1200px);
        margin: 0 auto;
        padding: 34px 24px 6px;
    }

    .hero-inner.compact {
        padding: 10px 0 6px;
    }

    /* ── Title row (editable filename + ext, kebab) ── */
    .title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }

    .title-left {
        display: flex;
        align-items: baseline;
        min-width: 0;
    }

    .title-field {
        position: relative;
        display: inline-block;
        max-width: 100%;
    }

    .title-ghost,
    .title-input {
        font-family: var(--font-ui);
        font-size: 18px;
        font-weight: 600;
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
    }

    .title-input.invalid {
        text-decoration: underline;
        text-decoration-color: var(--error-fg);
        text-underline-offset: 3px;
    }

    .ext {
        flex-shrink: 0;
        font-family: var(--font-ui);
        font-size: 18px;
        font-weight: 600;
        color: var(--color-ui-muted);
    }

    .kebab {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        flex-shrink: 0;
        padding: 0;
        border: none;
        border-radius: var(--radius-ui);
        background: transparent;
        color: var(--color-ui-muted);
        cursor: pointer;
    }

    .kebab:hover {
        background: var(--chip-bg);
        color: var(--color-text-primary);
    }

    /* ── Metadata ── */
    .meta-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-ui-muted);
    }

    .path-crumb {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
    }

    .src-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border: none;
        border-radius: 6px;
        background: var(--chip-bg);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 12px;
        white-space: nowrap;
        cursor: pointer;
    }

    .src-chip:hover {
        color: var(--color-text-primary);
    }

    .src-chip :global(svg) {
        color: var(--color-ui-muted);
    }

    .crumb-path {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        padding: 2px 6px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--color-ui-muted);
        font-family: var(--font-ui);
        font-size: 12px;
        cursor: pointer;
    }

    .crumb-path:hover {
        background: var(--chip-bg);
    }

    .crumb-sep {
        opacity: 0.5;
    }

    .crumb-part {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .crumb-root {
        opacity: 0.7;
    }

    .meta-dot {
        opacity: 0.6;
    }

    .meta-date {
        flex-shrink: 0;
    }

    /* ── Tags ── */
    .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 12px;
    }

    .tag {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px 9px 2px 6px;
        border-radius: 999px;
        background: var(--chip-bg);
        color: var(--color-ui-dulled);
        font-family: var(--font-ui);
        font-size: 11px;
    }

    .tag :global(svg) {
        opacity: 0.7;
    }
</style>
