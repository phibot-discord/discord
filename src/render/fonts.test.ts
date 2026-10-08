import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appFontDir, loadFontsFromDir } from "./fonts.ts";

function dirWith(files: Record<string, string>) {
	const dir = mkdtempSync(join(tmpdir(), "phi-fonts-"));
	for (const [name, body] of Object.entries(files))
		writeFileSync(join(dir, name), body);
	return dir;
}

test("phi-assets faces come from the font dir and the web-UI face from src/fonts", async () => {
	const fontDir = dirWith({
		"phi.woff2": "phi",
		"noto-sans-sc-400.woff2": "x",
	});
	const appDir = dirWith({
		"noto-sans-sc-400.woff2": "sc",
		"phi.woff2": "wrong",
	});
	const fonts = await loadFontsFromDir(
		fontDir,
		{ "phi.woff2": "PHI", "noto-sans-sc-400.woff2": "NotoSansSC" },
		appDir,
	);
	const byName = Object.fromEntries(
		fonts.map((f) => [f.name, f.data.toString()]),
	);
	assert.deepEqual(byName, { PHI: "phi", NotoSansSC: "sc" });
	assert.equal(fonts.find((f) => f.name === "PHI")?.generic, "sans-serif");
});

test("a missing face is skipped, not fatal", async () => {
	const fontDir = dirWith({ "phi.woff2": "phi" });
	const fonts = await loadFontsFromDir(
		fontDir,
		{ "phi.woff2": "PHI", "Aldrich-Regular.woff2": "Aldrich" },
		dirWith({}),
	);
	assert.deepEqual(
		fonts.map((f) => f.name),
		["PHI"],
	);
});

test("the web-UI face resolves under the app root", () => {
	assert.equal(appFontDir(), join(process.cwd(), "src/fonts"));
});
