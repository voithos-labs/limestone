import { definePlugin } from 'aragonite/plugin';
import type { EditorPlugin } from 'aragonite';

/**
 * TODO(aragonite-integration/task-3): replace this no-op with the real
 * `[[wiki]]` embed plugin. It exists so the roster in `editor-plugins.ts`
 * compiles and installs under the final plugin name from the start.
 */
export function wikiEmbedPlugin(): EditorPlugin {
	return definePlugin({
		name: 'limestone-wiki-embed',
		setup() {}
	});
}
