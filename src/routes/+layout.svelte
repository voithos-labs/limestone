<script lang="ts">
	import type { Snippet } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { loadAndApplyTheme } from '$lib/theme';
	import '../app.css';

	interface Source {
		id: string;
		path: string;
	}

	let { children }: { children: Snippet } = $props();

	async function init() {
		const source = await invoke<Source | null>('get_active_source');
		if (source) {
			await loadAndApplyTheme(source.path);
		}
	}

	init();
</script>

{@render children()}
