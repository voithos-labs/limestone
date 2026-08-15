<script lang="ts">
	import { SlidersHorizontal, ExternalLink, Star, Trash2, TriangleAlert } from '@lucide/svelte';
	import Menu from './views/Menu.svelte';
	import type { MenuEntry } from '$lib/views/menuTypes';
	import type { Source } from '$lib/models/Source';

	let {
		open = $bindable(false),
		anchor,
		source,
		defaultSourceId,
		missing = false,
		minWidth = 190,
		placement,
		onConfigure,
		onReveal,
		onToggleDefault,
		onRemove
	}: {
		open?: boolean;
		anchor: HTMLElement | null;
		source: Source | null;
		defaultSourceId: string | null;
		missing?: boolean;
		minWidth?: number;
		placement?: 'bottom' | 'right';
		onConfigure: (s: Source) => void;
		onReveal: (s: Source) => void;
		onToggleDefault: (s: Source) => void;
		onRemove: (s: Source) => void;
	} = $props();

	let confirmingRemove = $state(false);

	$effect(() => {
		if (!open) confirmingRemove = false;
	});

	const items: MenuEntry[] = $derived([
		{ value: 'edit', label: 'Configure', icon: SlidersHorizontal },
		{ value: 'reveal', label: 'Reveal in file manager', icon: ExternalLink },
		{
			value: 'default',
			label: source?.id === defaultSourceId ? 'Remove default' : 'Set as default',
			icon: Star
		},
		{ kind: 'divider' },
		confirmingRemove
			? { value: 'confirm-remove', label: 'Confirm remove', icon: Trash2, danger: true }
			: { value: 'remove', label: 'Remove', icon: Trash2, keepOpen: true }
	]);

	function onSelect(value: string) {
		if (value === 'remove') {
			confirmingRemove = true;
			return;
		}
		open = false;
		const s = source;
		if (!s) return;
		if (value === 'edit') onConfigure(s);
		else if (value === 'reveal') onReveal(s);
		else if (value === 'default') onToggleDefault(s);
		else if (value === 'confirm-remove') onRemove(s);
	}
</script>

{#snippet unavailableHeader()}
	<span
		class="unavailable-note"
		title="Folder could not be found at {source?.path}. Was the drive it's on removed?"
	>
		<TriangleAlert size={13} strokeWidth={1.75} />
		Source folder unavailable
	</span>
{/snippet}

<Menu
	bind:open
	{anchor}
	{items}
	{onSelect}
	{minWidth}
	{placement}
	header={missing ? unavailableHeader : undefined}
/>

<style>
	.unavailable-note {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 4px;
		font-size: 12px;
		color: var(--color-ui-muted);
		cursor: help;
	}

	.unavailable-note :global(svg) {
		flex-shrink: 0;
	}
</style>
