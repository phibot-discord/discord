export const ALL_LEVEL = ["EZ", "HD", "IN", "AT", "LEGACY"] as const
export const LEVEL = ["EZ", "HD", "IN", "AT"] as const

export function kvKey(...parts: Array<string | number>) {
  return `phi:${parts.map(String).join(":")}`
}

export const MAX_DIFFICULTY = 17.6

export const PHI_CHART_TAG_API = "https://phib19.top:8080"
