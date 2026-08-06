/**
 * Tracks the files one paste imported until its markdown actually reaches the document. If the
 * insert fails, those files sit in the source with nothing pointing at them, and the editor's
 * `clipboard` error is the only place that failure is reported.
 */

export interface PasteImportLedgerDeps {
	deleteAsset(relPath: string): Promise<void>;
}

export interface PasteImportLedger {
	/** An import that succeeded, whose markdown the editor has yet to insert. */
	record(relPath: string): void;
	/** The gesture's markdown landed: the recorded paths are the document's now. */
	commit(): void;
	/** The insert failed: delete what was recorded. Never throws, even if a delete fails. */
	release(): Promise<void>;
	markOwnFailure(error: unknown): void;
	isOwnFailure(error: unknown): boolean;
}

export function createPasteImportLedger(deps: PasteImportLedgerDeps): PasteImportLedger {
	let imported: string[] = [];
	// Matched by identity, not by message: the editor hands our own import error back on its
	// error channel as the same object, unwrapped. A marked error means our import failed while
	// the paste's other images still landed, so releasing on it would delete files in use.
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
