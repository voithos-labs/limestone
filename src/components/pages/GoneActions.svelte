<script lang="ts" module>
	export type GoneAction = {
		label: string;
		run: () => unknown;
		strong?: boolean;
		danger?: boolean;
		disabled?: boolean;
	};
</script>

<script lang="ts">
	let { actions, note = null }: { actions: GoneAction[]; note?: string | null } = $props();
</script>

{#if actions.length}
	<div class="gone-actions">
		{#each actions as a (a.label)}
			<button
				class="gone-btn"
				class:strong={a.strong}
				class:danger={a.danger}
				type="button"
				disabled={a.disabled}
				onclick={() => void a.run()}
			>
				{a.label}
			</button>
		{/each}
	</div>
{/if}
{#if note}
	<p class="gone-note">{note}</p>
{/if}

<style>
	.gone-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
	}

	.gone-btn {
		height: 26px;
		padding: 0 10px;
		border: none;
		border-radius: 6px;
		background: var(--chip-bg);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 12.5px;
		cursor: pointer;
	}

	.gone-btn:hover:not(:disabled) {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.gone-btn.strong {
		color: var(--color-text-primary);
		font-weight: 600;
	}

	.gone-btn.danger {
		color: var(--error-fg);
	}

	.gone-btn:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.gone-note {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--error-fg);
	}
</style>
