<script lang="ts">
    import type View from "$lib/models/View.svelte";
    import type {ViewFace} from "$lib/models/View.svelte";
    import type EditorState from "$lib/state/EditorState.svelte";
    import DocHandle from "$lib/models/DocHandle";
    import ViewHeader from "../views/ViewHeader.svelte";
    import TableFace from "../views/faces/TableFace.svelte";

    let {view, editor}: { view: View; editor: EditorState } = $props();

    const activeFace: ViewFace = $derived(
        view.faces.find(f => f.id === (view.previewFaceId ?? view.state.active_face_id)) ?? view.faces[0]
    );

    // Bumped by the header's "+ New" button; the active face watches it and begins
    // a create in whatever way fits its layout (table = floating draft row at top).
    let createSignal = $state(0);

    function onOpenRow(rowId: string) {
        DocHandle.fromID(rowId).then(d => editor.openDoc(d)).catch(console.error);
    }
</script>

<div class="view-page">
    <div class="view-chrome">
        <ViewHeader {view} onNew={() => createSignal++}/>
    </div>

    <TableFace
            {view}
            face={activeFace}
            {onOpenRow}
            {createSignal}
    />
</div>

<style>
    .view-page {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        max-width: var(--page-max-width, none);
        margin-left: auto;
        margin-right: auto;
        overflow: hidden;
    }

    .view-chrome {
        flex-shrink: 0;
        padding: 20px 0 0 24px;
    }
</style>
