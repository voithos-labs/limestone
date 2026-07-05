<script lang="ts">
	import { toasts } from '$lib/toasts.svelte';
	import { X, CircleAlert, RotateCw } from '@lucide/svelte';

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
			<div class="toast">
				<span class="toast-icon"><CircleAlert size={16} strokeWidth={2.25} /></span>
				<div class="toast-body">
					<span class="toast-head">{head}</span>
					{#if detail}<span class="toast-detail">{detail}</span>{/if}
				</div>
				<div class="toast-actions">
					{#if t.action}
						<button
							class="toast-btn"
							onclick={() => {
								t.action?.run();
								toasts.dismiss(t.id);
							}}
						>
							<RotateCw size={13} strokeWidth={2.25} />
							{t.action.label}
						</button>
					{/if}
					<button class="toast-btn" aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}>
						<X size={13} strokeWidth={2.25} />
					</button>
				</div>
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
		align-items: center;
		gap: 10px;
		padding: 9px 10px 9px 12px;
		border-radius: 8px;
		background: linear-gradient(var(--error-bg), var(--error-bg)), var(--color-bg);
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

	.toast-icon {
		display: flex;
		flex-shrink: 0;
		color: var(--error-fg);
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

	.toast-actions {
		flex-shrink: 0;
		align-self: stretch;
		display: flex;
		align-items: center;
		gap: 2px;
		padding-left: 8px;
		border-left: 1px solid var(--color-border);
	}

	.toast-btn {
		flex-shrink: 0;
		align-self: center;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 8px;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 12px;
		line-height: 1;
		cursor: pointer;
	}

	.toast-btn:hover {
		background: var(--menu-item-hover);
		color: var(--color-text-primary);
	}
</style>
