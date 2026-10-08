/**
 * Fire-and-forget for writes the caller should not wait on. The WebUI keeps
 * its Vercel function alive with `after()`; a long-lived bot process just
 * lets the promise settle on its own.
 */
export function runInBackground(
	work: Promise<unknown>,
	onError?: (err: unknown) => void,
): void {
	void work.then(
		() => undefined,
		(err) => onError?.(err),
	);
}
