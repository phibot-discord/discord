import { variant as b19Portrait } from "./b19-portrait.ts";
import { variant as b19Table } from "./b19-table.ts";
import { variant as infoClassic } from "./info-classic.ts";
import { variant as infoPortrait } from "./info-portrait.ts";
import { variant as infoTable } from "./info-table.ts";
import { variant as song } from "./song.ts";
import type { CardVariant } from "./types.ts";
import { variant as updateSummary } from "./update-summary.ts";
import { variant as updateTimeline } from "./update-timeline.ts";

export type { CardData, CardVariant, VariantContext } from "./types.ts";

const VARIANTS: CardVariant[] = [
	b19Table,
	b19Portrait,
	updateTimeline,
	updateSummary,
	song,
	infoClassic,
	infoTable,
	infoPortrait,
];

const byTpl = new Map(VARIANTS.map((v) => [v.tpl, v]));

/** The alternative layout registered for an art template name, if any */
export function cardVariant(tpl: string): CardVariant | undefined {
	return byTpl.get(tpl);
}
