import { admonitionsPlugin } from '@voithos-labs/aragonite/plugins/admonitions';
import { detailsPlugin } from '@voithos-labs/aragonite/plugins/details';
import { emojiPlugin } from '@voithos-labs/aragonite/plugins/emoji';
import { footnotesPlugin } from '@voithos-labs/aragonite/plugins/footnotes';
import { latexPlugin } from '@voithos-labs/aragonite/plugins/latex';
import { katexRenderer } from '@voithos-labs/aragonite/plugins/latex/renderer';
import { mermaidPlugin } from '@voithos-labs/aragonite/plugins/mermaid';
import { mermaidRenderer } from '@voithos-labs/aragonite/plugins/mermaid/renderer';
import { tocPlugin } from '@voithos-labs/aragonite/plugins/toc';
import { wikiImageEmbedsPlugin } from './wiki-image-embeds-plugin';
import type { EditorPluginEntry } from '@voithos-labs/aragonite';

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
	wikiImageEmbedsPlugin()
];
