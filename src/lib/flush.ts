const flushers = new Set<() => Promise<void> | void>();
// todo: make sure to add debounced persists here in going forward, basicalyl waits for save before
//  closing window
export function registerFlush(fn: () => Promise<void> | void): () => void {
	flushers.add(fn);
	return () => flushers.delete(fn);
}

export async function flushAll(): Promise<void> {
	await Promise.all([...flushers].map((fn) => fn()));
}
