/**
 * Correlates the assets one paste gesture imported with whether its markdown ever reached the
 * document. An import whose insertion fails leaves a file in the source nothing references, and
 * the editor's `clipboard` error origin is the only place that failure is announced.
 */

export interface PasteImportLedgerDeps {
	deleteAsset(relPath: string): Promise<void>;
}

export interface PasteImportLedger {
	/** An import that succeeded, whose markdown the editor has yet to insert. */
	record(relPath: string): void;
	/** The gesture's markdown landed: the recorded paths are the document's now. */
	commit(): void;
	/** The insertion failed: delete what was recorded. Contains every delete failure. */
	release(): Promise<void>;
	markOwnFailure(error: unknown): void;
	isOwnFailure(error: unknown): boolean;
}

export function createPasteImportLedger(deps: PasteImportLedgerDeps): PasteImportLedger {
	let imported: string[] = [];
	// Identity, not a message: the editor hands an import throw back on the error channel as
	// the same object, unwrapped. A marked error is limestone's OWN failed import, whose
	// siblings in the gesture still land — releasing on it would delete referenced assets.
	const ownFailures = new WeakSet<object>();

	return {
		record(relPath) {
			imported.push(relPath);
		},
		commit() {
			imported = [];
		},
		async release() {
			// Forgotten before the awaits, so a second error on the same gesture cannot
			// re-delete paths this call already owns.
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

// A throw is not obliged to be an object, and a WeakSet takes only references.
function isReferenceType(value: unknown): value is object {
	return value !== null && (typeof value === 'object' || typeof value === 'function');
}
