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
import { wikiEmbedPlugin, type WikiEmbedOptions } from './wiki-embed-plugin';
import type { EditorPluginEntry } from 'aragonite';

/**
 * The plugin units every limestone editor mounts with. Built once at module scope, not
 * per mount: aragonite installs plugin definitions process-globally and dev-warns when
 * a remount hands it a fresh object under a name already installed.
 *
 * The math and diagram engines are injected rather than bundled by the plugins —
 * importing the two renderer subpaths is what opts limestone into `katex` and
 * `mermaid`.
 */
const BUNDLED_PLUGINS = [
	admonitionsPlugin(),
	detailsPlugin(),
	emojiPlugin(),
	footnotesPlugin(),
	latexPlugin({ renderer: katexRenderer }),
	mermaidPlugin({ renderer: mermaidRenderer }),
	tocPlugin(),
	highlightOccurrencesPlugin()
];

const WIKI_EMBED = wikiEmbedPlugin();

/**
 * The `plugins` prop for one editor: a fresh array per mount over those same units.
 * Installation is process-global and happens once; the wiki-embed resolver is not —
 * an embed resolves against the assets of the document's own source.
 */
export function editorPlugins(wikiEmbed: WikiEmbedOptions): readonly EditorPluginEntry[] {
	return [...BUNDLED_PLUGINS, { plugin: WIKI_EMBED, options: wikiEmbed }];
}
