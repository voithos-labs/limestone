/**
 * the aragonite plugins limestone's editors run with.
 *
 * A note's editor and a pdf comment's both hand EDITOR_PLUGINS to aragonite's `plugins` prop. The
 * list is built once here, not per mount, because aragonite registers plugins once for the whole
 * app and warns in dev when a remount hands it a new object under a name it already has. The latex
 * and mermaid plugins ship without katex and mermaid, so the two renderer imports pull those in.
 */

import { admonitionsPlugin } from '@voithos-labs/aragonite/plugins/admonitions';
import { detailsPlugin } from '@voithos-labs/aragonite/plugins/details';
import { emojiPlugin } from '@voithos-labs/aragonite/plugins/emoji';
import { footnotesPlugin } from '@voithos-labs/aragonite/plugins/footnotes';
import { latexPlugin } from '@voithos-labs/aragonite/plugins/latex';
import { katexRenderer } from '@voithos-labs/aragonite/plugins/latex/renderer';
import { mermaidPlugin } from '@voithos-labs/aragonite/plugins/mermaid';
import { mermaidRenderer } from '@voithos-labs/aragonite/plugins/mermaid/renderer';
import { slashCommandsPlugin } from '@voithos-labs/aragonite/plugins/slash-commands';
import { tocPlugin } from '@voithos-labs/aragonite/plugins/toc';
import { annotationEmbedsPlugin } from './citation-embeds';
import { wikiImageEmbedsPlugin } from './image-embeds';
import { wikiLinksPlugin } from './wikilinks';
import type { EditorPluginEntry } from '@voithos-labs/aragonite';

const annotationEmbeds = annotationEmbedsPlugin();

export const EDITOR_PLUGINS: readonly EditorPluginEntry[] = [
	admonitionsPlugin(),
	detailsPlugin(),
	emojiPlugin(),
	footnotesPlugin(),
	latexPlugin({ renderer: katexRenderer }),
	mermaidPlugin({ renderer: mermaidRenderer }),
	slashCommandsPlugin(),
	tocPlugin(),
	wikiImageEmbedsPlugin(),
	annotationEmbeds,
	wikiLinksPlugin()
];

/**
 * the plugins for text inside a citation card: all of them except citation cards, so a comment
 * that cites its own annotation can't nest cards forever
 */
export const IN_CARD_PLUGINS = EDITOR_PLUGINS.filter((p) => p !== annotationEmbeds);
