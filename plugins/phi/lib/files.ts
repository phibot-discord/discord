import { existsSync, readFileSync } from "node:fs"
import { parse as parseYaml } from "yaml"

export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  return JSON.parse(readFileSync(file, "utf8")) as T
}

export function readYaml<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  return parseYaml(readFileSync(file, "utf8")) as T
}

export function readText(file: string): string {
  if (!existsSync(file)) return ""
  return readFileSync(file, "utf8").replace(/\r/g, "")
}

/** Tab-separated table reader. */
export function readTsv<T extends Record<string, string>>(file: string): T[] {
  if (!existsSync(file)) return []
  const lines = readText(file).split("\n")
  const headerLine = lines[0]
  if (!headerLine) return []
  const headers = headerLine.split("\t")
  const out: T[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const cells = line.split("\t")
    const obj: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) obj[headers[j]!] = cells[j] ?? ""
    out.push(obj as T)
  }
  return out
}
