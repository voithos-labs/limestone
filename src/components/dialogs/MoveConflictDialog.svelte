<script lang="ts">
	import { moveConflict, type ConflictChoice } from '$lib/views/move.svelte';
	import { mark } from '$lib/overlays.svelte';
	import MarkText from '../ui/MarkText.svelte';
	import type Session from '$lib/models/Session.svelte';

	let { session }: { session: Session } = $props();

	$effect(() => {
		moveConflict.onReplaced = (docId) => {
			for (const editor of session.editors) {
				for (const t of [...editor.tabs, editor.preview]) {
					if (t?.content.type === 'markdown' && t.content.handle.id === docId)
						editor.closeTab(t.id, false);
				}
			}
		};
		return () => (moveConflict.onReplaced = null);
	});

	const conflict = $derived(moveConflict.current);
	let all = $state(false);

	$effect(() => {
		if (conflict) all = false;
	});

	function answer(choice: ConflictChoice) {
		moveConflict.answer(choice, all);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') answer('cancel');
	}

	function focus(node: HTMLButtonElement) {
		node.focus();
	}
</script>

{#if conflict}
	<div class="overlay" onclick={() => answer('cancel')} onkeydown={onKey} role="presentation">
		<div
			class="dialog"
			onclick={(e) => e.stopPropagation()}
			onkeydown={onKey}
			role="dialog"
			tabindex="-1"
		>
			<h3 class="title">Name already in use</h3>
			<p class="what">
				<MarkText
					text={`${conflict.into} already has a ${conflict.kind} named ${mark(conflict.kind, conflict.name)}.`}
				/>
			</p>
			<p class="hint">
				{#if conflict.kind === 'note'}
					Keep both adds a number to the moved note. Replace sends the existing one to the trash.
				{:else}
					Keep both adds a number to the moved folder.
				{/if}
			</p>

			{#if conflict.remaining > 0}
				<label class="all">
					<input type="checkbox" bind:checked={all} />
					Do this for the other {conflict.remaining}
					{conflict.remaining === 1 ? 'item' : 'items'} being moved
				</label>
			{/if}

			<div class="actions">
				<button class="btn" type="button" onclick={() => answer('cancel')}>
					{conflict.remaining > 0 ? 'Skip' : 'Cancel'}
				</button>
				{#if conflict.kind === 'note'}
					<button class="btn danger" type="button" onclick={() => answer('replace')}>
						Replace
					</button>
				{/if}
				<button class="btn primary" type="button" use:focus onclick={() => answer('keep')}>
					Keep both
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
		width: 400px;
		max-width: calc(100vw - 32px);
		padding: 20px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
	}

	.title {
		margin: 0 0 12px;
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.what {
		margin: 0 0 6px;
		font-size: 13px;
		line-height: 26px;
		color: var(--color-text-primary);
	}

	.hint {
		margin: 0 0 16px;
		font-size: 12px;
		line-height: 1.45;
		color: var(--color-ui-muted);
	}

	.all {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 16px;
		font-size: 12.5px;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.all input {
		margin: 0;
		accent-color: var(--color-accent);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
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

	.btn.danger {
		color: var(--error-fg);
	}

	.btn.primary {
		border-color: transparent;
		background: var(--color-accent);
		color: var(--color-accent-contrast);
	}
</style>
