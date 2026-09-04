import { cardCopy, type PhiLocale } from "./card-i18n.ts"
import type { UserNotes } from "./notes.ts"

type Option = { value: string; title: string; description: string; selected: boolean }
type Item = { key: string; title: string; description: string; currentTitle: string; options: Option[] }

function item<K extends string>(
  key: K,
  title: string,
  description: string,
  current: string,
  options: Record<string, { title: string; description: string }>,
): Item {
  return {
    key,
    title,
    description,
    currentTitle: options[current]?.title || current,
    options: Object.entries(options).map(([value, o]) => ({
      value,
      title: o.title,
      description: o.description,
      selected: value === current,
    })),
  }
}

export function userSettingCard(notes: UserNotes, locale: PhiLocale) {
  const t = cardCopy(locale)
  const lang = notes.locale || locale
  return {
    pageTitle: t.settingsTitle,
    pageDescription: t.settingsDesc,
    locale,
    items: [
      item("locale", t.langTitle, t.langDesc, lang, t.langOpt),
      item("theme", t.themeTitle, t.themeDesc, notes.theme || "default", t.theme),
      item("b30AvgKind", t.avgKindTitle, t.avgKindDesc, notes.b30AvgKind || "all", t.avgKind),
      item("b30AvgColor", t.avgColorTitle, t.avgColorDesc, notes.b30AvgColor || "red", t.avgColor),
      item("allowApiUsage", t.apiTitle, t.apiDesc, String(notes.allowApiUsage !== false), t.onOff),
      item("showB30Analysis", t.analysisSettingTitle, t.analysisSettingDesc, String(notes.showB30Analysis !== false), t.onOff),
      item("showTagAnalysis", t.tagSettingTitle, t.tagSettingDesc, String(notes.showTagAnalysis !== false), t.onOff),
    ],
  }
}
