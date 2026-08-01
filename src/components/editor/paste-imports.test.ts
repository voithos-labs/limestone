import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPasteImportLedger } from './paste-imports';
import type { PasteImportLedger } from './paste-imports';

describe('the paste import ledger', () => {
	let deleted: string[];
	let failOn: string | null;
	let ledger: PasteImportLedger;

	beforeEach(() => {
		deleted = [];
		failOn = null;
		ledger = createPasteImportLedger({
			deleteAsset: async (relPath) => {
				if (relPath === failOn) throw new Error(`cannot delete ${relPath}`);
				deleted.push(relPath);
			}
		});
	});

	it('forgets what a commit claimed, so a later release deletes nothing', async () => {
		ledger.record('assets/a.png');
		ledger.commit();

		await ledger.release();

		expect(deleted).toEqual([]);
	});

	it('deletes every recorded path on release, and forgets them', async () => {
		ledger.record('assets/a.png');
		ledger.record('assets/b.png');

		await ledger.release();
		await ledger.release();

		expect(deleted).toEqual(['assets/a.png', 'assets/b.png']);
	});

	// A source that refuses one delete must not strand the rest, and must not surface as an
	// unhandled rejection out of an error handler that has nowhere to report it.
	it('contains a failing delete and still releases the others', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		failOn = 'assets/locked.png';
		ledger.record('assets/a.png');
		ledger.record('assets/locked.png');
		ledger.record('assets/b.png');

		await expect(ledger.release()).resolves.toBeUndefined();

		expect(deleted).toEqual(['assets/a.png', 'assets/b.png']);
	});

	it('recognizes a marked error and nothing else', () => {
		const own = new Error('import failed');
		ledger.markOwnFailure(own);

		expect(ledger.isOwnFailure(own)).toBe(true);
		expect(ledger.isOwnFailure(new Error('import failed'))).toBe(false);
	});

	// A throw is not obliged to be an object, and a WeakSet rejects primitives outright.
	it.each([['a string'], [null], [undefined], [7]])('survives a non-object throw (%s)', (error) => {
		expect(() => ledger.markOwnFailure(error)).not.toThrow();
		expect(ledger.isOwnFailure(error)).toBe(false);
	});
});
