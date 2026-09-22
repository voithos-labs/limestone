function parseDate(input: string | number | Date): Date | null {
	const d = input instanceof Date ? input : new Date(input);
	return isNaN(d.getTime()) ? null : d;
}

function shortTime(d: Date): string {
	return d
		.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
		.toLowerCase()
		.replace(/[\s.]/g, '');
}

// the friendly form without a time of day, for cards and other tight spots
export function formatDateCompact(input: string | number | Date | null | undefined): string {
	if (input === null || input === undefined || input === '') return '';
	const m = typeof input === 'string' ? input.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
	const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : parseDate(input);
	if (!d) return String(input);
	const now = new Date();
	if (d.toDateString() === now.toDateString()) return 'Today';
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
	const sameYear = d.getFullYear() === now.getFullYear();
	if (sameYear) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateFriendly(input: string | number | Date | null | undefined): string {
	if (input === null || input === undefined || input === '') return '';
	const d = parseDate(input);
	if (!d) return String(input);

	const now = new Date();
	const ms = now.getTime() - d.getTime();
	const sec = Math.floor(ms / 1000);
	const min = Math.floor(sec / 60);
	const hr = Math.floor(min / 60);

	if (sec < 45) return 'just now';
	if (min < 60) return `${min}m ago`;

	const sameDay = d.toDateString() === now.toDateString();
	if (sameDay) return `Today ${shortTime(d)}`;

	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${shortTime(d)}`;

	const days = Math.floor(hr / 24);
	if (days < 7) {
		const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
		return `${weekday} ${shortTime(d)}`;
	}

	const sameYear = d.getFullYear() === now.getFullYear();
	if (sameYear) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format a view date
 */
export function formatViewDate(input: string | null | undefined): string {
	if (input === null || input === undefined || input === '') return '';
	const m = String(input).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
	if (!m) return String(input);
	const [, y, mo, d, hh, mm] = m;
	// Construct as local time so no UTC shift is applied
	const date = new Date(+y, +mo - 1, +d, hh ? +hh : 0, mm ? +mm : 0);
	if (isNaN(date.getTime())) return String(input);

	const now = new Date();
	const sameYear = date.getFullYear() === now.getFullYear();
	const datePart = sameYear
		? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
		: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

	if (hh === undefined) return datePart;
	return `${datePart}, ${shortTime(date)}`;
}

export function formatDateISO(input: string | number | Date | null | undefined): string {
	if (input === null || input === undefined || input === '') return '';
	const d = parseDate(input);
	if (!d) return String(input);
	return d
		.toISOString()
		.replace('T', ' ')
		.replace(/\.\d{3}Z$/, ' UTC');
}

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

export function toWallClock(input: string | number | Date): string | null {
	if (input === '' || input === null || input === undefined) return null;
	const d = parseDate(input);
	if (!d) return null;
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// a filter value may name a day relative to now: today, tomorrow, yesterday, today+N, today-N
const RELATIVE_RE = /^(today|tomorrow|yesterday)(?:([+-])(\d+))?$/;

export function isRelativeDate(value: unknown): value is string {
	return typeof value === 'string' && RELATIVE_RE.test(value.trim().toLowerCase());
}

export function resolveRelativeDate(value: unknown, now = new Date()): string | null {
	if (typeof value !== 'string') return null;
	const m = value.trim().toLowerCase().match(RELATIVE_RE);
	if (!m) return null;
	const base = m[1] === 'tomorrow' ? 1 : m[1] === 'yesterday' ? -1 : 0;
	const offset = m[2] ? (m[2] === '-' ? -1 : 1) * +m[3] : 0;
	const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + base + offset);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function wallClockToMs(value: unknown): number | null {
	if (typeof value === 'number') return value;
	if (typeof value !== 'string' || !value) return null;
	const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
	if (m) {
		const [, y, mo, d, hh, mm] = m;
		const date = new Date(+y, +mo - 1, +d, hh ? +hh : 0, mm ? +mm : 0);
		return isNaN(date.getTime()) ? null : date.getTime();
	}
	const d = new Date(value);
	return isNaN(d.getTime()) ? null : d.getTime();
}
