<script lang="ts">
	import { contextMenu, isCtxItem, type CtxEntry, type CtxItem } from '$lib/contextMenu.svelte';
	import { onMount } from 'svelte';
	import { Check, ChevronRight } from '@lucide/svelte';

	let menuEl: HTMLDivElement | null = $state(null);
	let pos: { top: number; left: number } | null = $state(null);

	// one flyout at a time, opened by hovering an item with children; it hangs off that
	// item's right edge and falls back to the left when the viewport is short
	let flyFor: number | null = $state(null);
	let flyEl: HTMLDivElement | null = $state(null);
	let flyPos: { top: number; left: number } | null = $state(null);
	const flyItems = $derived.by((): CtxEntry[] => {
		const e = flyFor === null ? undefined : contextMenu.items[flyFor];
		return e && isCtxItem(e) ? (e.children ?? []) : [];
	});

	$effect(() => {
		if (!contextMenu.open) flyFor = null;
	});

	function openFly(i: number, el: HTMLElement) {
		const entry = contextMenu.items[i];
		if (!entry || !isCtxItem(entry) || !entry.children) {
			flyFor = null;
			return;
		}
		flyFor = i;
		const r = el.getBoundingClientRect();
		flyPos = { top: r.top - 4, left: r.right + 2 };
	}

	$effect(() => {
		if (flyFor === null || !flyEl || !flyPos) return;
		const m = flyEl.getBoundingClientRect();
		let { top, left } = flyPos;
		if (left + m.width > window.innerWidth - 8) {
			const anchor = menuEl?.getBoundingClientRect();
			left = Math.max(8, (anchor?.left ?? left) - m.width - 2);
		}
		if (top + m.height > window.innerHeight - 8)
			top = Math.max(8, window.innerHeight - 8 - m.height);
		if (top !== flyPos.top || left !== flyPos.left) flyPos = { top, left };
	});

	// Clamp into the viewport once rendered (so it doesn't spill off-screen)
	$effect(() => {
		if (!contextMenu.open || !menuEl) {
			pos = null;
			return;
		}
		const m = menuEl.getBoundingClientRect();
		let left = contextMenu.x;
		let top = contextMenu.y;
		if (left + m.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - m.width);
		if (top + m.height > window.innerHeight - 8)
			top = Math.max(8, window.innerHeight - 8 - m.height);
		pos = { top, left };
	});

	function select(item: CtxItem) {
		if (item.disabled || item.children) return;
		if (!item.keepOpen) contextMenu.close();
		item.action?.();
	}

	function onPointerDown(e: PointerEvent) {
		if (!contextMenu.open) return;
		const t = e.target as Node;
		if (menuEl?.contains(t) || flyEl?.contains(t)) return;
		contextMenu.close();
	}

	function onKey(e: KeyboardEvent) {
		if (contextMenu.open && e.key === 'Escape') {
			e.preventDefault();
			contextMenu.close();
		}
	}

	onMount(() => {
		// Never show the native context menu anywhere.
		const suppress = (e: MouseEvent) => e.preventDefault();
		const onBlur = () => contextMenu.close();
		window.addEventListener('contextmenu', suppress);
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('keydown', onKey);
		window.addEventListener('blur', onBlur);
		return () => {
			window.removeEventListener('contextmenu', suppress);
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('blur', onBlur);
		};
	});
</script>

{#if contextMenu.open}
	<div
		class="ctx-menu"
		bind:this={menuEl}
		style:top="{(pos ?? { top: contextMenu.y, left: contextMenu.x }).top}px"
		style:left="{(pos ?? { top: contextMenu.y, left: contextMenu.x }).left}px"
		style:min-width="{contextMenu.minWidth}px"
		role="menu"
		tabindex="-1"
	>
		{#each contextMenu.items as entry, i}
			{@render item(entry, i, false)}
		{/each}
	</div>
	{#if flyFor !== null && flyItems.length > 0}
		<div
			class="ctx-menu fly"
			bind:this={flyEl}
			style:top="{flyPos?.top ?? 0}px"
			style:left="{flyPos?.left ?? 0}px"
			role="menu"
			tabindex="-1"
		>
			{#each flyItems as entry, i}
				{@render item(entry, i, true)}
			{/each}
		</div>
	{/if}
{/if}

{#snippet item(entry: CtxEntry, i: number, inFly: boolean)}
	{#if isCtxItem(entry)}
		{@const Icon = entry.icon}
		<button
			class="ctx-item"
			class:danger={entry.danger}
			class:open={!inFly && flyFor === i}
			type="button"
			disabled={entry.disabled}
			onclick={(e) => {
				if (entry.children) openFly(i, e.currentTarget as HTMLElement);
				else select(entry);
			}}
			onpointerenter={(e) => {
				if (!inFly) openFly(i, e.currentTarget as HTMLElement);
			}}
		>
			{#if entry.emoji}
				<span class="ctx-icon ctx-emoji">{entry.emoji}</span>
			{:else if Icon}
				<span class="ctx-icon"><Icon size={14} strokeWidth={1.75} /></span>
			{/if}
			<span class="ctx-label">{entry.label}</span>
			{#if entry.children}
				<span class="ctx-more"><ChevronRight size={13} strokeWidth={2} /></span>
			{:else if entry.checked}
				<span class="ctx-more"><Check size={13} strokeWidth={2.5} /></span>
			{:else if entry.aux}
				{@const Aux = entry.aux.icon}
				<span
					class="ctx-aux"
					role="button"
					tabindex="-1"
					title={entry.aux.label}
					onclick={(e) => {
						e.stopPropagation();
						contextMenu.close();
						entry.aux?.action();
					}}
				>
					<Aux size={13} strokeWidth={1.75} />
				</span>
			{/if}
		</button>
	{:else}
		<div class="ctx-divider"></div>
	{/if}
{/snippet}

<style>
	.ctx-menu {
		position: fixed;
		z-index: 2000;
		min-width: 168px;
		padding: 4px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 13px;
		color: var(--color-text-primary);
	}

	.ctx-item {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 7px 10px;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.ctx-item:hover,
	.ctx-item.open {
		background: var(--menu-item-hover);
	}

	.ctx-more {
		display: inline-flex;
		align-items: center;
		margin-left: auto;
		padding-left: 12px;
		color: var(--color-ui-muted);
	}

	.ctx-item:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.ctx-item:disabled:hover {
		background: transparent;
	}

	.ctx-icon {
		display: inline-flex;
		align-items: center;
		color: var(--color-ui-muted);
		flex-shrink: 0;
	}

	.ctx-emoji {
		width: 14px;
		justify-content: center;
		font-size: 13px;
		line-height: 1;
	}

	.ctx-item.danger {
		color: var(--color-accent);
	}

	.ctx-item.danger .ctx-icon {
		color: var(--color-accent);
	}

	/* the row's second action: quiet until the row is hovered */
	.ctx-aux {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		margin: -4px -6px -4px auto;
		border-radius: 5px;
		color: var(--color-ui-muted);
		opacity: 0;
		transition:
			opacity 80ms ease,
			background-color 80ms ease;
	}

	.ctx-item:hover .ctx-aux {
		opacity: 1;
	}

	.ctx-aux:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.ctx-divider {
		height: 1px;
		margin: 4px 6px;
		background: var(--color-border);
	}
</style>
