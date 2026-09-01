const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
}

function stamp() {
  return new Date().toISOString().slice(11, 23)
}

export const logger = {
  info: (...a: unknown[]) => console.log(c.dim(stamp()), c.cyan("info"), ...a),
  warn: (...a: unknown[]) => console.warn(c.dim(stamp()), c.yellow("warn"), ...a),
  error: (...a: unknown[]) => console.error(c.dim(stamp()), c.red("error"), ...a),
  ok: (...a: unknown[]) => console.log(c.dim(stamp()), c.green("ok"), ...a),
}
