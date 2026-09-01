#!/usr/bin/env node
/**
 * Refresh phi-assets from ../phi-plugin and strip unused files.
 *
 *   pnpm sync-assets
 */
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const PLUGIN = resolve(ROOT, "../phi-plugin");
const DEST = join(ROOT, "phi-assets");

const HTML_FILES = [
	"b19/b19.art",
	"b19/b19.css",
	"userinfo/userinfo.art",
	"userinfo/userinfo.css",
	"userinfo/userinfo-old.art",
	"userinfo/userinfo-old.css",
	"historyB30/historyB30.art",
	"historyB30/historyB30.css",
	"score/score.art",
	"score/score.css",
	"lvsco/lvsco.art",
	"lvsco/lvsco.css",
	"setting/userSetting.art",
	"setting/userSetting.css",
	"update/update.art",
	"update/update.css",
	"table/table.art",
	"table/table.css",
	"suggest/suggest.art",
	"suggest/suggest.css",
	"list/list.art",
	"list/list.css",
	"chap/chap.art",
	"chap/chap.css",
	"common/common.css",
];
const HTML_DIRS = ["avatar", "otherimg", "common/layout", "common/css", "common/theme"];
const INFO_FILES = [
	"avatar.txt",
	"chaplist.yaml",
	"info.csv",
	"infolist.json",
	"nicklist.yaml",
	"notesInfo.json",
	"oldNotesInfo.json",
	"spinfo.json",
	"tips.txt",
];
const INFO_DIRS = ["oldInfo"];

function run(cmd, args, opts = {}) {
	const r = spawnSync(cmd, args, { encoding: "utf8", stdio: "inherit", ...opts });
	if (r.status !== 0) {
		const err = typeof r.stderr === "string" ? r.stderr.trim() : "";
		throw new Error(`${cmd} ${args.join(" ")} failed${err ? `: ${err}` : ""}`);
	}
}

function copyFile(src, dest) {
	if (!existsSync(src)) throw new Error(`missing ${src}`);
	mkdirSync(dirname(dest), { recursive: true });
	cpSync(src, dest);
}

function copyDir(src, dest) {
	if (!existsSync(src)) throw new Error(`missing ${src}`);
	mkdirSync(dirname(dest), { recursive: true });
	cpSync(src, dest, {
		recursive: true,
		filter: (p) => !p.endsWith(".DS_Store") && !p.endsWith("demo.jpg"),
	});
}

function pluginRoot() {
	const resources = join(PLUGIN, "resources");
	if (
		!existsSync(join(resources, "html")) ||
		!existsSync(join(resources, "info"))
	) {
		throw new Error(`missing ${PLUGIN}/resources/{html,info}`);
	}
	return PLUGIN;
}

function convertFonts(srcFont, destFont) {
	mkdirSync(destFont, { recursive: true });
	if (!existsSync(srcFont)) throw new Error(`missing ${srcFont}`);
	const work = mkdtempSync(join(tmpdir(), "phi-fonts-"));
	try {
		for (const name of readdirSync(srcFont)) {
			if (/NotoColorEmoji/i.test(name)) continue;
			const src = join(srcFont, name);
			if (!statSync(src).isFile()) continue;
			const ext = extname(name).toLowerCase();
			if (ext === ".woff2") {
				cpSync(src, join(destFont, name));
				continue;
			}
			if (ext !== ".ttf") continue;
			const tmpTtf = join(work, name);
			cpSync(src, tmpTtf);
			run("woff2_compress", [tmpTtf], { stdio: "pipe" });
			const woff2Name = `${name.slice(0, -extname(name).length)}.woff2`;
			const made = join(work, woff2Name);
			if (!existsSync(made)) {
				throw new Error(`woff2_compress did not write ${made}`);
			}
			cpSync(made, join(destFont, woff2Name));
		}
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

function stripCss(text) {
	return `${text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/@font-face\s*\{[^}]*NotoColorEmoji[^}]*\}/gi, "")
		.replace(/(\.\/font\/[^"')]+)\.ttf/gi, "$1.woff2")
		.replace(/(\.\/font\/[^"')]+)\.TTF/g, "$1.woff2")
		.replace(/format\(\s*(['"]?)truetype\1\s*\)/gi, 'format("woff2")')
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim()}\n`;
}

function walkCss(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walkCss(p, out);
		else if (name.endsWith(".css")) out.push(p);
	}
	return out;
}

function main() {
	const probe = spawnSync("woff2_compress", ["-h"], { stdio: "pipe" });
	if (probe.error?.code === "ENOENT") {
		throw new Error("woff2_compress not found — install with `brew install woff2`");
	}

	const plugin = pluginRoot();
	const resources = join(plugin, "resources");
	const stage = mkdtempSync(join(tmpdir(), "phi-assets-"));
	const htmlStage = join(stage, "html");
	const infoStage = join(stage, "info");
	mkdirSync(htmlStage, { recursive: true });
	mkdirSync(infoStage, { recursive: true });

	for (const rel of HTML_FILES) {
		copyFile(join(resources, "html", rel), join(htmlStage, rel));
	}
	for (const rel of HTML_DIRS) {
		copyDir(join(resources, "html", rel), join(htmlStage, rel));
	}
	convertFonts(
		join(resources, "html/common/font"),
		join(htmlStage, "common/font"),
	);

	for (const rel of INFO_FILES) {
		copyFile(join(resources, "info", rel), join(infoStage, rel));
	}
	for (const rel of INFO_DIRS) {
		copyDir(join(resources, "info", rel), join(infoStage, rel));
	}

	for (const file of walkCss(htmlStage)) {
		writeFileSync(file, stripCss(readFileSync(file, "utf8")));
	}

	mkdirSync(DEST, { recursive: true });
	rmSync(join(DEST, "html"), { recursive: true, force: true });
	rmSync(join(DEST, "info"), { recursive: true, force: true });
	cpSync(htmlStage, join(DEST, "html"), { recursive: true });
	cpSync(infoStage, join(DEST, "info"), { recursive: true });

	const license = join(plugin, "LICENSE");
	if (existsSync(license)) cpSync(license, join(DEST, "LICENSE"));

	rmSync(stage, { recursive: true, force: true });
	console.log(`sync-assets: stripped ${PLUGIN} → ${DEST}`);
}

try {
	main();
} catch (err) {
	console.error(`sync-assets: ${err instanceof Error ? err.message : err}`);
	process.exit(1);
}
