/** What a card render may be waiting on; "render" once it no longer waits on anyone */
export type CardPhase = "phib19" | "render";

/**
 * Card data phib19.top could not fill in time: drawn without it, for "stale" with
 * ranks past their 6 h because the new answers were late, for "empty" without any
 * badge because phib19 answered with no figures at all
 */
export type CardMissing = "peers" | "tags" | "song" | "stale" | "empty";

/** Lookups answered from memory settle within this; only a slower one counts as waiting */
const WAIT_SIGNAL_MS = 300;

/**
 * Times a card's phib19.top lookups (they run side by side) and says while the card
 * waits on them: `onWait(true)` once one is still running after WAIT_SIGNAL_MS,
 * `onWait(false)` when the last one settles
 */
export function watchExternal(onWait?: (waiting: boolean) => void) {
	let pending = 0;
	let started: number | undefined;
	let ended: number | undefined;
	let waiting = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const settle = () => {
		pending--;
		ended = performance.now();
		if (pending > 0) return;
		clearTimeout(timer);
		if (waiting) {
			waiting = false;
			onWait?.(false);
		}
	};
	return {
		track<T>(job: Promise<T>): Promise<T> {
			pending++;
			started ??= performance.now();
			if (pending === 1 && !waiting) {
				clearTimeout(timer);
				timer = setTimeout(() => {
					if (pending > 0 && !waiting) {
						waiting = true;
						onWait?.(true);
					}
				}, WAIT_SIGNAL_MS);
			}
			job.then(settle, settle);
			return job;
		},
		/** Wall time from the first lookup until the last settled; undefined if none ran */
		ms(): number | undefined {
			if (started == null || ended == null) return;
			return Math.round(ended - started);
		},
	};
}

export type ExternalWatch = ReturnType<typeof watchExternal>;
