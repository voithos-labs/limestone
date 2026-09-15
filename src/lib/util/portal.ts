export function portal(node: HTMLElement, target: HTMLElement | null | undefined) {
	const move = (to: HTMLElement | null | undefined) => {
		if (to && node.parentElement !== to) to.appendChild(node);
	};
	move(target);
	return {
		update: move,
		destroy() {
			node.remove();
		}
	};
}
