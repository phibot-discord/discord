import { infoView } from "./info-common.ts";
import type { CardVariant } from "./types.ts";

/** Player info, default layout: profile hero, progress per difficulty, trends */
export const variant: CardVariant = {
	tpl: "info-classic",
	width: 1200,
	prepare: (data, ctx) => ({
		...data,
		iv: infoView(data, ctx.locale, {
			nameW: 380,
			nameMax: 44,
			nameMin: 22,
			introW: 1064,
			introMaxLines: 4,
			introMax: 22,
			introMin: 16,
			rks: { w: 496, h: 170 },
			data: { w: 496, h: 170 },
			acc: { w: 1064, h: 170 },
		}),
	}),
};
