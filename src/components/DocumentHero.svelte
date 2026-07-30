<script lang="ts">
    import DocHandle from '$lib/models/DocHandle';
    import {sourceName, listSources, type Source} from '$lib/models/Source';
    import Group, {GroupType} from '$lib/models/Group';
    import {formatDateFriendly} from '$lib/views/dateFormat';
    import {folderDir, fileName} from '$lib/views/fieldValue';
    import {folderPath} from '$lib/views/createDefaults';
    import {isValidSegment} from '$lib/util/paths';
    import type {MenuEntry} from '$lib/views/menuTypes';
    import Menu from './views/Menu.svelte';
    import FolderValueEditor from './views/FolderValueEditor.svelte';
    import DocProperties from './views/DocProperties.svelte';
    import {
        Hash,
        EllipsisVertical,
        Trash2,
        Folders,
        Plus,
        Copy,
        SlidersHorizontal,
        ExternalLink
    } from '@lucide/svelte';
    import {onMount, untrack} from 'svelte';
    import {readTextFile} from '@tauri-apps/plugin-fs';
    import {revealItemInDir} from '@tauri-apps/plugin-opener';
    import {flushAll} from '$lib/util/flush';

    let {
        handle,
        onDelete,
        onDuplicated,
        compact = false,
        propsOpen = $bindable(false)
    }: {
        handle: DocHandle;
        onDelete?: () => void;
        onDuplicated?: (copy: DocHandle) => void;
        compact?: boolean;
        propsOpen?: boolean;
    } = $props();

    let title = $state(untrack(() => handle.title));
    let relPath = $state(untrack(() => handle.relPath));
    let source = $state<Source>(untrack(() => handle.source));
    let allGroups: Group[] = $state([]);
    let sources: Source[] = $state([]);
    let tagList: Group[] = $state(untrack(() => handle.tags));

    const folders = $derived(allGroups.filter((g) => g.groupType === GroupType.Folder));

    let tagMenuOpen = $state(false);
    let tagAnchor: HTMLElement | null = $state(null);

    const tagItems = $derived(
        allGroups
            .filter((g) => g.groupType === GroupType.Tag)
            .map((g) => ({value: g.id, label: g.slug, icon: Hash}))
    );

    async function createTag(q: string) {
        const slug = q.trim();
        if (!slug || tagList.some((t) => t.slug === slug)) return;
        try {
            await handle.setTags([...tagList.map((t) => t.slug), slug]);
            tagList = handle.tags;
            allGroups = await Group.list();
        } catch (e) {
            console.error('create tag failed', e);
        }
    }

    async function toggleTag(id: string) {
        const has = tagList.some((t) => t.id === id);
        const next = has
            ? tagList.filter((t) => t.id !== id)
            : [...tagList, allGroups.find((g) => g.id === id)!].filter(Boolean);
        tagList = next;
        try {
            await handle.setTags(next.map((t) => t.slug));
            tagList = handle.tags;
        } catch (e) {
            console.error('set tags failed', e);
            tagList = handle.tags;
        }
    }

    const ext = $derived(relPath.match(/\.[^.]+$/)?.[0] ?? '.md');
    const srcName = $derived(sourceName(source));
    const dirParts = $derived(folderDir(relPath).split('/').filter(Boolean));

    const currentFolderId = $derived.by(() => {
        const dir = folderDir(relPath);


        // EXAMPLE: this is shit code I wrote that was making it walk the damn entire folder tree, noticable
        // first open delay. DNR.
        // if (!dir) return null;
        // return (
        // 		folders.find((f) => f.sourceId === source.id && folderPath(f.id, folders) === dir)?.id ?? null
        // );

        return dir ? `folder:${source.id}:${dir}` : null;
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
            if (await DocHandle.pathTaken(source, titleCandidate(next))) {
                title = handle.title;
                return;
            }
            await handle.rename(next + ext);
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

    const folderPickerValue = $derived(currentFolderId ?? source.id);

    async function onPickFolder(groupId: string, path?: string) {
        const isFolder = groupId.startsWith('folder:');
        const targetSourceId = isFolder
            ? (folders.find((f) => f.id === groupId)?.sourceId ?? groupId.split(':')[1])
            : groupId;
        const target = sources.find((s) => s.id === targetSourceId) ?? source;
        const dir = isFolder ? (path ?? folderPath(groupId, folders)) : '';
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
            allGroups = await Group.list();
        } catch (e) {
            console.error('move failed', e);
        }
    }

    // ── Kebab menu ─────────────────────────────────────────────────────────────
    let menuOpen = $state(false);
    let menuAnchor: HTMLElement | null = $state(null);
    let confirmingDelete = $state(false);

    // Properties panel: the toggle lives in the meta bar, the panel renders below.
    // Open state is owned by the caller so it can be persisted on the tab.
    let propCount = $state(0);

    $effect(() => {
        if (!menuOpen) confirmingDelete = false;
    });

    const menuItems: MenuEntry[] = $derived([
        {value: 'duplicate', label: 'Duplicate document', icon: Copy},
        {value: 'reveal', label: 'Reveal in file manager', icon: ExternalLink},
        confirmingDelete
            ? {value: 'confirm-delete', label: 'Confirm delete', icon: Trash2, danger: true}
            : {value: 'delete', label: 'Delete document', icon: Trash2, keepOpen: true}
    ]);

    async function duplicateDoc() {
        try {
            await flushAll();
            const raw = await readTextFile(`${source.path}/${relPath}`).catch(() => '');
            const {body} = DocHandle.deserialize(raw);
            const dir = folderDir(relPath);
            const newRel = await DocHandle.uniqueRelPath(source, dir, `${handle.title} copy`);
            const newTitle = newRel.split('/').pop()!.replace(/\.md$/i, '');
            const copy = await DocHandle.create(
                source,
                newTitle,
                newRel,
                handle.groups.map((g) => g.id),
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
        if (value === 'duplicate') duplicateDoc();
        if (value === 'reveal') revealDoc();
        if (value === 'confirm-delete') onDelete?.();
    }

    onMount(() => {
        if (handle.isDraft) {
            titleInput?.focus();
            titleInput?.select();
        }
        Group.list()
            .then((gs) => (allGroups = gs))
            .catch(() => {
            });
        listSources()
            .then((ss) => (sources = ss))
            .catch(() => {
            });
    });
</script>

<div class="doc-hero">
    <div class="hero-inner" class:compact>
        <button
                class="kebab"
                bind:this={menuAnchor}
                title="More"
                onclick={() => (menuOpen = !menuOpen)}
        >
            <EllipsisVertical size={15} strokeWidth={1.75}/>
        </button>

        <div class="head-row">
			<span class="title-left">
				<span class="title-field">
					<span class="title-ghost">{title || ' '}</span>
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
				<span class="ext">{ext}</span>
			</span>

            <div class="meta-row">
                <button
                        class="loc-chip"
                        bind:this={pickAnchor}
                        title="Move document"
                        onclick={() => (folderOpen = !folderOpen)}
                >
                    <Folders size={12}/>
                    <span class="loc-part src">{srcName}</span>
                    {#each dirParts as part}
                        <span class="crumb-sep">/</span>
                        <span class="loc-part">{part}</span>
                    {/each}
                </button>
                {#if source.use_frontmatter}
                    <span class="meta-div"></span>
                    <button
                            class="tags-chip"
                            class:has-tags={tagList.length > 0}
                            bind:this={tagAnchor}
                            title="Edit tags"
                            onclick={() => (tagMenuOpen = !tagMenuOpen)}
                    >
                        {#if tagList.length}
                            {#each tagList as t (t.id)}
                                <span class="tag"><Hash size={11}/>{t.slug}</span>
                            {/each}
                        {:else}
                            <span class="add-tags"><Plus size={11}/>tag</span>
                        {/if}
                    </button>
                {/if}
                {#if propCount > 0}
                    <span class="meta-div"></span>
                    <button
                            class="props-chip"
                            class:open={propsOpen}
                            title={propsOpen ? 'Hide properties' : 'Show properties'}
                            onclick={() => (propsOpen = !propsOpen)}
                    >
                        <SlidersHorizontal size={12} strokeWidth={1.75}/>
                        <span class="props-count">{propCount}</span>
                    </button>
                {/if}
                <span class="meta-div"></span>
                <span class="meta-date">Updated {formatDateFriendly(handle.updatedAt)}</span>
            </div>
        </div>

        {#if source.use_frontmatter}
            <DocProperties {handle} open={propsOpen} onCount={(n) => (propCount = n)}/>
        {/if}
    </div>
</div>

<Menu
        bind:open={menuOpen}
        anchor={menuAnchor}
        items={menuItems}
        onSelect={onMenuSelect}
        minWidth={140}
/>
<FolderValueEditor
        bind:open={folderOpen}
        anchor={pickAnchor}
        value={folderPickerValue}
        manage
        onChange={onPickFolder}
/>
<Menu
        bind:open={tagMenuOpen}
        anchor={tagAnchor}
        items={tagItems}
        multiple
        selectedValues={tagList.map((t) => t.id)}
        onSelect={toggleTag}
        onCreate={createTag}
        searchable
        placeholder="Search or create…"
        minWidth={180}
/>

<style>
    .doc-hero {
        flex-shrink: 0;
    }

    .hero-inner {
        position: relative;
        max-width: var(--page-max-width, 1200px);
        margin: 0 auto;
        padding: 34px 24px 6px;
    }

    .hero-inner.compact {
        padding: 2px 0 6px;
    }

    /* Meta sits inline with the title; when the row can't give it its basis width
       it wraps to its own line, which is the old two-row layout. */
    .head-row {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        column-gap: 32px;
        row-gap: 9px;
        padding-right: 30px;
    }

    /* appearance.compact_doc_header off: meta always stacks under the title */
    :global(:root[data-doc-header='full']) .head-row {
        display: block;
    }

    :global(:root[data-doc-header='full']) .meta-row {
        justify-content: flex-start;
        margin-top: 10px;
        transform: none;
    }

    .title-left {
        display: flex;
        align-items: baseline;
        flex: 0 1 auto;
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

    /* Out of flow so the meta can wrap under the title without dragging it along.
       Sized to the metadata row, not the title. */
    /* The 22px button matches the title's line box, so it centres on the title line
       by simply starting where the row does. */
    .kebab {
        position: absolute;
        top: 34px;
        right: 24px;
        z-index: 1;
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
        transition: background-color 120ms ease,
        color 120ms ease;
    }

    .hero-inner.compact .kebab {
        top: 2px;
        right: 0;
    }

    .kebab:hover {
        background: var(--chip-bg-hover);
        color: var(--color-text-primary);
    }

    /* ── Metadata ── */
    .meta-row {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        flex: 1 1 340px;
        min-width: 0;
        transform: translateY(-1px);
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-ui-muted);
    }

    .loc-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        padding: 2px 8px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--color-ui-muted);
        font-family: var(--font-ui);
        font-size: 12px;
        white-space: nowrap;
        cursor: pointer;
    }

    .loc-chip:hover {
        background: var(--chip-bg);
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

    .meta-div {
        width: 1px;
        height: 12px;
        flex-shrink: 0;
        border-radius: 999px;
        background: var(--color-border);
    }

    .props-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
        height: 20px;
        padding: 0 6px;
        border: none;
        border-radius: 5px;
        background: transparent;
        color: var(--color-ui-muted);
        font-family: var(--font-ui);
        font-size: 12px;
        cursor: pointer;
        transition: background-color 120ms ease,
        color 120ms ease;
    }

    .props-chip:hover,
    .props-chip.open {
        background: var(--chip-bg);
        color: var(--color-text-primary);
    }

    .props-count {
        color: var(--color-ui-dulled);
    }

    .props-chip:hover .props-count,
    .props-chip.open .props-count {
        color: var(--color-text-secondary);
    }

    .meta-date {
        flex-shrink: 0;
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

    .tags-chip.has-tags:hover::after {
        content: '';
        position: absolute;
        left: 2px;
        right: 2px;
        bottom: -3px;
        height: 1px;
        border-radius: 999px;
        background: var(--color-border);
    }

    .add-tags {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        height: 18px;
        padding: 0 9px 0 6px;
        border-radius: 999px;
        border: 1px dashed var(--color-border);
        color: var(--color-ui-muted);
        font-family: var(--font-ui);
        font-size: 11px;
    }

    .tags-chip:hover .add-tags {
        color: var(--color-text-secondary);
        border-color: var(--color-ui-muted);
    }

    .tag {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        height: 18px;
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
</style>
