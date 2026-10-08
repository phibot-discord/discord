import { kvKey } from "./const.ts";

export const INFO_FILE_KV_KEY = kvKey("infoFile");

export type InfoFileCache = {
	sha: string;
	csv: string;
	songs: number;
	maxDifficulty: number;
	updatedAt: string;
};

export function parseInfoFileCache(
	raw: string | null | undefined,
): InfoFileCache | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw) as Partial<InfoFileCache>;
		if (!parsed || typeof parsed !== "object") return undefined;
		if (typeof parsed.sha !== "string" || !parsed.sha) return undefined;
		if (typeof parsed.csv !== "string" || !parsed.csv.includes("\t"))
			return undefined;
		if (typeof parsed.songs !== "number") return undefined;
		if (typeof parsed.maxDifficulty !== "number") return undefined;
		if (typeof parsed.updatedAt !== "string") return undefined;
		return {
			sha: parsed.sha,
			csv: parsed.csv,
			songs: parsed.songs,
			maxDifficulty: parsed.maxDifficulty,
			updatedAt: parsed.updatedAt,
		};
	} catch {
		return undefined;
	}
}
