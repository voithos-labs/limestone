import type { ViewFieldType } from '$lib/models/View.svelte';

// The list has two lanes after the title. Fields that say what a note is sit right after it as
// pills; fields that say when or how much pack to the right. A face can override the lane per
// field (config.right); this is the default when it hasn't.
const INLINE: ReadonlySet<string> = new Set(['tags', 'select', 'multiselect']);

export function listInlineByDefault(type: ViewFieldType): boolean {
	return INLINE.has(type);
}

// A value is prefixed (icon for derived, label for stateful) only where it would otherwise be
// ambiguous: pills carry their own look and "updated" is the date everyone expects.
const BARE: ReadonlySet<string> = new Set(['tags', 'select', 'multiselect', 'updated_at']);

export function listPrefixed(type: ViewFieldType): boolean {
	return !BARE.has(type);
}
