<script lang="ts">
	import { getVersion } from '@tauri-apps/api/app';
	import { onMount, untrack } from 'svelte';
	import '@fontsource/jetbrains-mono/400.css';
	import '@fontsource/jetbrains-mono/500.css';
	import '@fontsource/jetbrains-mono/700.css';
	import '@fontsource/jetbrains-mono/800.css';

	let { animateIn = true }: { animateIn?: boolean } = $props();

	let now = $state(new Date());
	let version = $state('');

	const timeStr = $derived.by(() => {
		const h = now.getHours() % 12 || 12;
		const m = now.getMinutes().toString().padStart(2, '0');
		return `${h}:${m}`;
	});
	const dateStr = $derived(
		now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
	);
	const ampm = $derived(now.getHours() < 12 ? 'am' : 'pm');

	let ready = $state(untrack(() => !animateIn));

	onMount(() => {
		getVersion().then((v) => (version = v));
		if (!ready) requestAnimationFrame(() => (ready = true));
		const id = setInterval(() => {
			now = new Date();
		}, 1000);
		return () => clearInterval(id);
	});
</script>

<div class="hero" class:ready>
	<div class="time">{timeStr}</div>
	<div class="meta">
		<div class="date">{dateStr}</div>
		<div class="brand">{ampm}<span class="brand-sep">·</span>limestone v{version || '0.1.0'}</div>
	</div>
</div>

<style>
	.hero {
		display: flex;
		align-items: stretch;
		justify-content: center;
		gap: 12px;
	}

	.time,
	.meta {
		opacity: 0;
		transform: translateY(5px);
		transition:
			opacity 420ms ease,
			transform 420ms cubic-bezier(0.2, 0.7, 0.3, 1);
	}

	.hero.ready .time,
	.hero.ready .meta {
		opacity: 1;
		transform: none;
	}

	.hero.ready .meta {
		transition-delay: 90ms;
	}

	.time {
		font-family: 'JetBrains Mono', var(--font-editor), monospace;
		font-size: 45px;
		font-weight: 800;
		line-height: 1;
		letter-spacing: -0.01em;
		color: var(--color-text-primary);
		font-variant-numeric: tabular-nums;
	}

	.meta {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: flex-start;
		gap: 8px;
		padding-bottom: 1px;
	}

	.date {
		font-family: 'JetBrains Mono', var(--font-editor), monospace;
		font-size: 18px;
		font-weight: 500;
		line-height: 1;
		letter-spacing: -0.06em;
		color: var(--color-text-primary);
		white-space: nowrap;
	}

	.brand {
		font-family: 'JetBrains Mono', var(--font-editor), monospace;
		font-size: 12px;
		font-weight: 400;
		line-height: 1;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-ui-dulled);
		white-space: nowrap;
	}

	.brand-sep {
		margin: 0 0.35em;
	}
</style>
