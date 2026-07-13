<script lang="ts">
	import type { Snippet } from 'svelte';
	import ToastHost from '../components/ToastHost.svelte';
	import '../app.css';

	let { children }: { children: Snippet } = $props();
</script>

{@render children()}
<ToastHost />
