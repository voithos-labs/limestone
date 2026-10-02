<script lang="ts">
	import { untrack } from 'svelte';
	import type Session from '$lib/models/Session.svelte.js';
	import type EditorState from '$lib/models/EditorState.svelte.js';
	import { TabState } from '$lib/models/EditorState.svelte.js';
	import HomePage from './pages/HomePage.svelte';
	import SettingsPage from './pages/SettingsPage.svelte';
	import ViewPage from './pages/ViewPage.svelte';
	import FolderPage from './pages/FolderPage.svelte';
	import ProjectSetup from './pages/ProjectSetup.svelte';
	import LicensesPage from './pages/LicensesPage.svelte';
	import DocumentEditor from './editor/DocumentEditor.svelte';

	let {
		editor,
		session,
		addSourceSignal,
		onAddSource
	}: {
		editor: EditorState;
		session: Session;
		addSourceSignal: number;
		onAddSource: () => void;
	} = $props();

	const tab = $derived(editor.focusedTab);
	const active = $derived(session.active === editor);
	const flush = $derived(editor !== session.editors[0] && !!tab && tab === editor.tabs[0]);
	let el: HTMLElement | undefined = $state();
	let docEditor: DocumentEditor | undefined = $state();
	let focusSeen = 0;

	$effect(() => {
		const signal = session.focusSignal;
		if (signal === focusSeen) return;
		focusSeen = signal;
		if (!active || !el || el.contains(document.activeElement)) return;
		(document.activeElement as HTMLElement | null)?.blur();
		untrack(() => void docEditor?.focusCaret());
	});
</script>

<main
	class="content-area"
	class:active
	class:flush
	bind:this={el}
	onpointerdowncapture={() => session.activate(editor)}
	onfocusin={() => session.activate(editor)}
>
	{#if tab}
		{#key `${tab.id}:${TabState.idOf(tab.content)}`}
			{#if tab.content.type === 'view' && tab.content.view.unit?.startsWith('folder:') && tab.content.view.temporary}
				<FolderPage view={tab.content.view} {tab} {editor} settings={session.settings} />
			{:else if tab.content.type === 'view'}
				<ViewPage view={tab.content.view} {tab} {editor} settings={session.settings} />
			{:else if tab.content.type === 'markdown'}
				<DocumentEditor bind:this={docEditor} {tab} {editor} settings={session.settings} />
			{:else if tab.content.type === 'home'}
				<HomePage {editor} {onAddSource} />
			{:else if tab.content.type === 'new'}
				<ProjectSetup {tab} {editor} />
			{:else if tab.content.type === 'licenses'}
				<LicensesPage {tab} />
			{/if}
		{/key}
	{:else if editor.focused?.kind === 'settings'}
		<SettingsPage viewTab={session.getViewTab('settings')} {session} {addSourceSignal} />
	{:else}
		<div class="panel-placeholder">No document selected</div>
	{/if}
</main>

<style>
	.content-area {
		position: relative;
		min-width: 0;
		margin: 0 3px 12px;
		background: var(--color-surface);
		border-radius: 8px;
		overflow: hidden;
	}

	.content-area:first-of-type {
		margin-left: 12px;
	}

	.content-area:last-of-type {
		margin-right: 12px;
	}

	.content-area.flush {
		border-top-left-radius: 0;
	}

	.panel-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-ui-muted);
		font-size: 14px;
		text-transform: capitalize;
	}
</style>
