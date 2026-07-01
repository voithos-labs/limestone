<script lang="ts">
    import type {Snippet} from 'svelte';
    import {onMount} from 'svelte';
    import {getCurrentWebview} from '@tauri-apps/api/webview';
    import {getSetting} from '$lib/models/Settings';
    import ToastHost from '../components/ToastHost.svelte';
    import '../app.css';

    let {children}: { children: Snippet } = $props();

    onMount(async () => {
        const percent = await getSetting<number>('appearance.ui_scale_percent');
        if (percent && percent > 0) {
            await getCurrentWebview().setZoom(percent / 100);
        }
        const maxWidth = await getSetting<number>('appearance.max_page_width');
        if (maxWidth && maxWidth > 0) {
            document.documentElement.style.setProperty('--page-max-width', maxWidth + 'px');
        }
    });
</script>

{@render children()}
<ToastHost/>