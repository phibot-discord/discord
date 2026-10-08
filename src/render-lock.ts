export class Semaphore {
	private active = 0;
	private readonly wait: Array<() => void> = [];

	constructor(private readonly max: number) {}

	/** Runs `fn` in a free slot. An abort while queued leaves the queue without taking one */
	async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		signal?.throwIfAborted();
		while (this.active >= this.max) {
			await new Promise<void>((resolve, reject) => {
				const wake = () => {
					signal?.removeEventListener("abort", onAbort);
					resolve();
				};
				const onAbort = () => {
					const i = this.wait.indexOf(wake);
					if (i >= 0) this.wait.splice(i, 1);
					reject(signal?.reason);
				};
				this.wait.push(wake);
				signal?.addEventListener("abort", onAbort, { once: true });
			});
		}
		this.active += 1;
		try {
			return await fn();
		} finally {
			this.active -= 1;
			this.wait.shift()?.();
		}
	}

	get busy(): number {
		return this.active;
	}

	get queued(): number {
		return this.wait.length;
	}
}

/** Rejects after `ms` and aborts `controller`, so timed-out work stops */
export function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	label: string,
	controller?: AbortController,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => {
			const err = new Error(`${label} timed out after ${ms}ms`);
			controller?.abort(err);
			reject(err);
		}, ms);
		promise.then(
			(value) => {
				clearTimeout(t);
				resolve(value);
			},
			(err) => {
				clearTimeout(t);
				reject(err);
			},
		);
	});
}

/** Cap concurrent Takumi rasters in this process */
export const renderLock = new Semaphore(2);
