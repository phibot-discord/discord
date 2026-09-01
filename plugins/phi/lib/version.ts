export type PhiVersion = {
  ver: string
  phigros: string
  phigrosVerNum: number
}

export function readPhiVersion(): PhiVersion {
  return { ver: "v1.0.2", phigros: "3.19.5", phigrosVerNum: 153 }
}
