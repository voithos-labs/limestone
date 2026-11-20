<script lang="ts">
	/**
	 * the notices under a note's header: its file is gone but the text is still held here, or a
	 * save or delete didn't work.
	 *
	 * Each is a card with the cat, what happened, and the actions for it. The note editor decides
	 * when they show and what they say; this only draws them.
	 */

	import GoneActions, { type GoneAction } from '../pages/GoneActions.svelte';

	let {
		notice,
		unavailable,
		problem,
		goneActions,
		restoreNote,
		problemActions
	}: {
		/** What the gone page would say, shown as a card while the editor still holds the text. */
		notice: { headline: string; detail: string } | null;
		unavailable: { held: string | null; settled: boolean } | null;
		/** A save or delete that failed, and what to do about it. */
		problem: { title: string; detail: string | null } | null;
		goneActions: GoneAction[];
		restoreNote: string | null;
		problemActions: GoneAction[];
	} = $props();

	const BANG = '<!>';
	const CAT_FACE = ' /\\_/\\\n( o.o )';
</script>

{#if notice && unavailable?.held != null && unavailable.settled}
	<div class="held-notice">
		<pre class="held-cat" aria-hidden="true">{CAT_FACE}</pre>
		<div class="held-text">
			<p class="ua-headline">{notice.headline} {BANG}</p>
			<p class="ua-detail">{notice.detail}</p>
		</div>
		<GoneActions actions={goneActions} note={restoreNote} />
	</div>
{/if}
{#if problem}
	<div class="held-notice">
		<pre class="held-cat" aria-hidden="true">{CAT_FACE}</pre>
		<div class="held-text">
			<p class="ua-headline">{problem.title} {BANG}</p>
			{#if problem.detail}<p class="ua-detail">{problem.detail}</p>{/if}
		</div>
		<GoneActions actions={problemActions} />
	</div>
{/if}

<style>
	.ua-headline {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.ua-detail {
		max-width: 360px;
		margin: 0;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.45;
		color: var(--color-ui-dulled);
	}

	.held-notice {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 16px;
		max-width: calc(var(--page-max-width, 1200px) - 48px);
		margin: 0 auto 16px;
		width: calc(100% - 48px);
		padding: 12px 14px;
		border-radius: 8px;
		background: var(--chip-bg);
	}

	.held-cat {
		flex-shrink: 0;
		margin: 0;
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.2;
		color: var(--color-ui-dulled);
		user-select: none;
	}

	.held-notice + .held-notice {
		margin-top: -8px;
	}

	.held-text {
		display: flex;
		flex: 1 1 240px;
		flex-direction: column;
		gap: 3px;
	}

	.held-notice :global(.gone-actions) {
		justify-content: flex-start;
	}

	.held-notice .ua-detail {
		max-width: none;
	}
</style>
