<script lang="ts">
	import { untrack } from 'svelte';
	import ScrollThumb from '../ScrollThumb.svelte';
	import { Search, ChevronRight, ExternalLink } from '@lucide/svelte';
	import type { TabState } from '$lib/models/EditorState.svelte.js';
	import { openUrl } from '@tauri-apps/plugin-opener';

	interface NoticeComponent {
		ecosystem: 'rust' | 'npm';
		name: string;
		version: string;
		license: string | null;
		source: string | null;
		copyrights: string[];
		texts: string[];
	}

	interface NoticeText {
		labels: string[];
		body: string;
	}

	interface Notices {
		counts: { rust: number; npm: number; texts: number };
		components: NoticeComponent[];
		texts: Record<string, NoticeText>;
	}

	let { tab }: { tab?: TabState } = $props();

	let notices: Notices | null = $state(null);
	let loadError = $state('');
	let query: string = $state(untrack(() => tab?.state?.query ?? ''));
	let expanded: string | null = $state(null);
	let bodyEl: HTMLElement | null = $state(null);

	$effect(() => {
		if (tab) tab.state.query = query;
	});

	$effect(() => {
		if (notices || loadError) return;
		void (async () => {
			try {
				const res = await fetch('/third-party-notices.json');
				if (!res.ok) throw new Error(String(res.status));
				notices = await res.json();
			} catch {
				loadError = 'Could not load the notices file. Run `npm run notices` to generate it.';
			}
		})();
	});

	function key(c: NoticeComponent): string {
		return `${c.ecosystem}:${c.name}@${c.version}`;
	}

	let filtered = $derived.by(() => {
		const all = notices?.components ?? [];
		const q = query.trim().toLowerCase();
		if (!q) return all;
		const tokens = q.split(/\s+/);
		return all.filter((c) => {
			const hay = `${c.name} ${c.license ?? ''} ${c.ecosystem}`.toLowerCase();
			return tokens.every((t) => hay.includes(t));
		});
	});

	let rustCount = $derived(filtered.filter((c) => c.ecosystem === 'rust').length);
	let npmCount = $derived(filtered.length - rustCount);

	function toggle(c: NoticeComponent) {
		const k = key(c);
		expanded = expanded === k ? null : k;
	}

	function textsFor(c: NoticeComponent): NoticeText[] {
		return c.texts.map((id) => notices!.texts[id]).filter(Boolean);
	}

	function spdxIds(expression: string | null): string[] {
		if (!expression) return [];
		const parts = expression
			.split(/\s+(?:OR|AND|WITH)\s+|\s*\/\s*/i)
			.map((s) => s.trim().replace(/^\(|\)$/g, ''))
			.filter((s) => /^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(s));
		return [...new Set(parts)];
	}

	function spdxUrl(id: string): string {
		return `https://spdx.org/licenses/${id}.html`;
	}
</script>

<div class="licenses-page">
	<div class="scroll" bind:this={bodyEl}>
		<div class="inner">
			<!-- prettier-ignore -->
			<div class="banner">
<pre class="ascii-logo">               ,,                                                                                       ..
MMP""MM""YMM `7MM                             `7MM                                        OO             `bq
P'   MM   `7   MM                               MM                                        88               YA
     MM        MMpMMMb.   ,6"Yb.  `7MMpMMMb.    MM  ,MP'    `7M'   `MF',pW"Wq.`7MM  `7MM  ||     gp        `Mb
     MM        MM    MM  8)   MM    MM    MM    MM ;Y         VA   ,V 6W'   `Wb MM    MM  ||     ""         8M
     MM        MM    MM   ,pm9MM    MM    MM    MM;Mm          VA ,V  8M     M8 MM    MM  `'                8M
     MM        MM    MM  8M   MM    MM    MM    MM `Mb.         VVV   YA.   ,A9 MM    MM  ,,     ,,        ,M9
   .JMML.    .JMML  JMML.`Moo9^Yo..JMML  JMML..JMML. YA.        ,V     `Ybmd9'  `Mbod"YML.db     db        dM
                                                               ,V                                        .pY
                                                            OOb"                                        ''</pre>
		</div>

			<div class="title-row">
				<h1 class="title">Open source licenses</h1>
				{#if notices}
					<span class="counts">
						{notices.counts.rust} crates · {notices.counts.npm} packages
					</span>
				{/if}
			</div>
			<p class="blurb">
				Limestone incorporates the components below. Each remains the property of its owners and is
				used under the license shown.
			</p>

			<div class="search-bar">
				<div class="search">
					<Search size={14} strokeWidth={2} />
					<input
						class="search-input"
						type="text"
						placeholder="Search by name or license…"
						bind:value={query}
						spellcheck="false"
						autocomplete="off"
					/>
					{#if query}
						<button class="clear" onclick={() => (query = '')}>Clear</button>
					{/if}
				</div>
				{#if notices && query.trim()}
					<p class="result-count">
						{filtered.length}
						{filtered.length === 1 ? 'match' : 'matches'}
						{#if filtered.length}
							<span class="dim">({rustCount} rust, {npmCount} npm)</span>
						{/if}
					</p>
				{/if}
			</div>

			{#if loadError}
				<p class="empty">{loadError}</p>
			{:else if !notices}
				<p class="empty">Loading…</p>
			{:else if !filtered.length}
				<p class="empty">No components match “{query}”.</p>
			{:else}
				<ul class="list">
					{#each filtered as c (key(c))}
						{@const k = key(c)}
						{@const open = expanded === k}
						<li class="row" class:open>
							<button class="row-head" onclick={() => toggle(c)}>
								<span class="chev" class:open><ChevronRight size={13} strokeWidth={2.25} /></span>
								<span class="name">{c.name}</span>
								<span class="version">{c.version}</span>
								<span class="spacer"></span>
								<span class="license">{c.license ?? 'see source'}</span>
								<span class="eco">{c.ecosystem}</span>
							</button>
							{#if open}
								{@const ids = spdxIds(c.license)}
								<div class="detail">
									{#if c.copyrights.length}
										<div class="copyrights">
											{#each c.copyrights as line, i (i)}
												<div class="copyright">{line}</div>
											{/each}
										</div>
									{/if}
									{#if c.source?.startsWith('http')}
										<button class="source" onclick={() => openUrl(c.source!)}>
											{c.source}
											<ExternalLink size={11} strokeWidth={2.25} />
										</button>
									{/if}
									{#if ids.length}
										<div class="text-links">
											{#each ids as id (id)}
												<button class="license-link" onclick={() => openUrl(spdxUrl(id))}>
													Read {id}
													<ExternalLink size={10} strokeWidth={2.25} />
												</button>
											{/each}
										</div>
									{:else}
										{#each textsFor(c) as t, i (i)}
											<pre class="text-body">{t.body}</pre>
										{/each}
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>

	<ScrollThumb scroller={bodyEl} top={12} />
</div>

<style>
	.licenses-page {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		font-family: var(--font-ui);
	}

	.scroll {
		flex: 1;
		min-height: 0;
		padding: 0 32px 48px;
		overflow-y: auto;
		scrollbar-width: none;
	}

	.scroll::-webkit-scrollbar {
		display: none;
	}

	.inner {
		max-width: var(--page-max-width, none);
		margin: 0 auto;
	}

	.banner {
		container-type: inline-size;
		width: 100%;
		padding: 48px 0 28px;
		text-align: center;
	}

	.ascii-logo {
		display: inline-block;
		margin: 0;
		font-family: var(--font-editor, monospace);
		font-size: min(calc(100cqw / 113), 11px);
		line-height: 1.15;
		white-space: pre;
		text-align: left;
		color: var(--color-ui-muted);
	}

	.title-row {
		display: flex;
		align-items: baseline;
		gap: 12px;
	}

	.title {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.counts {
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.blurb {
		margin: 6px 0 14px;
		max-width: 68ch;
		font-size: 13px;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.search-bar {
		position: sticky;
		top: 0;
		z-index: 1;
		padding: 10px 0 8px;
		background: var(--color-surface);
	}

	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: 420px;
		padding: 7px 10px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-ui);
		color: var(--color-ui-muted);
	}

	.search:focus-within {
		border-color: var(--color-accent, var(--color-text-secondary));
	}

	.search-input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: transparent;
		font-family: inherit;
		font-size: 13px;
		color: var(--color-text-primary);
	}

	.clear {
		border: none;
		background: none;
		padding: 0;
		font-family: inherit;
		font-size: 12px;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.clear:hover {
		color: var(--color-text-primary);
	}

	.result-count {
		margin: 8px 0 0;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.dim {
		color: var(--color-ui-muted);
	}

	.empty {
		margin: 24px 0;
		font-size: 13px;
		color: var(--color-ui-muted);
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		border-bottom: 1px solid var(--color-border);
	}

	.row-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		width: 100%;
		padding: 7px 4px;
		border: none;
		background: none;
		font-family: inherit;
		font-size: 13px;
		text-align: left;
		color: var(--color-text-primary);
		cursor: pointer;
	}

	.row-head:hover {
		background: var(--color-bg-subtle, rgba(127, 127, 127, 0.06));
	}

	.chev {
		display: inline-flex;
		color: var(--color-ui-muted);
		transition: transform 120ms ease;
	}

	.chev.open {
		transform: rotate(90deg);
	}

	.name {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.spacer {
		flex: 1 1 auto;
	}

	.version,
	.eco {
		flex: none;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-ui-muted);
	}

	.eco {
		width: 3.2em;
		text-align: right;
	}

	.license {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		font-size: 11.5px;
		text-align: right;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-secondary);
	}

	.detail {
		padding: 4px 4px 16px 26px;
	}

	.copyrights {
		margin-bottom: 8px;
	}

	.copyright {
		font-size: 12px;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.source {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin-bottom: 10px;
		padding: 0;
		border: none;
		background: none;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.source:hover {
		color: var(--color-text-primary);
		text-decoration: underline;
	}

	.text-links {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
	}

	.license-link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0;
		border: none;
		background: none;
		font-family: inherit;
		font-size: 12px;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.license-link:hover {
		color: var(--color-text-primary);
		text-decoration: underline;
	}

	.text-body {
		margin: 0 0 12px;
		padding: 10px 12px;
		max-height: 320px;
		overflow: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-ui);
		font-family: var(--font-mono);
		font-size: 10.5px;
		line-height: 1.55;
		color: var(--color-text-secondary);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}
</style>
