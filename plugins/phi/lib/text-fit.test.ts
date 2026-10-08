import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Renderer } from "@takumi-rs/core";
import { fromHtml } from "takumi-js/helpers/html";
import {
	loadFontsFromDir,
	PHI_FONT_FAMILIES,
	PHI_FONT_FILES,
} from "../../../src/render/fonts.ts";
import { fitEm, fitFontPx, splitTwoLines, textEm } from "./text-fit.ts";

const TITLES = [
	"Compute It With Some Devilish Alcoholic Steampunk Engines",
	"a truth seeker -Communication with Utopia will be lost-",
	"Retribution ~ Cycle of Redemption ~",
	"祈 -我ら神祖と共に歩む者なり-",
	"Ποσειδών",
	"Re：birth",
	"Verrückt",
	"16.1234 ±0.42",
	"WWWWMMMM@@@@%%%%",
	"iiiillll||||!!!!",
];

test("fitFontPx shrinks long text and never exceeds the cap", () => {
	assert.equal(fitFontPx("Stasis", 150, 15), 15);
	const px = fitFontPx(TITLES[0]!, 150, 15);
	assert.ok(px < 15);
	assert.ok(textEm(TITLES[0]!) * px <= 150);
	assert.equal(fitEm(0, 150, 15), 15);
});

test("splitTwoLines balances at a space and keeps every character", () => {
	const [a, b] = splitTwoLines(TITLES[0]!);
	assert.equal(`${a} ${b}`, TITLES[0]);
	assert.ok(Math.abs(textEm(a) - textEm(b)) < 4);
	const [c, d] = splitTwoLines("一二三四五六七八");
	assert.equal(`${c}${d}`, "一二三四五六七八");
	assert.equal(c.length, 4);
});

test("textEm never underestimates what Takumi lays out", async () => {
	const fontDir = fileURLToPath(
		new URL("../../../phi-assets/html/common/font/", import.meta.url),
	);
	const renderer = new Renderer({});
	for (const f of await loadFontsFromDir(fontDir, PHI_FONT_FILES)) {
		await renderer.registerFont({
			name: f.name,
			data: f.data,
			weight: f.weight ?? 400,
			style: f.style ?? "normal",
			generic: f.generic,
		});
	}
	// Song titles use the card body stack, player names put NotoSansSC first
	const stacks = ["PHI, NotoSansSC, Aldrich", "NotoSansSC, PHI, Aldrich"];
	for (const stack of stacks) {
		for (const text of TITLES) {
			const tree = fromHtml(
				`<div style="display:flex;width:4000px"><p style="flex:none;margin:0;font-size:100px;white-space:pre;font-family:${stack}">${text}</p></div>`,
			);
			const measured = await renderer.measure(tree.node, {
				width: 4000,
				height: 400,
				fontFamilies: [...PHI_FONT_FAMILIES],
			});
			const width = measured.children[0]?.width ?? 0;
			assert.ok(width > 0, `${stack}: ${text} measured nothing`);
			assert.ok(
				textEm(text) * 100 >= width - 0.5,
				`${stack}: ${text} is ${width}px, estimated ${textEm(text) * 100}px`,
			);
		}
	}
});
