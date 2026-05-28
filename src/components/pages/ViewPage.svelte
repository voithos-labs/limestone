<script lang="ts">
    import type View from "$lib/models/View.svelte";
    import type {ViewFace} from "$lib/models/View.svelte";
    import ViewHeader from "../views/ViewHeader.svelte";
    import TableFace from "../views/faces/TableFace.svelte";

    let {view}: { view: View } = $props();

    const activeFace: ViewFace = $derived(view.faces[0]);

    let meta = $state({loading: true, count: 0, elapsedMs: 0});
</script>

<div class="view-page">
    <ViewHeader {view} loading={meta.loading} count={meta.count} elapsedMs={meta.elapsedMs}/>

    <TableFace
            {view}
            face={activeFace}
            onMeta={(m) => { meta = m; }}
    />
</div>

<style>
    .view-page {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 24px 32px;
        overflow: hidden;
    }
</style>
