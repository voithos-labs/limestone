<script lang="ts">
	import { untrack } from 'svelte';
	import { Hash } from '@lucide/svelte';
	import type View from '#lib/models/View.svelte.js';
	import type { ViewFace, ViewField } from '#lib/models/View.svelte.js';
	import { onSourceReconciled } from '#lib/models/Source.js';

	let { view, face, field }: { view: View; face: ViewFace; field: ViewField } = $props();

	type Chip = { value: string; label: string; n: number };
	let chips: Chip[] = $state([]);
	const selected = $derived((view.state.quick_value as string | undefined) ?? null);

	async function load() {
		try {
			const counts = await view.countValues(field, { face });
			const options = ((field.config?.options ?? []) as { value: string }[]).map((o) => o.value);
			const rank = (v: string) => {
				const i = options.indexOf(v);
				return i < 0 ? options.length : i;
			};
			chips = counts
				.map((c) => ({
					value: c.value,
					label: field.type === 'boolean' ? (c.value === '1' ? 'yes' : 'no') : c.label,
					n: c.n
				}))
				.sort((a, b) =>
					field.type === 'select'
						? rank(a.value) - rank(b.value)
						: b.n - a.n || a.label.localeCompare(b.label)
				);
			if (selected && !chips.some((c) => c.value === selected)) view.state.quick_value = null;
		} catch (e) {
			console.error('quick filter values failed', e);
		}
	}

	$effect(() => {
		void field.id;
		void view.subfolder;
		void view.filter;
		void face.additive_filter;
		untrack(load);
	});
	$effect(() => onSourceReconciled(load));

	function onWheel(e: WheelEvent) {
		const el = e.currentTarget as HTMLElement;
		if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
		el.scrollLeft += e.deltaY;
		e.preventDefault();
	}
</script>

{#if chips.length > 0}
	<div class="chips" onwheel={onWheel}>
		<button
			class="chip"
			class:on={!selected}
			type="button"
			onclick={() => (view.state.quick_value = null)}
		>
			all
		</button>
		{#each chips as c (c.value)}
			<button
				class="chip"
				class:on={selected === c.value}
				type="button"
				onclick={() => (view.state.quick_value = selected === c.value ? null : c.value)}
			>
				{#if field.type === 'tags'}<Hash size={11} strokeWidth={2} />{/if}{c.label}
				<span class="n">{c.n}</span>
			</button>
		{/each}
	</div>
{/if}

<style>
	.chips {
		display: flex;
		flex-wrap: nowrap;
		gap: 6px;
		margin: -6px 24px 14px 0;
		overflow-x: auto;
		scrollbar-width: none;
		font-family: var(--font-ui);
	}

	.chips::-webkit-scrollbar {
		display: none;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		gap: 4px;
		height: 24px;
		padding: 0 9px;
		border: none;
		border-radius: 6px;
		background: var(--chip-bg);
		font: inherit;
		font-size: 12px;
		line-height: 1.45;
		color: var(--color-ui-muted);
		cursor: pointer;
		transition:
			background-color 100ms ease,
			color 100ms ease;
	}

	.chip:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-secondary);
	}

	.chip.on {
		background: var(--accent-a14);
		color: var(--color-accent);
	}

	.chip :global(svg) {
		flex-shrink: 0;
	}

	.n {
		margin-left: 2px;
		font-size: 10.5px;
		opacity: 0.75;
	}
</style>
