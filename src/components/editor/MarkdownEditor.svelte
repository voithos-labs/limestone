<script lang="ts">
    import {onMount, onDestroy} from 'svelte';
    import {EditorView, keymap, placeholder as cmPlaceholder} from '@codemirror/view';
    import {EditorState} from '@codemirror/state';
    import {markdown} from '@codemirror/lang-markdown';
    import {languages} from '@codemirror/language-data';
    import {defaultKeymap, history, historyKeymap} from '@codemirror/commands';
    import {syntaxHighlighting, HighlightStyle} from '@codemirror/language';
    import {tags} from '@lezer/highlight';

    let {content = $bindable(''), onchange}: {
        content: string;
        onchange?: (value: string) => void;
    } = $props();

    let container: HTMLDivElement;
    let view: EditorView;
    let internalUpdate = false;

    const theme = EditorView.theme({
        '&': {
            height: '100%',
            fontSize: '16px',
            backgroundColor: 'transparent',
        },
        '.cm-content': {
            fontFamily: 'var(--font-ui)',
            lineHeight: '1.6',
            padding: '48px 24px',
            maxWidth: '700px',
            margin: '0 auto',
            caretColor: 'var(--color-text-primary)',
        },
        '.cm-cursor': {
            borderLeftColor: 'var(--color-text-primary)',
        },
        '.cm-scroller': {
            overflow: 'auto',
            scrollbarWidth: 'none',
        },
        '.cm-scroller::-webkit-scrollbar': {
            display: 'none',
        },
        '.cm-gutters': {
            display: 'none',
        },
        '.cm-activeLine': {
            backgroundColor: 'transparent',
        },
        '.cm-selectionBackground': {
            backgroundColor: 'rgba(255, 255, 255, 0.1) !important',
        },
        '.cm-focused .cm-selectionBackground': {
            backgroundColor: 'rgba(255, 255, 255, 0.15) !important',
        },
        '.cm-line': {
            color: 'var(--color-text-primary)',
        },
    });

    const microMonokai = HighlightStyle.define([
        { tag: tags.heading1, color: '#A6E22E', fontWeight: '700', fontSize: '1.6em' },
        { tag: tags.heading2, color: '#A6E22E', fontWeight: '600', fontSize: '1.4em' },
        { tag: tags.heading3, color: '#A6E22E', fontWeight: '600', fontSize: '1.2em' },
        { tag: [tags.heading4, tags.heading5, tags.heading6], color: '#A6E22E', fontWeight: '600' },
        { tag: tags.emphasis, color: '#66D9EF', fontStyle: 'italic' },
        { tag: tags.strong, color: '#66D9EF', fontWeight: '700' },
        { tag: tags.strikethrough, color: '#66D9EF', textDecoration: 'line-through' },
        { tag: tags.link, color: '#AE81FF' },
        { tag: tags.url, color: '#D33682' },
        { tag: tags.quote, color: '#F92672' },
        { tag: [tags.processingInstruction, tags.monospace], color: '#A6E22E' },
        { tag: tags.comment, color: '#75715E' },
        { tag: tags.list, color: '#66D9EF' },
        { tag: tags.contentSeparator, color: '#A6E22E' },
    ]);

    onMount(() => {
        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                internalUpdate = true;
                content = update.state.doc.toString();
                onchange?.(content);
                internalUpdate = false;
            }
        });

        view = new EditorView({
            state: EditorState.create({
                doc: content,
                extensions: [
                    keymap.of([...defaultKeymap, ...historyKeymap]),
                    history(),
                    markdown({codeLanguages: languages}),
                    syntaxHighlighting(microMonokai),
                    theme,
                    cmPlaceholder('Start writing...'),
                    updateListener,
                    EditorView.lineWrapping,
                ],
            }),
            parent: container,
        });
    });

    // sync external content changes into codemirror
    $effect(() => {
        if (!view || internalUpdate) return;
        const current = view.state.doc.toString();
        if (content !== current) {
            view.dispatch({
                changes: {from: 0, to: current.length, insert: content}
            });
        }
    });

    onDestroy(() => {
        view?.destroy();
    });
</script>

<div class="cm-wrapper" bind:this={container}></div>

<style>
    .cm-wrapper {
        position: relative;
        width: 100%;
        height: 100%;
    }

    .cm-wrapper::before,
    .cm-wrapper::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        height: 24px;
        pointer-events: none;
        z-index: 1;
    }

    .cm-wrapper::before {
        top: 0;
        background: linear-gradient(to bottom, var(--color-surface), transparent);
        border-radius: 8px 8px 0 0;
    }

    .cm-wrapper::after {
        bottom: 0;
        background: linear-gradient(to top, var(--color-surface), transparent);
        border-radius: 0 0 8px 8px;
    }

    .cm-wrapper :global(.cm-editor) {
        height: 100%;
        outline: none;
    }

    .cm-wrapper :global(.cm-focused) {
        outline: none;
    }
</style>
