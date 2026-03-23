import { invoke } from '@tauri-apps/api/core';

export async function select<T = Record<string, unknown>>(
	query: string,
	params: unknown[] = []
): Promise<T[]> {
	return invoke('sql_select', { query, params });
}

export async function execute(
	query: string,
	params: unknown[] = []
): Promise<{ rows_affected: number; last_insert_rowid: number }> {
	return invoke('sql_execute', { query, params });
}

/** Parse a SQLite datetime string (always UTC) into a Date */
export function parseUtc(s: string): Date {
	return new Date(s + 'Z');
}
