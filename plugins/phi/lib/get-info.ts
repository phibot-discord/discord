import { join } from "node:path";
import { chapIllPath, songIllPath } from "../../../src/ill.ts";
import { logger } from "../../../src/logger.ts";
import { illDir } from "../../../src/paths.ts";
import { exists, readdir } from "../../../src/vfs.ts";
import { ALL_LEVEL, LEVEL } from "./const.ts";
import { bindBackground } from "./fcompute.ts";
import { readJson, readText, readTsv, readYaml } from "./files.ts";

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
};

type SongInfo = {
	id: string;
	song: string;
	composer?: string;
	illustrator?: string;
	illustration?: string;
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
			(typeof LEVEL)[number],
			{ m: number; t: [number, number, number, number] }
		>
	>
>;

type VersionInfo = {
	version_label: string;
	update_date: number;
	whatsnew?: string;
	version_code: number;
	version?: string;
};

/** Catalog id form (`Song.Composer.0`); idempotent, unlike phi-plugin's helper */
export function withDotZero(id: string) {
	return id.endsWith(".0") ? id : `${id}.0`;
}

/** Chapter → aliases. A malformed or empty file must not take the song catalog down with it */
function readChapList(file: string): Record<string, string[]> {
	let raw: unknown;
	try {
		raw = readYaml<unknown>(file, {});
	} catch (err) {
		logger.warn(
			`chaplist skipped: ${err instanceof Error ? err.message : err}`,
		);
		return {};
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: Record<string, string[]> = {};
	for (const [chap, aliases] of Object.entries(raw)) {
		if (!Array.isArray(aliases)) continue;
		out[chap] = aliases
			.filter((a) => a != null)
			.map((a) => String(a).trim())
			.filter(Boolean);
	}
	return out;
}

const AVATAR_FILE: Record<string, string> = {
	"Cipher : /2&//<|0": "Cipher1",
	"Oblivion: PHIN": "OblivionPHIN",
	"Drop It": "Drop it",
	RIPPER: "ripper",
};

class GetInfo {
	allLevel = ALL_LEVEL;
	Level = LEVEL;
	tips: string[] = [];
	ori_info: Record<string, SongInfo> = {};
	sp_info: Record<string, SongInfo> = {};
	songsid: Record<string, string> = {};
	idssong: Record<string, string> = {};
	illlist: string[] = [];
	idList: string[] = [];
	songlist: string[] = [];
	chapNick: Record<string, string[]> = {};
	chapList: Record<string, string[]> = {};
	updatedSong: string[] = [];
	updatedChart: Record<string, Record<string, unknown>> = {};
	versionInfoByLabel: Record<string, VersionInfo> = {};
	versionInfoByCode: Record<string, VersionInfo> = {};
	historyDifficultyByVersion: Record<string, Record<string, CsvRow>> = {};
	historyDifficultyBySongId: Record<
		string,
		Record<string, Partial<Record<string, number>>>
	> = {};
	historyDifficultyByVerDifficulty: Record<
		string,
		Record<string, { id: string; rank: string; difficulty: number }[]>
	> = {};
	MAX_DIFFICULTY = 0;
	avatarid: string[] = [];
	private totals: [number, number, number, number] | undefined;
	resources = "";
	originalIll = "";

	async init(resources: string) {
		this.resources = resources;
		this.originalIll = illDir();
		const infoPath = join(resources, "info");
		const oldInfoPath = join(infoPath, "oldInfo");
		const dlcPath = join(infoPath, "DLC");

		this.tips = [];
		this.ori_info = {};
		this.sp_info = {};
		this.songsid = {};
		this.idssong = {};
		this.illlist = [];
		this.idList = [];
		this.songlist = [];
		this.chapNick = {};
		this.updatedSong = [];
		this.updatedChart = {};
		this.versionInfoByLabel = {};
		this.versionInfoByCode = {};
		this.historyDifficultyByVersion = {};
		this.historyDifficultyBySongId = {};
		this.historyDifficultyByVerDifficulty = {};
		this.MAX_DIFFICULTY = 0;
		this.totals = undefined;

		this.avatarid = readText(join(infoPath, "avatar.txt"))
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean);
		this.tips = readText(join(infoPath, "tips.txt"))
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean);

		const spJson = readJson<Record<string, Partial<SongInfo>>>(
			join(infoPath, "spinfo.json"),
			{},
		);
		for (const [raw, data] of Object.entries(spJson)) {
			const id = withDotZero(raw);
			const song: SongInfo = {
				...data,
				id,
				sp_vis: true,
				song: data.song || raw,
				chart: data.chart || {},
			};
			this.sp_info[id] = song;
			this.idssong[raw] = id;
			if (song.song) this.idssong[song.song] = id;
			if (song.illustration) this.illlist.push(id);
		}

		const notesInfo = readJson<Notes>(join(infoPath, "notesInfo.json"), {});
		const oldNotes = readJson<Notes>(join(infoPath, "oldNotesInfo.json"), {});

		let historyVersionList: string[] = [];
		try {
			historyVersionList = readdir(oldInfoPath);
		} catch {
			historyVersionList = [];
		}
		const versionCodes = historyVersionList
			.map((ver) => Number(ver))
			.sort((a, b) => a - b);
		const lastVersionCode =
			versionCodes.length >= 2
				? versionCodes[versionCodes.length - 2]!.toFixed(0)
				: undefined;
		let oldDif: CsvRow[] = [];

		for (const ver of historyVersionList) {
			const verInfo = readJson<VersionInfo>(
				join(oldInfoPath, ver, "info.json"),
				{
					version_label: ver,
					version_code: Number(ver),
					update_date: 0,
				},
			);
			const csvDifInfo = readTsv<CsvRow>(join(oldInfoPath, ver, "change.csv"));
			const difInfo: Record<string, CsvRow> = {};
			if (ver === lastVersionCode) oldDif = csvDifInfo;
			for (const item of csvDifInfo) difInfo[withDotZero(item.id)] = item;
			this.versionInfoByCode[ver] = verInfo;
			if (verInfo.version_label)
				this.versionInfoByLabel[verInfo.version_label] = verInfo;
			this.historyDifficultyByVersion[ver] = difInfo;
			this.historyDifficultyByVerDifficulty[ver] = {};
			for (const id of Object.keys(difInfo)) {
				const dif: Partial<Record<string, number>> = {};
				for (const level of LEVEL) {
					if (!difInfo[id]![level]) continue;
					const songDif = Number(difInfo[id]![level]);
					dif[level] = songDif;
					const key = songDif.toFixed(1);
					this.historyDifficultyByVerDifficulty[ver]![key] ||= [];
					this.historyDifficultyByVerDifficulty[ver]![key]!.push({
						id,
						rank: level,
						difficulty: songDif,
					});
				}
				this.historyDifficultyBySongId[id] ||= {};
				this.historyDifficultyBySongId[id]![ver] = dif;
			}
		}

		const csvInfo = readTsv<CsvRow>(join(infoPath, "info.csv"));
		const jsonInfo = readJson<
			Record<string, Partial<SongInfo> & { chart?: Record<string, Chart> }>
		>(join(infoPath, "infolist.json"), {});
		const oldDifList: Record<string, Partial<Record<string, number>>> = {};
		for (const row of oldDif) {
			oldDifList[row.id] = {};
			for (const level of LEVEL) {
				if (row[level]) oldDifList[row.id]![level] = Number(row[level]);
			}
		}

		for (const row of csvInfo) {
			const idWithout0 = row.id;
			const id = withDotZero(idWithout0);
			if (!oldDifList[idWithout0]) this.updatedSong.push(id);
			if (idWithout0 === "AnotherMe.DAAN") row.song = "Another Me (KALPA)";
			if (idWithout0 === "AnotherMe.NeutralMoon")
				row.song = "Another Me (Rising Sun Traxx)";
			this.songsid[id] = row.song;
			this.idssong[row.song] = id;
			this.ori_info[id] = {
				...(jsonInfo[idWithout0] || { chapter: "", bpm: "", length: "" }),
				id,
				song: row.song,
				composer: row.composer,
				illustrator: row.illustrator,
				chart: {},
			};
			for (const level of LEVEL) {
				if (!row[level]) continue;
				const notes = notesInfo[idWithout0]?.[level];
				const combo = notes
					? notes.t[0] + notes.t[1] + notes.t[2] + notes.t[3]
					: undefined;
				const chart: Chart = {
					id,
					rank: level,
					charter: row[`${level}C` as keyof CsvRow] || "",
					difficulty: Number(row[level]),
					tap: notes?.t[0],
					drag: notes?.t[1],
					hold: notes?.t[2],
					flick: notes?.t[3],
					combo,
					maxTime: notes?.m,
				};
				this.ori_info[id]!.chart![level] = chart;
				if (oldDifList[idWithout0]) {
					const old = oldDifList[idWithout0]![level];
					const oldN = oldNotes[idWithout0]?.[level];
					const changed =
						old == null ||
						old !== chart.difficulty ||
						(oldN &&
							notes &&
							JSON.stringify(oldN.t) !== JSON.stringify(notes.t));
					if (changed) {
						const tem: Record<string, unknown> = {};
						if (old == null && notes) {
							Object.assign(tem, {
								tap: notes.t[0],
								drag: notes.t[1],
								hold: notes.t[2],
								flick: notes.t[3],
								difficulty: chart.difficulty,
								combo,
								isNew: true,
							});
						} else if (notes) {
							if (old !== chart.difficulty)
								tem.difficulty = [old, chart.difficulty];
							if (oldN && oldN.t[0] !== notes.t[0])
								tem.tap = [oldN.t[0], notes.t[0]];
							if (oldN && oldN.t[1] !== notes.t[1])
								tem.drag = [oldN.t[1], notes.t[1]];
							if (oldN && oldN.t[2] !== notes.t[2])
								tem.hold = [oldN.t[2], notes.t[2]];
							if (oldN && oldN.t[3] !== notes.t[3])
								tem.flick = [oldN.t[3], notes.t[3]];
							const oldCombo = oldN
								? oldN.t[0] + oldN.t[1] + oldN.t[2] + oldN.t[3]
								: undefined;
							if (oldCombo != null && combo != null && oldCombo !== combo)
								tem.combo = [oldCombo, combo];
						}
						this.updatedChart[id] ||= {};
						this.updatedChart[id]![level] = tem;
					}
				}
				this.MAX_DIFFICULTY = Math.max(this.MAX_DIFFICULTY, chart.difficulty);
			}
			if (jsonInfo[idWithout0]?.chart) {
				this.ori_info[id]!.chart = {
					...this.ori_info[id]!.chart,
					...jsonInfo[idWithout0]!.chart,
				};
			}
			this.illlist.push(id);
			this.songlist.push(this.ori_info[id]!.song);
			this.idList.push(id);
		}

		this.chapList = readChapList(join(infoPath, "chaplist.yaml"));
		for (const [chap, aliases] of Object.entries(this.chapList)) {
			for (const alias of aliases) {
				this.chapNick[alias] ||= [];
				this.chapNick[alias]!.push(chap);
			}
		}

		try {
			if (exists(dlcPath)) {
				for (const file of readdir(dlcPath).filter((f) =>
					f.endsWith(".json"),
				)) {
					void file;
				}
			}
		} catch {
			/* optional */
		}

		bindBackground((name) => this.getBackground(name) || "");
		logger.ok(
			`phi getInfo: ${this.idList.length} songs, max ${this.MAX_DIFFICULTY}`,
		);
	}

	/** Stored row without copying; callers must not mutate it */
	raw(id: string): SongInfo | undefined {
		return (
			this.ori_info[id] ||
			this.sp_info[id] ||
			this.ori_info[withDotZero(id)] ||
			this.sp_info[withDotZero(id)]
		);
	}

	info(id: string, _original = false): SongInfo | undefined {
		const row = this.raw(id);
		if (!row) return;
		return {
			...row,
			illustration: this.getill(row.id),
			chart: { ...(row.chart || {}) },
		};
	}

	/** Charts per level with a real constant, for the stats table. Constant per catalog load */
	chartTotals(): [number, number, number, number] {
		if (this.totals) return this.totals;
		const tot: [number, number, number, number] = [0, 0, 0, 0];
		for (const info of Object.values(this.ori_info)) {
			if (!info.chart) continue;
			for (let i = 0; i < LEVEL.length; i++) {
				if (Number(info.chart[LEVEL[i]!]?.difficulty))
					tot[i] = (tot[i] ?? 0) + 1;
			}
		}
		this.totals = tot;
		return tot;
	}

	getill(id: string, kind: "common" | "blur" | "low" = "common"): string {
		const key = withDotZero(id);
		const sp = !this.ori_info[key] && Boolean(this.sp_info[key]);
		return songIllPath(this.originalIll, id, kind, sp);
	}

	getChapIll(name: string) {
		return chapIllPath(this.originalIll, name);
	}

	/** avatar.txt id → `html/avatar/<name>.png`; unknown ids draw the game's default */
	idgetavatar(id: string) {
		if (!this.avatarid.includes(id)) return "Introduction";
		return AVATAR_FILE[id] ?? id;
	}

	idgetsong(id: string) {
		return this.songsid?.[id];
	}

	SongGetId(song: string) {
		return this.idssong?.[song];
	}

	getBackground(saveBackground: string) {
		if (!saveBackground) return "";
		let name = saveBackground;
		switch (name) {
			case "Another Me ":
				name = "Another Me (KALPA)";
				break;
			case "Another Me":
				name = "Another Me (Rising Sun Traxx)";
				break;
			case "Re_Nascence (Psystyle Ver.) ":
				name = "Re_Nascence (Psystyle Ver.)";
				break;
			case "Energy Synergy Matrix":
				name = "ENERGY SYNERGY MATRIX";
				break;
			case "Le temps perdu-":
				name = "Le temps perdu";
				break;
			default:
				break;
		}
		return this.getill(this.SongGetId(name) || name);
	}
}

const g = globalThis as typeof globalThis & { __phiGetInfo?: GetInfo };
if (!g.__phiGetInfo) g.__phiGetInfo = new GetInfo();
export const getInfo = g.__phiGetInfo;
