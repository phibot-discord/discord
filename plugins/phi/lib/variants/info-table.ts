import { infoView } from "./info-common.ts";
import type { CardVariant } from "./types.ts";

/** Player info as one dense stats table plus three compact trend charts */
export const variant: CardVariant = {
	tpl: "info-table",
	width: 1200,
	prepare: (data, ctx) => ({
		...data,
		iv: infoView(data, ctx.locale, {
			nameW: 560,
			nameMax: 40,
			nameMin: 20,
			introW: 1064,
			introMaxLines: 2,
			introMax: 18,
			introMin: 14,
			rks: { w: 326, h: 120 },
			data: { w: 326, h: 120 },
			acc: { w: 326, h: 120 },
		}),
	}),
};
