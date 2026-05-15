import type { Component } from 'svelte';
import {
	Type,
	Hash,
	Calendar,
	SquareCheck,
	CircleDot,
	Tags,
	Heading1,
	Fingerprint,
	Database,
	Blend,
	Route,
	CalendarPlus2,
	CalendarClock,
	Filter
} from '@lucide/svelte';
import { VIEW_FIELD_OPS, type ViewFieldType } from '$lib/models/View';

export interface OpOption {
	value: string;
	label: string;
}

export const FIELD_TYPE_ICONS: Record<ViewFieldType, Component> = {
	text: Type,
	number: Hash,
	date: Calendar,
	boolean: SquareCheck,
	select: CircleDot,
	multiselect: Tags,
	title: Heading1,
	id: Fingerprint,
	source: Database,
	groups: Blend,
	path: Route,
	created_at: CalendarPlus2,
	updated_at: CalendarClock
};

export const FALLBACK_FIELD_ICON: Component = Filter;

export function getFieldIcon(type: ViewFieldType | undefined): Component {
	if (!type) return FALLBACK_FIELD_ICON;
	return FIELD_TYPE_ICONS[type] ?? FALLBACK_FIELD_ICON;
}

export const OP_LABELS: Record<string, string> = {
	eq: 'is',
	neq: 'is not',
	contains: 'contains',
	not_contains: 'does not contain',
	starts_with: 'starts with',
	is_empty: 'is empty',
	is_not_empty: 'is not empty',
	gt: '>',
	gte: '≥',
	lt: '<',
	lte: '≤',
	before: 'before',
	on_or_before: 'on or before',
	after: 'after',
	on_or_after: 'on or after'
};

export function getOpLabel(op: string): string {
	return OP_LABELS[op] ?? op;
}

export function opHasValue(op: string): boolean {
	return op !== 'is_empty' && op !== 'is_not_empty';
}

export function opsFor(type: ViewFieldType | undefined): OpOption[] {
	if (!type) return [];
	const ops = VIEW_FIELD_OPS[type] ?? [];
	return ops.map((o) => ({ value: o, label: getOpLabel(o) }));
}

export function formatFilterValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) return value.map((v) => formatFilterValue(v)).join(', ');
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
