<script lang="ts">
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { importGlobalAsset, importGlobalAssetBytes } from '$lib/services/assets';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { ImageUp, FolderOpen } from '@lucide/svelte';

	let {
		open = $bindable(false),
		onPicked
	}: {
		open: boolean;
		onPicked: (ref: string) => void;
	} = $props();

	const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'];

	let dragOver = $state(false);
	let busy = $state(false);
	let error = $state('');

	function extOfMime(m: string): string {
		if (m === 'image/jpeg') return 'jpg';
		if (m === 'image/svg+xml') return 'svg';
		return m.split('/')[1] || 'png';
	}

	function finish(ref: string) {
		busy = false;
		onPicked(ref);
		open = false;
	}

	async function importBlob(blob: Blob, name?: string) {
		busy = true;
		error = '';
		try {
			const buf = await blob.arrayBuffer();
			const ext = name?.split('.').pop()?.toLowerCase() || extOfMime(blob.type);
			finish(await importGlobalAssetBytes(buf, ext));
		} catch (e) {
			error = String(e);
			busy = false;
		}
	}

	async function importPath(path: string) {
		busy = true;
		error = '';
		try {
			finish(await importGlobalAsset(path));
		} catch (e) {
			error = String(e);
			busy = false;
		}
	}

	async function openFile() {
		const sel = await openDialog({
			multiple: false,
			filters: [{ name: 'Images', extensions: IMAGE_EXTS }]
		});
		if (typeof sel === 'string') importPath(sel);
	}

	function onPaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const it of Array.from(items)) {
			if (it.type.startsWith('image/')) {
				const f = it.getAsFile();
				if (f) {
					e.preventDefault();
					importBlob(f);
					return;
				}
			}
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}

	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			wasOpen = true;
			error = '';
			busy = false;
			dragOver = false;
			window.addEventListener('paste', onPaste);
			window.addEventListener('keydown', onKey);
			let un: (() => void) | undefined;
			getCurrentWebview()
				.onDragDropEvent((ev) => {
					if (!open) return;
					const payload = ev.payload;
					if (payload.type === 'enter' || payload.type === 'over') {
						dragOver = true;
					} else if (payload.type === 'leave') {
						dragOver = false;
					} else if (payload.type === 'drop') {
						dragOver = false;
						const p = payload.paths?.[0];
						if (p) importPath(p);
					}
				})
				.then((f) => {
					un = f;
				});
			return () => {
				window.removeEventListener('paste', onPaste);
				window.removeEventListener('keydown', onKey);
				un?.();
			};
		}
		if (!open) wasOpen = false;
	});
</script>

{#if open}
	<div class="overlay" onclick={() => (open = false)} onkeydown={onKey} role="presentation">
		<div
			class="dialog"
			class:drag={dragOver}
			onclick={(e) => e.stopPropagation()}
			onkeydown={onKey}
			role="dialog"
			tabindex="-1"
		>
			<h3 class="title">Add cover</h3>

			<div class="drop">
				<ImageUp size={24} />
				<p class="hint">Drag an image here, or paste from clipboard</p>
				<button class="open-btn" type="button" onclick={openFile} disabled={busy}>
					<FolderOpen size={14} />
					<span>Choose file</span>
				</button>
			</div>

			{#if error}<p class="err">{error}</p>{/if}
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
		background: var(--color-bg-opaque, var(--color-bg));
		border: 1px solid var(--color-border);
		border-radius: 12px;
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
	}

	.title {
		margin: 0 0 14px;
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 28px 16px;
		border: 1px dashed var(--color-border);
		border-radius: 10px;
		color: var(--color-ui-muted);
		transition:
			border-color 120ms ease,
			background-color 120ms ease;
	}

	.dialog.drag .drop {
		border-color: var(--color-accent);
		background: var(--chip-bg);
	}

	.hint {
		margin: 0;
		font-size: 13px;
		text-align: center;
	}

	.open-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 13px;
		cursor: pointer;
	}

	.open-btn:hover {
		color: var(--color-text-primary);
	}

	.err {
		margin: 12px 0 0;
		font-size: 12px;
		color: var(--color-accent);
	}
</style>
