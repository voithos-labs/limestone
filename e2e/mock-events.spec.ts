import { bootApp } from './support/app';
import { expect, test } from './support/test';

type EventInternals = {
	__TAURI_INTERNALS__: {
		invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
		transformCallback: (callback: (data: unknown) => void) => number;
	};
	__TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (event: string, id: number) => void };
};

// Guards the contract the app's `listen()` depends on: the id `listen` resolves to is the
// callback id, so an emit reaches the handler and unlisten can find it again. A counter id
// looks fine until something emits — which is how Task 5 will drive window close.
test('a listener registered through the IPC channel receives emits until unlistened', async ({
	page
}) => {
	await bootApp(page);

	const delivery = await page.evaluate(async () => {
		const { __TAURI_INTERNALS__: internals, __TAURI_EVENT_PLUGIN_INTERNALS__: eventInternals } =
			window as unknown as EventInternals;

		const received: unknown[] = [];
		const callbackId = internals.transformCallback((data) => received.push(data));
		const listenId = await internals.invoke('plugin:event|listen', {
			event: 'probe',
			handler: callbackId
		});

		await internals.invoke('plugin:event|emit', { event: 'probe', payload: 'first' });
		eventInternals.unregisterListener('probe', listenId as number);
		await internals.invoke('plugin:event|emit', { event: 'probe', payload: 'second' });

		return { listenId, callbackId, payloads: received.map((data) => (data as any).payload) };
	});

	expect(delivery.listenId).toBe(delivery.callbackId);
	expect(delivery.payloads).toEqual(['first']);
});
