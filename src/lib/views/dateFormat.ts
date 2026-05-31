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
		.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit', hour12: true})
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
		const weekday = d.toLocaleDateString(undefined, {weekday: 'short'});
		return `${weekday} ${shortTime(d)}`;
	}

	const sameYear = d.getFullYear() === now.getFullYear();
	if (sameYear) return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
	return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
}

export function formatDateISO(input: string | number | Date | null | undefined): string {
	if (input === null || input === undefined || input === '') return '';
	const d = parseDate(input);
	if (!d) return String(input);
	return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}
