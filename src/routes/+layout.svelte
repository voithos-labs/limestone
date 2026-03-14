<script lang="ts">
    import type { Snippet } from "svelte";
    import { invoke } from "@tauri-apps/api/core";
    import { loadAndApplyTheme } from "$lib/theme";
    import "../app.css";

    interface Vault {
        id: string;
        path: string;
    }

    let { children }: { children: Snippet } = $props();

    async function init() {
        const vault = await invoke<Vault | null>("get_active_vault");
        if (vault) {
            await loadAndApplyTheme(vault.path);
        }
    }

    init();
</script>

{@render children()}
