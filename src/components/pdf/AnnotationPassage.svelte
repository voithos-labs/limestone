<script lang="ts">
	import { runOn, type AnnotationFields } from '#lib/pdf/annotation.js';
	import { annotationRgb } from './colors.js';
	import AnnotationCrop from './AnnotationCrop.svelte';

	/** What an annotation marks: a highlight's quote running on into its text, or a box's crop. */
	let { annotation }: { annotation: AnnotationFields } = $props();

	// a tall box narrows until it fits, so a crop never outgrows the text around it
	const CROP_MAX_HEIGHT = 320;
</script>

{#if annotation.kind !== 'highlight'}
	<AnnotationCrop {annotation} maxHeight={CROP_MAX_HEIGHT} />
{:else if annotation.quote}
	<span class="quote" style:--ann={annotationRgb(annotation)}
		><span class="mark">{annotation.quote}</span>{annotation.suffix
			? runOn(annotation.suffix)
			: ''}</span
	>
{/if}

<style>
	.quote {
		display: block;
		font-family: var(--font-editor);
		font-size: 0.9375em;
		line-height: 1.55;
		color: var(--color-text-primary);
		text-wrap: pretty;
	}

	.mark {
		padding: 1px 0;
		border-radius: 2px;
		background: rgb(var(--ann) / 0.28);
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}
</style>
