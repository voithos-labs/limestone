import { toasts } from './toasts.svelte';

export function errorKind(e: unknown): string {
	const kind = (e as { kind?: unknown } | null)?.kind;
	return typeof kind === 'string' ? kind : 'other';
}

export function describeError(e: unknown, fallback: string): string {
	const name = (e as { name?: unknown } | null)?.name;
	const named = typeof name === 'string' && !(e instanceof Error) ? name : null;
	switch (errorKind(e)) {
		case 'source_missing':
			return 'The source folder is unavailable. Check that the drive or folder is connected.';
		case 'not_found':
			return "The file couldn't be found. It may have been moved or deleted outside Limestone.";
		case 'permission':
			return "The file is read-only or you don't have permission to change it.";
		case 'locked':
			return 'The file is open in another app. Close it there and try again.';
		case 'no_space':
			return 'Your disk is out of space.';
		case 'already_exists':
			return named ? `Something named "${named}" is already there.` : 'The name is already taken.';
		case 'invalid_name':
			return named ? `"${named}" can't be used as a name.` : "The name can't be used.";
		case 'no_metadata':
			return "This folder keeps metadata out of its files, so that can't be saved here.";
		case 'invalid_data':
			return "The file isn't readable as text.";
		default:
			return fallback;
	}
}

const RETRYABLE = new Set(['source_missing', 'locked', 'no_space', 'other']);

export function isRetryable(e: unknown): boolean {
	return RETRYABLE.has(errorKind(e));
}

export function splitMessage(message: string): [string, string | null] {
	const m = /^((?:"[^"]*"|<[^<>]*>|[^"<])+?)(?:: |\. )(.+)$/s.exec(message);
	if (!m) return [message, null];
	return [m[1], m[2][0].toUpperCase() + m[2].slice(1)];
}

export type ReportError = (e: unknown, fallback: string, retry?: () => unknown) => void;

export function reportError(
	e: unknown,
	fallback: string,
	retry?: () => unknown,
	describe = describeError
): void {
	console.error(fallback, e);
	const action = retry && isRetryable(e) ? { label: 'Retry', run: () => void retry() } : undefined;
	const reason = describe(e, '');
	toasts.push(reason ? `${fallback.replace(/\.$/, '')}: ${reason}` : fallback, { action });
}
