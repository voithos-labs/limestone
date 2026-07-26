import { admonitionsPlugin } from 'aragonite/plugins/admonitions';
import { detailsPlugin } from 'aragonite/plugins/details';
import { emojiPlugin } from 'aragonite/plugins/emoji';
import { footnotesPlugin } from 'aragonite/plugins/footnotes';
import { latexPlugin } from 'aragonite/plugins/latex';
import { katexRenderer } from 'aragonite/plugins/latex/renderer';
import { mermaidPlugin } from 'aragonite/plugins/mermaid';
import { mermaidRenderer } from 'aragonite/plugins/mermaid/renderer';
import { tocPlugin } from 'aragonite/plugins/toc';
import { highlightOccurrencesPlugin } from 'aragonite/plugins/highlight-occurrences';
import { wikiEmbedPlugin } from './wiki-embed-plugin';
import type { EditorPluginEntry } from 'aragonite';

/**
 * The plugin roster every limestone editor mounts with. Built once at module scope, not
 * per mount: aragonite installs plugin definitions process-globally and dev-warns when
 * a remount hands it a fresh object under a name already installed.
 *
 * The math and diagram engines are injected rather than bundled by the plugins —
 * importing the two renderer subpaths is what opts limestone into `katex` and
 * `mermaid`.
 */
export const EDITOR_PLUGINS: readonly EditorPluginEntry[] = [
	admonitionsPlugin(),
	detailsPlugin(),
	emojiPlugin(),
	footnotesPlugin(),
	latexPlugin({ renderer: katexRenderer }),
	mermaidPlugin({ renderer: mermaidRenderer }),
	tocPlugin(),
	highlightOccurrencesPlugin(),
	wikiEmbedPlugin()
];
