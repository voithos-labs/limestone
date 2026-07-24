<script lang="ts">
	import { toasts } from '$lib/toasts.svelte';
	import { X, CircleAlert, ArrowUp, RotateCw, Check } from '@lucide/svelte';

	function splitColon(message: string): [string, string | null] {
		const i = message.indexOf(':');
		if (i === -1) return [message, null];
		return [message.slice(0, i + 1), message.slice(i + 1).trim()];
	}
</script>

{#if toasts.items.length}
	<div class="toast-host">
		{#each toasts.items as t (t.id)}
			{@const [head, detail] = splitColon(t.message)}
			<div class="toast toast-{t.variant}">
				{#if t.variant === 'update'}
					<button
						class="toast-main clickable"
						onclick={() => {
							t.action?.run();
							toasts.dismiss(t.id);
						}}
					>
						<span class="toast-icon"><ArrowUp size={16} strokeWidth={2.25} /></span>
						<div class="toast-body">
							<span class="toast-head">{head}</span>
							{#if detail}<span class="toast-detail">{detail}</span>{/if}
						</div>
					</button>
				{:else}
					<div class="toast-main">
						<span class="toast-icon">
							{#if t.variant === 'info'}
								<Check size={16} strokeWidth={2.25} />
							{:else}
								<CircleAlert size={16} strokeWidth={2.25} />
							{/if}
						</span>
						<div class="toast-body">
							<span class="toast-head">{head}</span>
							{#if detail}<span class="toast-detail">{detail}</span>{/if}
						</div>
					</div>
					{#if t.action}
						<button
							class="toast-region"
							onclick={() => {
								t.action?.run();
								toasts.dismiss(t.id);
							}}
						>
							<RotateCw size={13} strokeWidth={2.25} />
							{t.action.label}
						</button>
					{/if}
				{/if}
				<button class="toast-region" aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}>
					<X size={13} strokeWidth={2.25} />
				</button>
			</div>
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
		gap: 10px;
		max-width: 500px;
	}

	.toast {
		display: flex;
		align-items: stretch;
		border-radius: 8px;
		overflow: hidden;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 13px;
		line-height: 1.4;
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

	.toast-main {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		padding: 9px 12px;
		border: none;
		background: transparent;
		font: inherit;
		color: inherit;
		text-align: left;
	}

	.toast-main.clickable {
		cursor: pointer;
	}

	.toast-main.clickable:hover {
		background: var(--menu-item-hover);
	}

	.toast-icon {
		display: flex;
		flex-shrink: 0;
		align-self: center;
		color: var(--error-fg);
	}

	.toast-update .toast-icon,
	.toast-info .toast-icon {
		color: var(--color-accent);
	}

	.toast-body {
		display: flex;
		flex-direction: column;
		gap: 1px;
		flex: 1;
		min-width: 0;
	}

	.toast-head {
		font-weight: 560;
		color: var(--color-text-primary);
	}

	.toast-detail {
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.toast-region {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 0 12px;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 12px;
		line-height: 1;
		cursor: pointer;
	}

	.toast-region:hover {
		background: var(--menu-item-hover);
		color: var(--color-text-primary);
	}
</style>
