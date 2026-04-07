<script lang="ts">
    import type EditorState from "$lib/state/EditorState";

    let {editor}: { editor: EditorState } = $props();
    

</script>


<nav class="nav-bar"></nav>

<style>
    .nav-bar {
        display: flex;
        flex-direction: row;
        height: 32px; /* Fixed for windows */
        width: 100%;
        outline: #ff4444;
    }
</style>
