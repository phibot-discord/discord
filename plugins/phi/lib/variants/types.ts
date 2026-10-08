import type { CardKind } from "../../../../src/card-kinds.ts";
import type { PhiLocale } from "../card-i18n.ts";
import type { Catalog } from "../catalog.ts";
import type { PhiRuntime } from "../runtime.ts";

export type CardData = Record<string, unknown>;

export type VariantContext = {
	kind: CardKind;
	locale: PhiLocale;
	catalog: Catalog;
	rt?: PhiRuntime;
};

/**
 * One alternative card layout. `tpl` is the art file name under
 * phi-assets/html/<dir>/ (without .art); its stylesheet is src/phi/css/<tpl>.css
 */
export type CardVariant = {
	tpl: string;
	/** CSS width of the card in px */
	width: number;
	/** Upper bound for the "high" paint ratio (defaults to 2) */
	maxRatio?: number;
	/** Derive extra template fields (fitted font sizes, deltas, …) from the card data */
	prepare?: (
		data: CardData,
		ctx: VariantContext,
	) => CardData | Promise<CardData>;
};
