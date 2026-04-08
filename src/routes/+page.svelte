<script lang="ts">
    import TopBar from "../components/TopBar.svelte";
    import EditorState from "$lib/state/EditorState";
    import Session from "$lib/models/Session";

    let session = $state<Session>();
    Session.init().then((s) => session = s);
</script>
{#if session}

{/if}