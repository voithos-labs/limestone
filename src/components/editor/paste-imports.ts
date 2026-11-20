/**
 * the ledger that cleans up after an image paste that didn't make it into the note.
 *
 * Pasting an image saves the file first (aragonite's `onPasteImage` hook), then the editor inserts
 * the markdown pointing at it. If that insert fails, the file sits in the vault with nothing
 * pointing at it, and the editor's `clipboard` error is the only place that's reported. So the note
 * editor records each paste's files here, keeps them once the markdown lands, and deletes them on
 * that error.
 */

export interface PasteImportLedgerDeps {
	deleteAsset(relPath: string): Promise<void>;
}

export interface PasteImportLedger {
	/** remembers a file the paste saved, whose markdown the editor hasn't inserted yet */
	record(relPath: string): void;
	/** the paste's markdown made it in, so the recorded files are the note's now and stay */
	commit(): void;
	/** The insert failed: delete what was recorded. Never throws, even if a delete fails. */
	release(): Promise<void>;
	markOwnFailure(error: unknown): void;
	isOwnFailure(error: unknown): boolean;
}

export function createPasteImportLedger(deps: PasteImportLedgerDeps): PasteImportLedger {
	let imported: string[] = [];
	// our own import errors. one of these on the error channel means just that image failed and the
	// paste's other images still landed, so releasing on it would delete files in use. matched by
	// identity, not message, since the editor hands the error back as the same object, unwrapped
	const ownFailures = new WeakSet<object>();

	return {
		record(relPath) {
			imported.push(relPath);
		},
		commit() {
			imported = [];
		},
		async release() {
			// Cleared before awaiting, so a second error on the same paste cannot delete
			// these paths twice.
			const orphans = imported;
			imported = [];
			await Promise.all(
				orphans.map((relPath) =>
					deps
						.deleteAsset(relPath)
						.catch((e) => console.error('releasing orphaned asset failed', relPath, e))
				)
			);
		},
		markOwnFailure(error) {
			if (isReferenceType(error)) ownFailures.add(error);
		},
		isOwnFailure(error) {
			return isReferenceType(error) && ownFailures.has(error);
		}
	};
}

// Anything at all can be thrown, and a WeakSet only holds objects.
function isReferenceType(value: unknown): value is object {
	return value !== null && (typeof value === 'object' || typeof value === 'function');
}
