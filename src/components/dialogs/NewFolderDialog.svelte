<script lang="ts">
	import { FolderPlus } from '@lucide/svelte';
	import { nameGuard } from '#lib/util/paths.js';

	let {
		open = $bindable(false),
		onCreate,
		problem = () => null
	}: {
		open: boolean;
		onCreate: (name: string) => void | Promise<void>;
		problem?: (name: string) => string | null;
	} = $props();

	let name = $state('');
	let busy = $state(false);
	const trouble = $derived(problem(name));
	const ready = $derived(name.trim() !== '' && !trouble);

	function focus(node: HTMLInputElement) {
		node.focus();
	}

	async function submit() {
		if (!ready || busy) return;
		busy = true;
		try {
			await onCreate(name.trim());
			open = false;
		} finally {
			busy = false;
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
		else if (e.key === 'Enter') {
			e.preventDefault();
			submit();
		}
	}

	$effect(() => {
		if (open) {
			name = '';
			busy = false;
		}
	});
</script>

{#if open}
	<div class="overlay" onclick={() => (open = false)} onkeydown={onKey} role="presentation">
		<div
			class="dialog"
			onclick={(e) => e.stopPropagation()}
			onkeydown={onKey}
			role="dialog"
			tabindex="-1"
		>
			<h3 class="title">New folder</h3>

			<label class="field">
				<span class="label">Name</span>
				<span class="input">
					<FolderPlus size={14} strokeWidth={1.75} />
					<input
						type="text"
						class:invalid={trouble}
						title={trouble ?? undefined}
						bind:value={name}
						use:focus
						use:nameGuard
						spellcheck="false"
					/>
				</span>
			</label>

			<div class="actions">
				<button class="btn" type="button" onclick={() => (open = false)}>Cancel</button>
				<button class="btn primary" type="button" disabled={busy || !ready} onclick={submit}>
					Create
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 1500;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
	}

	.dialog {
		width: 380px;
		max-width: calc(100vw - 32px);
		padding: 20px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
	}

	.title {
		margin: 0 0 16px;
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-bottom: 14px;
	}

	.label {
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.input {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		box-sizing: border-box;
		padding: 8px 10px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		color: var(--color-ui-muted);
	}

	.input:focus-within {
		border-color: var(--focus-border);
	}

	.input input.invalid {
		text-decoration: underline;
		text-decoration-color: var(--error-fg);
		text-underline-offset: 3px;
	}

	.input input {
		flex: 1;
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 13px;
		outline: none;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 4px;
	}

	.btn {
		padding: 7px 14px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 13px;
		cursor: pointer;
	}

	.btn:hover {
		color: var(--color-text-primary);
	}

	.btn.primary {
		border-color: transparent;
		background: var(--color-accent);
		color: var(--color-accent-contrast);
	}

	.btn.primary:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
