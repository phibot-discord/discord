import { AsyncLocalStorage } from "node:async_hooks";

const c = {
	dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
	cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
	yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
	red: (s: string) => `\x1b[31m${s}\x1b[0m`,
	green: (s: string) => `\x1b[32m${s}\x1b[0m`,
};

const discordUid = new AsyncLocalStorage<string>();

function stamp() {
	return new Date().toISOString().slice(11, 23);
}

function uidTag(): string | undefined {
	const uid = discordUid.getStore();
	if (uid == null) return;
	return `discord uid: ${uid}`;
}

function emit(
	write: (...a: unknown[]) => void,
	color: (s: string) => string,
	level: string,
	args: unknown[],
) {
	const tag = uidTag();
	if (tag) write(c.dim(stamp()), color(level), ...args, tag);
	else write(c.dim(stamp()), color(level), ...args);
}

/** Keep the Discord user on every log until `fn` (and its promise) settles */
export function withDiscordUid<T>(
	uid: string | null | undefined,
	fn: () => T,
): T {
	return discordUid.run(uid?.trim() || "-", fn);
}

export const logger = {
	info: (...a: unknown[]) => emit(console.log, c.cyan, "info", a),
	warn: (...a: unknown[]) => emit(console.warn, c.yellow, "warn", a),
	error: (...a: unknown[]) => emit(console.error, c.red, "error", a),
	ok: (...a: unknown[]) => emit(console.log, c.green, "ok", a),
};
