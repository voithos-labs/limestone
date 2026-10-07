<script lang="ts">
	import { untrack, type Component } from 'svelte';
	import { nameGuard, type NameKind } from '#lib/util/paths.js';

	let {
		open = $bindable(false),
		anchor,
		value,
		inputType = 'text',
		placeholder = '',
		icon: Icon,
		guard = null,
		problem = () => null,
		onChange
	}: {
		open: boolean;
		anchor: HTMLElement | null;
		value: string;
		inputType?: 'text' | 'number' | 'date';
		placeholder?: string;
		icon?: Component;
		guard?: NameKind | null;
		problem?: (value: string) => string | null;
		onChange: (value: string) => void;
	} = $props();

	let popEl: HTMLDivElement | null = $state(null);
	let inputEl: HTMLInputElement | null = $state(null);
	let pos: { top: number; left: number } = $state({ top: 0, left: 0 });
	let draft = $state(untrack(() => value));
	const trouble = $derived(problem(draft));

	function position() {
		if (!anchor || !popEl) return;
		const a = anchor.getBoundingClientRect();
		const m = popEl.getBoundingClientRect();
		const margin = 4;
		let top = a.bottom + margin;
		let left = a.left;
		if (top + m.height > window.innerHeight - 8) {
			top = Math.max(8, a.top - m.height - margin);
		}
		if (left + m.width > window.innerWidth - 8) {
			left = Math.max(8, a.right - m.width);
		}
		pos = { top, left };
	}

	function commit() {
		if (draft !== value && !trouble) onChange(draft);
		open = false;
	}

	function cancel() {
		open = false;
	}

	function onDocPointerDown(e: PointerEvent) {
		if (!open) return;
		if (popEl?.contains(e.target as Node)) return;
		if (anchor?.contains(e.target as Node)) return;
		commit();
	}

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			cancel();
			e.preventDefault();
		} else if (e.key === 'Enter') {
			commit();
			e.preventDefault();
		}
	}

	$effect(() => {
		if (open) {
			draft = value;
			queueMicrotask(() => {
				position();
				inputEl?.focus();
				inputEl?.select();
			});
			window.addEventListener('resize', position);
			window.addEventListener('scroll', position, true);
			document.addEventListener('pointerdown', onDocPointerDown);
			document.addEventListener('keydown', onKey);
			return () => {
				window.removeEventListener('resize', position);
				window.removeEventListener('scroll', position, true);
				document.removeEventListener('pointerdown', onDocPointerDown);
				document.removeEventListener('keydown', onKey);
			};
		}
	});
</script>

{#if open}
	<div class="pop" bind:this={popEl} style:top="{pos.top}px" style:left="{pos.left}px">
		<div class="field" class:date={inputType === 'date'}>
			{#if Icon}<span class="lead"><Icon size={14} strokeWidth={1.75} /></span>{/if}
			<input
				bind:this={inputEl}
				bind:value={draft}
				use:nameGuard={guard}
				type={inputType}
				{placeholder}
				class="input"
				class:invalid={trouble}
				title={trouble ?? undefined}
			/>
		</div>
	</div>
{/if}

<style>
	.pop {
		position: fixed;
		z-index: 1000;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: var(--menu-shadow);
		padding: 6px;
		font-family: var(--font-ui);
	}

	.field {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 200px;
		padding: 5px 8px;
		border: 1px solid var(--color-border);
		border-radius: 5px;
		background: var(--color-bg);
	}

	.field:focus-within {
		border-color: var(--focus-border);
	}

	.field.date {
		width: 160px;
	}

	.lead {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.input.invalid {
		text-decoration: underline;
		text-decoration-color: var(--error-fg);
		text-underline-offset: 3px;
	}

	.input {
		flex: 1;
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		font-family: var(--font-ui);
		font-size: 13px;
		line-height: 1.4;
		color: var(--color-text-primary);
		outline: none;
	}
</style>
