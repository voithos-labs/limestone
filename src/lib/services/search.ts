import { invoke } from '@tauri-apps/api/core';
import { select } from '$lib/services/db';
import type { SearchResult } from '$lib/types/SearchResult';

// Ranking constants, tuned by bench (d070d231): title fuzzy quality blended with
// bm25-saturated body relevance, boosted by recency.
const MAX_RESULTS = 100;
const FUZZY_THRESHOLD = 2;
const FTS_MIN_CHARS = 5;
const FTS_CANDIDATE_POOL = 25;
const HYBRID_QUALITY_GATE = 0.5;
const BM25_SATURATION = 5.0;
const BODY_QUALITY_CAP = 0.9;
const PHRASE_BONUS = 0.15;
const PHRASE_QUALITY_CAP = 0.95;
const RECENCY_WEIGHT = 0.5;
const RECENCY_SCALE_DAYS = 7;
const RECENCY_DEFAULT_DAYS = 365;
const CONTAINER_PREFIX_MIN_CHARS = 3;
const CONTAINER_MAX_RESULTS = 5;

export const SNIPPET_MARK_START = String.fromCharCode(1);
export const SNIPPET_MARK_END = String.fromCharCode(2);

// The view's scope, as the compiled filter predicate `getMembers` uses (aliased on
// `documents AS d`). When given, results are restricted to and ranked within that scope,
// documents only; omit it for a library-wide quick search that includes containers.
export interface SearchScope {
	sql: string;
	params: unknown[];
}

interface TitleMatch {
	id: string;
	title: string;
	rel_path: string | null;
	source_id: string | null;
	accessed_at: number | null;
	quality: number;
	match_indices: number[];
}

interface DocRow {
	id: string;
	title: string;
	rel_path: string | null;
	source_id: string | null;
	accessed_at: number | null;
}

interface FtsRow extends DocRow {
	snippet: string;
	bm25: number;
}

export async function searchDocuments(query: string, scope?: SearchScope): Promise<SearchResult[]> {
	const q = query.trim();
	const docs =
		q.length === 0
			? await recents(scope)
			: q.length <= FUZZY_THRESHOLD
				? await prefix(q, scope)
				: await hybrid(query, q, scope);
	if (scope) return docs;

	const containers = await containerMatches(q);
	return [...containers, ...docs];
}

function scoped(scope?: SearchScope): { and: string; params: unknown[] } {
	return scope?.sql
		? { and: ` AND (${scope.sql})`, params: scope.params }
		: { and: '', params: [] };
}

function docResult(row: DocRow): SearchResult {
	return {
		id: row.id,
		title: row.title,
		rel_path: row.rel_path,
		source_id: row.source_id,
		score: 0,
		match_indices: [],
		kind: 'document',
		group_type: null,
		snippet: null
	};
}

async function recents(scope?: SearchScope): Promise<SearchResult[]> {
	const s = scoped(scope);
	const docs = await select<DocRow>(
		`SELECT id, title, rel_path, source_id, accessed_at FROM documents d
		 WHERE d.deleted_at IS NULL${s.and} ORDER BY accessed_at DESC LIMIT ?`,
		[...s.params, MAX_RESULTS]
	);
	if (scope) return docs.map(docResult);

	const groups = await select<{
		id: string;
		slug: string;
		group_type: string;
		source_id: string | null;
		accessed_at: number;
	}>(
		'SELECT id, slug, group_type, source_id, accessed_at FROM groups ORDER BY accessed_at DESC LIMIT ?',
		[MAX_RESULTS]
	);
	const sources = await select<{ id: string; title: string; accessed_at: number }>(
		'SELECT id, title, accessed_at FROM sources ORDER BY accessed_at DESC LIMIT ?',
		[MAX_RESULTS]
	);

	const merged: { at: number; result: SearchResult }[] = [
		...docs.map((d) => ({ at: d.accessed_at ?? 0, result: docResult(d) })),
		...groups.map((g) => ({
			at: g.accessed_at ?? 0,
			result: container(g.id, g.slug, 'group', 0, g.group_type, g.source_id)
		})),
		...sources.map((v) => ({
			at: v.accessed_at ?? 0,
			result: container(v.id, v.title, 'source', 0)
		}))
	];
	merged.sort((a, b) => b.at - a.at);
	return merged.slice(0, MAX_RESULTS).map((m) => m.result);
}

async function prefix(q: string, scope?: SearchScope): Promise<SearchResult[]> {
	const s = scoped(scope);
	const docs = await select<DocRow>(
		`SELECT id, title, rel_path, source_id, accessed_at FROM documents d
		 WHERE d.deleted_at IS NULL AND instr(lower(d.title), ?) > 0${s.and} LIMIT ?`,
		[q.toLowerCase(), ...s.params, MAX_RESULTS]
	);
	return docs.map(docResult);
}

function ftsMatchQuery(query: string): string | null {
	const terms = query.split(/\s+/).filter(Boolean);
	if (terms.length === 0) return null;
	const out = terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(' ');
	return /\s$/.test(query) ? out : out + '*';
}

function ftsPhraseQuery(query: string): string | null {
	const terms = query.split(/\s+/).filter(Boolean);
	if (terms.length < 2) return null;
	const out = `"${terms.join(' ').replaceAll('"', '""')}"`;
	return /\s$/.test(query) ? out : out + '*';
}

async function ftsPass(match: string | null, scope?: SearchScope): Promise<FtsRow[]> {
	if (!match) return [];
	const s = scoped(scope);
	try {
		return await select<FtsRow>(
			`SELECT d.id, d.title, d.rel_path, d.source_id, d.accessed_at,
			        snippet(documents_fts, 1, ?, ?, '…', 16) AS snippet, bm25(documents_fts) AS bm25
			 FROM documents_fts JOIN documents d ON d.rowid = documents_fts.rowid
			 WHERE documents_fts MATCH ? AND d.deleted_at IS NULL${s.and}
			 ORDER BY bm25(documents_fts) LIMIT ?`,
			[SNIPPET_MARK_START, SNIPPET_MARK_END, match, ...s.params, FTS_CANDIDATE_POOL]
		);
	} catch {
		return [];
	}
}

// Re-center the raw FTS snippet on its match and collapse whitespace.
function tidySnippet(raw: string): string {
	const start = raw.indexOf(SNIPPET_MARK_START);
	const firstMark = start < 0 ? 0 : start;
	const end = raw.lastIndexOf(SNIPPET_MARK_END);
	const lastMark = end < 0 ? raw.length : end + 1;

	const nlBefore = raw.lastIndexOf('\n', firstMark);
	const begin = nlBefore < 0 ? 0 : nlBefore + 1;
	const nlAfter = raw.indexOf('\n', lastMark);
	const stop = nlAfter < 0 ? raw.length : nlAfter;

	return raw.slice(begin, stop).split(/\s+/).filter(Boolean).join(' ');
}

interface Candidate {
	result: SearchResult;
	quality: number;
	strong: boolean;
	accessedAt: number | null;
}

async function hybrid(
	query: string,
	trimmed: string,
	scope?: SearchScope
): Promise<SearchResult[]> {
	const runFts = trimmed.length >= FTS_MIN_CHARS;
	const [titleMatches, matchRows, phraseRows] = await Promise.all([
		invoke<TitleMatch[]>('fuzzy_match_titles', { query: trimmed, scope: scope ?? null }),
		runFts ? ftsPass(ftsMatchQuery(query), scope) : [],
		runFts ? ftsPass(ftsPhraseQuery(query), scope) : []
	]);

	const candidates = new Map<string, Candidate>();
	for (const m of titleMatches) {
		if (m.quality <= 0) continue;
		const result = docResult(m);
		result.match_indices = m.match_indices;
		candidates.set(m.id, {
			result,
			quality: m.quality,
			strong: m.quality >= HYBRID_QUALITY_GATE,
			accessedAt: m.accessed_at
		});
	}

	const passes: [FtsRow[], number, number][] = [
		[matchRows, 0, BODY_QUALITY_CAP],
		[phraseRows, PHRASE_BONUS, PHRASE_QUALITY_CAP]
	];
	for (const [rows, bonus, cap] of passes) {
		for (const row of rows) {
			const relevance = Math.max(-row.bm25, 0);
			const base = (BODY_QUALITY_CAP * relevance) / (relevance + BM25_SATURATION);
			const existing = candidates.get(row.id);
			if (existing) {
				existing.strong = true;
				const quality = Math.min(Math.max(existing.quality, base) + bonus, cap);
				if (quality > existing.quality) {
					existing.quality = quality;
					existing.result.snippet = tidySnippet(row.snippet);
				}
			} else {
				const result = docResult(row);
				result.snippet = tidySnippet(row.snippet);
				candidates.set(row.id, {
					result,
					quality: Math.min(base + bonus, cap),
					strong: true,
					accessedAt: row.accessed_at
				});
			}
		}
	}

	const now = Date.now();
	const strong: Candidate[] = [];
	const weak: Candidate[] = [];
	for (const c of candidates.values()) {
		const days =
			c.accessedAt != null ? Math.max(now - c.accessedAt, 0) / 86_400_000 : RECENCY_DEFAULT_DAYS;
		const boost = 1 + RECENCY_WEIGHT / (1 + days / RECENCY_SCALE_DAYS);
		c.result.score = c.quality * boost;
		(c.strong ? strong : weak).push(c);
	}

	const byScore = (a: Candidate, b: Candidate) =>
		b.result.score - a.result.score || a.result.title.localeCompare(b.result.title);
	strong.sort(byScore);
	weak.sort(byScore);

	return [
		...strong.slice(0, MAX_RESULTS),
		...weak.slice(0, Math.max(MAX_RESULTS - strong.length, 0))
	].map((c) => {
		// FTS-matched cards preview the body snippet; suppress the title highlight there.
		if (c.result.snippet) c.result.match_indices = [];
		return c.result;
	});
}

function container(
	id: string,
	title: string,
	kind: 'group' | 'source',
	matchLen: number,
	groupType: string | null = null,
	sourceId: string | null = null
): SearchResult {
	return {
		id,
		title,
		rel_path: null,
		source_id: sourceId,
		score: 0,
		match_indices: Array.from({ length: matchLen }, (_, i) => i),
		kind,
		group_type: groupType,
		snippet: null
	};
}

async function containerMatches(q: string): Promise<SearchResult[]> {
	if (q.length < CONTAINER_PREFIX_MIN_CHARS) return [];
	const like = q.toLowerCase() + '%';
	const matchLen = [...q].length;
	const sources = await select<{ id: string; title: string }>(
		'SELECT id, title FROM sources WHERE lower(title) LIKE ? ORDER BY length(title) ASC, title ASC LIMIT ?',
		[like, CONTAINER_MAX_RESULTS]
	);
	const groups = await select<{
		id: string;
		slug: string;
		group_type: string;
		source_id: string | null;
	}>(
		'SELECT id, slug, group_type, source_id FROM groups WHERE lower(slug) LIKE ? ORDER BY length(slug) ASC, slug ASC LIMIT ?',
		[like, CONTAINER_MAX_RESULTS]
	);
	return [
		...sources.map((s) => container(s.id, s.title, 'source', matchLen)),
		...groups.map((g) => container(g.id, g.slug, 'group', matchLen, g.group_type, g.source_id))
	];
}
