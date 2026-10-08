import assert from "node:assert/strict";
import test from "node:test";
import { logger, withDiscordUid } from "./logger.ts";

function captureLog(fn: () => void): string[] {
	const lines: string[] = [];
	const orig = console.log;
	console.log = (...a: unknown[]) => {
		lines.push(a.map(String).join(" "));
	};
	try {
		fn();
	} finally {
		console.log = orig;
	}
	return lines;
}

test("logger omits discord uid outside a request", () => {
	const [line] = captureLog(() => logger.info("boot"));
	assert.ok(line);
	assert.equal(line.includes("discord uid:"), false);
	assert.ok(line.includes("boot"));
});

test("logger appends discord uid after the message", () => {
	const [line] = captureLog(() => {
		withDiscordUid("847761781409447947", () => logger.info("save cache miss"));
	});
	assert.ok(line);
	assert.ok(line.includes("save cache miss"));
	assert.ok(line.endsWith("discord uid: 847761781409447947"));
});

test("missing user logs as discord uid: -", () => {
	const [line] = captureLog(() => {
		withDiscordUid(undefined, () => logger.info("api GET /api/me"));
	});
	assert.ok(line);
	assert.ok(line.includes("discord uid: -"));
});
