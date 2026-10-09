<script lang="ts">
	import { toasts, type Toast, type ToastVariant } from '#lib/overlays.svelte.js';
	import { splitMessage } from '#lib/overlays.svelte.js';
	import { X, CircleX, CircleCheck, CircleArrowUp } from '@lucide/svelte';
	import MarkText from '../ui/MarkText.svelte';

	function act(t: Toast) {
		t.action?.run();
		toasts.dismiss(t.id);
	}
</script>

{#snippet icon(variant: ToastVariant)}
	<span class="toast-icon">
		{#if variant === 'update'}
			<CircleArrowUp size={15} strokeWidth={2} />
		{:else if variant === 'info'}
			<CircleCheck size={15} strokeWidth={2} />
		{:else}
			<CircleX size={15} strokeWidth={2} />
		{/if}
	</span>
{/snippet}

{#snippet close(t: Toast)}
	<button class="toast-close" aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}>
		<X size={13} strokeWidth={2.25} />
	</button>
{/snippet}

{#if toasts.items.length}
	<div class="toast-host">
		{#each toasts.items as t (t.id)}
			{@const [title, detail] = splitMessage(t.message)}
			{#if detail}
				<div class="toast card toast-{t.variant}">
					{@render icon(t.variant)}
					<div class="card-body">
						<span class="card-title"><MarkText text={title} /></span>
						<span class="card-detail"><MarkText text={detail} /></span>
						{#if t.action}
							<div class="card-actions">
								<button class="toast-action" onclick={() => act(t)}>{t.action.label}</button>
							</div>
						{/if}
					</div>
					{@render close(t)}
				</div>
			{:else}
				<div class="toast line toast-{t.variant}">
					{@render icon(t.variant)}
					<span class="line-text"><MarkText text={title} /></span>
					{#if t.action}
						<button class="toast-action" onclick={() => act(t)}>{t.action.label}</button>
					{/if}
					{@render close(t)}
				</div>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.toast-host {
		position: fixed;
		bottom: 20px;
		right: 20px;
		z-index: 3000;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 8px;
		max-width: calc(100vw - 40px);
	}

	.toast {
		display: flex;
		border-radius: 10px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		color: var(--color-text-primary);
		animation: toast-pop 0.16s ease-out;
	}

	@keyframes toast-pop {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.line {
		align-items: center;
		gap: 9px;
		max-width: min(560px, 100%);
		height: 36px;
		padding: 0 6px 0 12px;
		font-size: 12.5px;
	}

	.line-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card {
		position: relative;
		align-items: flex-start;
		gap: 10px;
		width: fit-content;
		min-width: min(300px, 100%);
		max-width: min(440px, 100%);
		padding: 11px 14px 12px 13px;
	}

	.card-body {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}

	.card-title {
		padding-right: 22px;
		font-size: 13px;
		font-weight: 550;
		line-height: 20px;
	}

	.card-detail {
		font-size: 12px;
		line-height: 1.45;
		color: var(--color-text-secondary);
	}

	.card-actions {
		display: flex;
		gap: 4px;
		margin: 5px 0 -3px -7px;
	}

	.toast-icon {
		display: flex;
		flex-shrink: 0;
		color: var(--error-fg);
	}

	.card .toast-icon {
		margin-top: 1.5px;
	}

	.toast-update .toast-icon,
	.toast-info .toast-icon {
		color: var(--color-accent);
	}

	.toast-action {
		flex-shrink: 0;
		height: 24px;
		padding: 0 7px;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 12px;
		font-weight: 560;
		cursor: pointer;
	}

	.toast-close {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-muted, var(--color-text-secondary));
		cursor: pointer;
	}

	.card .toast-close {
		position: absolute;
		top: 7px;
		right: 7px;
	}

	.toast-action:hover,
	.toast-close:hover {
		background: var(--menu-item-hover);
		color: var(--color-text-primary);
	}
</style>
