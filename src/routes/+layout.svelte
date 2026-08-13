<script lang="ts">
	import type { Snippet } from 'svelte';
	import ToastHost from '../components/ToastHost.svelte';
	import '@fontsource/inter/400.css';
	import '@fontsource/inter/500.css';
	import '@fontsource/inter/600.css';
	import '@fontsource/inter/700.css';
	import '@fontsource/jetbrains-mono/400.css';
	import '@fontsource/jetbrains-mono/500.css';
	import '@fontsource/jetbrains-mono/700.css';
	import '@fontsource/jetbrains-mono/800.css';
	import '../app.css';

	let { children }: { children: Snippet } = $props();
</script>

{@render children()}
<ToastHost />
