function parseDate(input: string | number | Date): Date | null {
	if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
	let d = new Date(input);
	if (isNaN(d.getTime()) && typeof input === 'string') {
		d = new Date(input.replace(' ', 'T') + (input.includes('Z') ? '' : 'Z'));
	}
	return isNaN(d.getTime()) ? null : d;
}

function shortTime(d: Date): string {
	return d
		.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
		.toLowerCase()
		.replace(/[\s.]/g, '');
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

// SQL datetime (UTC) -> local "YYYY-MM-DDTHH:mm" for a datetime-local input
export function sqlToWallClock(sql: string): string | null {
	if (!sql) return null;
	const d = new Date(sql.replace(' ', 'T') + 'Z');
	if (isNaN(d.getTime())) return null;
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Date -> SQL datetime string "YYYY-MM-DD HH:mm:ss"
export function toSqlDateTime(date: Date): string {
	return date.toISOString().replace('T', ' ').slice(0, 19);
}
