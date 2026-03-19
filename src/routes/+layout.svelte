<script lang="ts">
	import type { Snippet } from 'svelte';
	import { loadAndApplyTheme } from '$lib/theme';
	import '../app.css';

	let { children }: { children: Snippet } = $props();

	loadAndApplyTheme();
</script>

{@render children()}
