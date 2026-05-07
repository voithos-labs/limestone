<script lang="ts">
    import type {Snippet} from 'svelte';
    import {onMount} from 'svelte';
    import {getCurrentWebview} from '@tauri-apps/api/webview';
    import {getSetting} from '$lib/models/Settings';
    import '../app.css';

    let {children}: { children: Snippet } = $props();

    onMount(async () => {
        const percent = await getSetting<number>('appearance.ui_scale_percent');
        if (percent && percent > 0) {
            await getCurrentWebview().setZoom(percent / 100);
        }
    });
</script>

{@render children()}