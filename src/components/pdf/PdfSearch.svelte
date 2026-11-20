<script lang="ts">
	import { ChevronDown, ChevronUp, Search, X } from '@lucide/svelte';
	import type PdfFind from '#lib/pdf/PdfFind.svelte.js';

	let {
		find,
		onStep,
		onClose
	}: { find: PdfFind; onStep: (dir: 1 | -1) => void; onClose?: () => void } = $props();

	const TYPE_SETTLE_MS = 150;

	let input: HTMLInputElement | undefined = $state();
	let draft = $state(find.query);
	let timer: ReturnType<typeof setTimeout> | undefined;

	export function focus(select = true) {
		input?.focus();
		if (select) input?.select();
	}

	function onInput() {
		clearTimeout(timer);
		timer = setTimeout(() => void find.search(draft), TYPE_SETTLE_MS);
	}

	function clear() {
		clearTimeout(timer);
		draft = '';
		void find.search('');
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			clearTimeout(timer);
			if (draft !== find.query) void find.search(draft).then(() => onStep(1));
			else onStep(e.shiftKey ? -1 : 1);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			clear();
			input?.blur();
			onClose?.();
		}
	}

	$effect(() => () => {
		clearTimeout(timer);
		if (draft !== find.query) void find.search(draft);
	});

	const count = $derived(find.matches.length);
	const status = $derived.by(() => {
		if (!find.query.trim()) return '';
		if (!count) return find.scanning ? '…' : 'No results';
		return `${find.current < 0 ? count : `${find.current + 1} / ${count}`}${find.scanning ? '…' : ''}`;
	});
</script>

<div class="pdf-search">
	<span class="icon"><Search size={13} strokeWidth={1.75} /></span>
	<input
		bind:this={input}
		bind:value={draft}
		placeholder="Find in PDF"
		spellcheck="false"
		oninput={onInput}
		onkeydown={onKeydown}
	/>
	{#if status}<span class="status">{status}</span>{/if}
	<button type="button" title="Previous (Shift+Enter)" disabled={!count} onclick={() => onStep(-1)}>
		<ChevronUp size={14} strokeWidth={1.75} />
	</button>
	<button type="button" title="Next (Enter)" disabled={!count} onclick={() => onStep(1)}>
		<ChevronDown size={14} strokeWidth={1.75} />
	</button>
	<button
		type="button"
		title="Clear"
		disabled={!draft && !onClose}
		onclick={() => {
			clear();
			onClose?.();
		}}
	>
		<X size={13} strokeWidth={1.75} />
	</button>
</div>

<style>
	.pdf-search {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 34px;
		padding: 0 6px 0 10px;
		border-radius: 8px;
		background: linear-gradient(var(--chip-bg), var(--chip-bg)), var(--color-surface);
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 12.5px;
	}

	.icon {
		display: flex;
		flex-shrink: 0;
	}

	input {
		flex: 1;
		min-width: 0;
		padding: 0 4px;
		border: 0;
		outline: none;
		background: transparent;
		color: var(--color-text-primary);
		font: inherit;
	}

	input::placeholder {
		color: var(--color-ui-dulled);
	}

	.status {
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		padding: 0;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.4;
		cursor: default;
	}

	button:not(:disabled):hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}
</style>
