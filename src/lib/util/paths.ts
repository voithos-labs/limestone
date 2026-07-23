export function isValidSegment(name: string): boolean {
	const s = name.trim();
	return s !== '' && s !== '.' && s !== '..' && !/[\\/]/.test(s);
}
