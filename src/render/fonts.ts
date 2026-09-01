import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { FontEntry } from "../sdk/index.ts"

/** Map bundled font filenames to CSS font-family names in common.css */
const PHI_FONT_FILES: Record<string, string> = {
  "phi.woff2": "PHI",
  "吞弥恰俊.woff2": "吞弥恰俊",
  "HIMALAYA.woff2": "HIMALAYA",
  "NotoSans-Regular.woff2": "NOTO",
  "NotoSansSymbols2.woff2": "NotoSansSymbols2",
  "NotoSansArabic.woff2": "NotoSansArabic",
  "NotoSansJP.woff2": "NotoSansJP",
  "Aldrich-Regular.woff2": "Aldrich",
  "NotoSansKannada.woff2": "NotoSansKannada",
  "NotoSansCanadianAboriginal.woff2": "NotoSansCanadianAboriginal",
  "NotoSansMath-Regular.woff2": "NotoSansMath-Regular",
  "noto-sans-sc-400.woff2": "NotoSansSC",
}

export const PHI_FONT_FAMILIES = [
  "NotoSansSC",
  "PHI",
  "Aldrich",
  "NotoSansJP",
  "NOTO",
  "NotoSansArabic",
  "NotoSansSymbols2",
  "NotoSansKannada",
  "NotoSansCanadianAboriginal",
  "HIMALAYA",
  "吞弥恰俊",
  "NotoSansMath-Regular",
] as const

export async function loadFontsFromDir(
  dir: string,
  map: Record<string, string> = PHI_FONT_FILES,
): Promise<FontEntry[]> {
  const names = await readdir(dir)
  const out: FontEntry[] = []
  for (const name of names) {
    const family = map[name]
    if (!family) continue
    out.push({ name: family, data: await readFile(join(dir, name)), weight: 400, style: "normal" })
  }
  return out
}
