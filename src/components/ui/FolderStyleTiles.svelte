<script lang="ts">
	import { FolderTree, Info, LayoutPanelTop } from '@lucide/svelte';

	let { value, onPick }: { value: string; onPick: (value: string) => void } = $props();

	const STYLES = [
		{
			value: 'show',
			label: 'Folders are cool',
			hint: 'Organise notes by folder, like on disk',
			icon: FolderTree
		},
		{
			value: 'hide',
			label: "Don't make me think about folders",
			hint: 'Tags and projects do the sorting',
			icon: LayoutPanelTop,
			info: 'This is only a user interface change. Projects are folders, this just lets you use the app and disk without thinking about it.'
		}
	];
</script>

<div class="tiles">
	{#each STYLES as t (t.value)}
		{@const Icon = t.icon}
		<button
			class="tile"
			class:picked={value === t.value}
			type="button"
			onclick={() => onPick(t.value)}
		>
			<span class="tile-icon"><Icon size={18} strokeWidth={1.5} /></span>
			{#if t.info}
				<span class="tile-info" title={t.info}><Info size={13} strokeWidth={1.75} /></span>
			{/if}
			<span class="tile-label">{t.label}</span>
			<span class="tile-hint">{t.hint}</span>
		</button>
	{/each}
</div>

<style>
	.tiles {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	.tile {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
		padding: 12px 14px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: transparent;
		font: inherit;
		text-align: left;
		color: inherit;
		cursor: pointer;
		transition:
			background-color 100ms ease,
			border-color 100ms ease;
	}

	.tile:hover {
		background: var(--chip-bg);
	}

	.tile.picked {
		border-color: var(--color-accent);
		background: var(--accent-a9);
	}

	.tile-info {
		position: absolute;
		top: 10px;
		right: 10px;
		display: inline-flex;
		color: var(--color-ui-dulled);
		cursor: help;
	}

	.tile-info:hover {
		color: var(--color-ui-muted);
	}

	.tile-icon {
		display: inline-flex;
		margin-bottom: 6px;
		color: var(--color-ui-muted);
	}

	.tile.picked .tile-icon {
		color: var(--color-accent);
	}

	.tile-label {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.tile-hint {
		font-size: 12px;
		line-height: 1.4;
		color: var(--color-ui-muted);
	}
</style>
