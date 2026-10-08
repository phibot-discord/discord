import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { assetKeyOf, fallbackKeyOf, hydrateIlls, songIllPath } from "./ill.ts";

test("jackets, avatars and icons map to R2 keys; css and fonts do not", () => {
	const res = "/srv/app/phi-assets";
	assert.equal(
		assetKeyOf(`${res}/original_ill/illLow/Credits.Frums.png`),
		"original_ill/illLow/Credits.Frums.png",
	);
	assert.equal(
		assetKeyOf(`${res}/html/avatar/Drop it.png`),
		"html/avatar/Drop it.png",
	);
	assert.equal(assetKeyOf(`${res}/html/otherimg/S.png`), "html/otherimg/S.png");
	// Templates HTML-escape src values; the key must use the real filename
	assert.equal(
		assetKeyOf(`${res}/original_ill/illLow/Song.A&#38;B.png`),
		"original_ill/illLow/Song.A&B.png",
	);
	assert.equal(
		assetKeyOf(`${res}/original_ill/SP/Revisit(2024 April Fools&#39; Day).png`),
		"original_ill/SP/Revisit(2024 April Fools' Day).png",
	);
	assert.equal(assetKeyOf(`${res}/html/b19/b19.css`), undefined);
	assert.equal(assetKeyOf(`${res}/html/common/font/phi.woff2`), undefined);
	assert.equal(assetKeyOf("phi-css://takumi.css"), undefined);
});

test("songIllPath points at the R2 tree without looking on disk", () => {
	const root = "/no/local/original_ill";
	assert.equal(
		songIllPath(root, "Credits.Frums.0", "low"),
		"/no/local/original_ill/illLow/Credits.Frums.png",
	);
	assert.equal(
		songIllPath(root, "Credits.Frums.0", "common"),
		"/no/local/original_ill/ill/Credits.Frums.png",
	);
	assert.equal(
		songIllPath(root, "Credits.Frums.0", "blur"),
		"/no/local/original_ill/illBlur/Credits.Frums.png",
	);
	// SP songs have a single jacket; every kind maps to it
	assert.equal(
		songIllPath(root, "Introduction.0", "blur", true),
		"/no/local/original_ill/SP/Introduction.png",
	);
});

test("full jacket R2 miss falls back to illLow; unknown avatar to Introduction", () => {
	assert.equal(
		fallbackKeyOf("original_ill/ill/Stasis.Maozon.png"),
		"original_ill/illLow/Stasis.Maozon.png",
	);
	assert.equal(
		fallbackKeyOf("original_ill/illLow/Stasis.Maozon.png"),
		undefined,
	);
	assert.equal(
		fallbackKeyOf("original_ill/illBlur/Stasis.Maozon.png"),
		undefined,
	);
	assert.equal(
		fallbackKeyOf("html/avatar/NotYetSynced.png"),
		"html/avatar/Introduction.png",
	);
	assert.equal(fallbackKeyOf("html/avatar/Introduction.png"), undefined);
	assert.equal(fallbackKeyOf("html/otherimg/S.png"), undefined);
});

test("a jacket that exists on disk is used as-is and never fetched", async () => {
	const dir = mkdtempSync(join(tmpdir(), "phi-ill-local-"));
	const local = join(dir, "original_ill", "illLow", "A&B.png");
	mkdirSync(dirname(local), { recursive: true });
	writeFileSync(local, "png");
	const escaped = join(dir, "original_ill", "illLow", "A&#38;B.png");
	const map = await hydrateIlls([escaped, local]);
	// The template's escaped spelling is mapped to the real file; the plain path needs no rewrite
	assert.equal(map.get(escaped), local);
	assert.equal(map.has(local), false);
});
