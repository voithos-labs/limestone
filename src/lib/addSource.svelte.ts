class AddSourceRequest {
	signal = $state(0);

	open(): void {
		this.signal++;
	}
}

export const addSourceRequest = new AddSourceRequest();
