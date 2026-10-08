import { join } from "node:path";
import { loadedCatalogRevision } from "../../../src/song-info.ts";
import { readJson, readTsv, readYaml } from "./files.ts";
import { getInfo } from "./get-info.ts";
import { jaroWinklerDistance } from "./jaro.ts";

const Level = ["EZ", "HD", "IN", "AT"] as const;

type Chart = {
	id: string;
	rank: string;
	charter: string;
	difficulty: number;
	tap?: number;
	drag?: number;
	hold?: number;
	flick?: number;
	combo?: number;
	maxTime?: number;
	distribution?: unknown;
	rgba?: string;
};

export type Song = {
	id: string;
	song: string;
	composer: string;
	illustrator: string;
	illustration: string;
	chapter?: string;
	bpm?: string;
	length?: string;
	spinfo?: string;
	isOriginal?: boolean;
	can_t_be_letter?: boolean;
	can_t_be_guessill?: boolean;
	chart: Record<string, Chart>;
	sp_vis?: boolean;
};

type CsvRow = {
	id: string;
	song: string;
	composer: string;
	illustrator: string;
	EZ?: string;
	HD?: string;
	IN?: string;
	AT?: string;
	EZC?: string;
	HDC?: string;
	INC?: string;
	ATC?: string;
};

type Notes = Record<
	string,
	Partial<
		Record<
			(typeof Level)[number],
			{ m: number; d: unknown; t: [number, number, number, number] }
		>
	>
>;

function withDotZero(id: string) {
	return id.endsWith(".0") ? id : `${id}.0`;
}

/**
 * Song search / alias index for slash commands, plus the card-facing view the
 * WebUI shares (`randomIll`, `ill`, `tips`). Jacket paths come
 * from `getInfo` so they resolve through the same R2 hydration as every card.
 * `load()` may run again after `ensureSongInfo` mounts a newer catalog.
 */
export class Catalog {
	songs = new Map<string, Song>();
	songsid = new Map<string, string>();
	idssong = new Map<string, string>();
	songnick = new Map<string, string[]>();
	readonly resources: string;
	readonly fallbackIll: string;
	private extraNicks: Record<string, string[]> = {};

	constructor(resources: string) {
		this.resources = resources;
		this.fallbackIll = join(resources, "html/otherimg/phigros.png");
	}

	get tips(): string[] {
		return getInfo.tips;
	}

	get size(): number {
		return getInfo.idList.length;
	}

	load() {
		this.songs = new Map();
		this.songsid = new Map();
		this.idssong = new Map();
		this.songnick = new Map();
		const info = join(this.resources, "info");
		const csv = readTsv<CsvRow>(join(info, "info.csv"));
		const json = readJson<
			Record<string, Partial<Song> & { chart?: Record<string, Partial<Chart>> }>
		>(join(info, "infolist.json"), {});
		const notes = readJson<Notes>(join(info, "notesInfo.json"), {});
		const sp = readJson<Record<string, Partial<Song>>>(
			join(info, "spinfo.json"),
			{},
		);
		const nick = readYaml<Record<string, string[]>>(
			join(info, "nicklist.yaml"),
			{},
		);

		for (const row of csv) {
			switch (row.id) {
				case "AnotherMe.DAAN":
					row.song = "Another Me (KALPA)";
					break;
				case "AnotherMe.NeutralMoon":
					row.song = "Another Me (Rising Sun Traxx)";
					break;
			}
			const id = withDotZero(row.id);
			const extra = json[row.id] || {};
			const song: Song = {
				id,
				song: row.song,
				composer: row.composer,
				illustrator: row.illustrator,
				illustration: "",
				chapter: extra.chapter,
				bpm: extra.bpm,
				length: extra.length,
				spinfo: extra.spinfo,
				isOriginal: extra.isOriginal,
				can_t_be_letter: extra.can_t_be_letter,
				can_t_be_guessill: extra.can_t_be_guessill,
				chart: {},
			};
			for (const level of Level) {
				if (!row[level]) continue;
				const n = notes[row.id]?.[level];
				const combo = n ? n.t[0] + n.t[1] + n.t[2] + n.t[3] : undefined;
				song.chart[level] = {
					id,
					rank: level,
					charter: row[`${level}C` as keyof CsvRow] || "",
					difficulty: Number(row[level]),
					tap: n?.t[0],
					drag: n?.t[1],
					hold: n?.t[2],
					flick: n?.t[3],
					combo,
					maxTime: n?.m,
					distribution: n?.d,
				};
			}
			if (extra.chart) {
				song.chart = {
					...song.chart,
					...(extra.chart as Record<string, Chart>),
				};
			}
			song.illustration = this.getill(id);
			this.songs.set(id, song);
			this.songsid.set(id, song.song);
			this.idssong.set(song.song, id);
		}

		for (const [raw, data] of Object.entries(sp)) {
			const id = withDotZero(raw);
			const song: Song = {
				id,
				song: data.song || raw,
				composer: data.composer || "",
				illustrator: data.illustrator || "",
				illustration: "",
				chapter: data.chapter,
				bpm: data.bpm,
				length: data.length,
				spinfo: data.spinfo,
				isOriginal: data.isOriginal,
				chart: (data.chart as Record<string, Chart>) || {},
				sp_vis: true,
			};
			song.illustration = this.getill(id);
			this.songs.set(id, song);
			this.idssong.set(raw, id);
			this.idssong.set(song.song, id);
			this.songsid.set(id, song.song);
		}

		for (const [rawId, aliases] of Object.entries(nick)) {
			const id = withDotZero(rawId);
			for (const alias of aliases || []) {
				const a = String(alias).trim();
				if (a) this.addNick(a, id);
			}
		}
		this.applyNickMap(this.extraNicks);
		return this;
	}

	info(id: string): Song | undefined {
		const song = this.songs.get(id) || this.songs.get(withDotZero(id));
		if (!song) return;
		return {
			...song,
			illustration: this.getill(song.id),
			chart: { ...song.chart },
		};
	}

	getill(id: string, kind: "common" | "blur" | "low" = "common"): string {
		return getInfo.getill(id, kind);
	}

	randomIll(kind: "common" | "blur" | "low" = "common"): string {
		const list = getInfo.illlist;
		if (!list.length) return this.fallbackIll;
		const id = list[Math.floor(Math.random() * list.length)]!;
		return getInfo.getill(id, kind);
	}

	ill(
		id: string,
		kind: "common" | "blur" | "low" = "common",
	): string | undefined {
		const key = knownBackground(id);
		if (!key) return;
		return getInfo.getill(key, kind);
	}

	fuzzy(mic: string, distance = 0.85): string[] {
		if (!mic) return [];
		const scored: { id: string; dis: number }[] = [];
		for (const [alias, ids] of this.songnick) {
			const dis = jaroWinklerDistance(mic, alias);
			if (dis >= distance) for (const id of ids) scored.push({ id, dis });
		}
		for (const song of this.songs.values()) {
			let dis = jaroWinklerDistance(mic, song.id);
			if (dis >= distance) scored.push({ id: song.id, dis });
			dis = jaroWinklerDistance(mic, song.song);
			if (dis >= distance) scored.push({ id: song.id, dis });
		}
		scored.sort((a, b) => b.dis - a.dis);
		const all: string[] = [];
		const best = scored[0]?.dis ?? 0;
		for (const row of scored) {
			if (all.includes(row.id)) continue;
			if (best === 1 && row.dis < 1) break;
			all.push(row.id);
		}
		return all;
	}

	suggest(q: string, n = 25): string[] {
		if (!q) return [...this.songs.values()].slice(0, n).map((s) => s.song);
		return this.fuzzy(q, 0.7)
			.slice(0, n)
			.map((id) => this.info(id)?.song || id);
	}

	/** Aliases from KV (`phi:nicklist`); kept across `load()` so a catalog refresh does not drop them. */
	loadExtraNicks(nicks: Record<string, string[]>) {
		for (const [alias, ids] of Object.entries(nicks)) {
			const list = this.extraNicks[alias] || [];
			for (const id of ids) if (!list.includes(id)) list.push(id);
			this.extraNicks[alias] = list;
		}
		this.applyNickMap(nicks);
	}

	private applyNickMap(nicks: Record<string, string[]>) {
		for (const [alias, ids] of Object.entries(nicks)) {
			for (const id of ids) this.addNick(alias, id);
		}
	}

	addNick(alias: string, id: string) {
		const a = alias.trim();
		if (!a) return;
		const list = this.songnick.get(a) || [];
		if (!list.includes(id)) list.push(id);
		this.songnick.set(a, list);
	}

	delNick(alias: string) {
		this.songnick.delete(alias.trim());
	}

	dumpNicks(): Record<string, string[]> {
		const out: Record<string, string[]> = {};
		for (const [k, v] of this.songnick) out[k] = v;
		return out;
	}
}

/** Canonical illustration id, or "" when the choice is missing or unknown */
export function knownBackground(id: string | undefined): string {
	const raw = id?.trim() ?? "";
	if (!raw) return "";
	const key = raw.endsWith(".0") ? raw : `${raw}.0`;
	if (getInfo.illlist.includes(key)) return key;
	if (getInfo.illlist.includes(raw)) return raw;
	return "";
}

export type BackgroundOption = { id: string; song: string };

let optionsMemo:
	| { rev: string; list: string[]; options: BackgroundOption[] }
	| undefined;

/** Illustrations with song names for the background picker, built once per catalog revision (shared: don't mutate) */
export function backgroundOptions(): BackgroundOption[] {
	const rev = loadedCatalogRevision();
	const list = getInfo.illlist;
	if (optionsMemo && optionsMemo.rev === rev && optionsMemo.list === list) {
		return optionsMemo.options;
	}
	const options = buildBackgroundOptions(list);
	optionsMemo = { rev, list, options };
	return options;
}

function buildBackgroundOptions(list: string[]): BackgroundOption[] {
	const seen = new Set<string>();
	const out: BackgroundOption[] = [];
	for (const id of list) {
		if (seen.has(id)) continue;
		seen.add(id);
		out.push({
			id,
			song: getInfo.ori_info[id]?.song || getInfo.sp_info[id]?.song || id,
		});
	}
	out.sort(
		(a, b) =>
			a.song.localeCompare(b.song, undefined, { sensitivity: "base" }) ||
			a.id.localeCompare(b.id),
	);
	return out;
}

/** Saved jacket, or a random one when none is chosen or the id is gone */
export function chosenIll(
	catalog: Pick<Catalog, "randomIll"> & Partial<Pick<Catalog, "ill">>,
	id: string | undefined,
	kind: "common" | "blur" | "low",
): string {
	if (id) {
		const picked = catalog.ill?.(id, kind);
		if (picked) return picked;
	}
	return catalog.randomIll(kind);
}
