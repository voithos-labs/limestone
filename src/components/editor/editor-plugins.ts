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
import { wikiImageEmbedsPlugin } from './wiki-image-embeds-plugin';
import type { EditorPluginEntry } from 'aragonite';

/**
 * Built once here, not per mount: aragonite registers plugins once for the whole process and
 * warns in dev if a remount hands it a new object under a name it already has. Importing the two
 * renderer paths is what pulls in katex and mermaid; the plugins ship neither.
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
	wikiImageEmbedsPlugin()
];
