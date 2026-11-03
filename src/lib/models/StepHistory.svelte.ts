/** A change a history can take back and make again; either direction may be async. */
export interface Step {
	undo(): unknown;
	redo(): unknown;
}

/**
 * A linear undo history. Positions run from 0, before the first step, to `count - 1`, after the
 * last, so a slider drives `select` the way it drives a note's history. Recording a step drops
 * the steps undone before it.
 */
export default class StepHistory {
	private steps: Step[] = $state.raw([]);
	private position = $state(0);
	private target = 0;
	private walking: Promise<void> = Promise.resolve();

	get count(): number {
		return this.steps.length + 1;
	}

	/** The position reached, or being reached while a step applies. */
	get index(): number {
		return this.position;
	}

	get atPresent(): boolean {
		return this.position === this.steps.length;
	}

	record(step: Step): void {
		this.steps = [...this.steps.slice(0, this.position), step];
		this.position = this.target = this.steps.length;
	}

	undo(): Promise<void> {
		return this.select(this.target - 1);
	}

	redo(): Promise<void> {
		return this.select(this.target + 1);
	}

	/** Applies steps one at a time until position `i`; a call made mid-way redirects that walk. */
	select(i: number): Promise<void> {
		this.target = Math.max(0, Math.min(this.steps.length, i));
		const walk = this.walking.then(() => this.walk());
		this.walking = walk.catch(() => {});
		return walk;
	}

	clear(): void {
		this.steps = [];
		this.position = this.target = 0;
	}

	private async walk(): Promise<void> {
		while (this.position !== this.target) {
			const { steps, position: from } = this;
			const back = this.target < from;
			const step = steps[back ? from - 1 : from];
			// the position moves first, so a step recorded meanwhile follows this one's result
			this.position = back ? from - 1 : from + 1;
			try {
				await (back ? step.undo() : step.redo());
			} catch (e) {
				// a recorded or cleared history has already settled where it stands
				if (this.steps === steps) this.position = this.target = from;
				throw e;
			}
		}
	}
}
