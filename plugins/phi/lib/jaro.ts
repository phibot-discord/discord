/** Jaro–Winkler used for song alias matching. */
export function jaroWinklerDistance(a: string, b: string): number {
  let s1 = a.trim()
  let s2 = b.trim()
  if (s1 === s2) return 1
  const pattern =
    /[\s~`!@#$%^&*()\-=_+[\]「」『』{}|;:'",<.>/?！￥…（）—【】、；‘’：“”，《。》？↑↓←→]/g
  s1 = s1.replace(pattern, "").toLowerCase()
  s2 = s2.replace(pattern, "").toLowerCase()
  if (s1.length === 0 || s2.length === 0) return 0
  if (s1 === s2) return 1

  const range = Math.floor(Math.max(s1.length, s2.length) / 2) - 1
  const s1Matches = new Array<boolean>(s1.length)
  const s2Matches = new Array<boolean>(s2.length)
  let m = 0

  for (let i = 0; i < s1.length; i++) {
    const low = i >= range ? i - range : 0
    const high = i + range <= s2.length - 1 ? i + range : s2.length - 1
    for (let j = low; j <= high; j++) {
      if (!s1Matches[i] && !s2Matches[j] && s1[i] === s2[j]) {
        m++
        s1Matches[i] = s2Matches[j] = true
        break
      }
    }
  }
  if (m === 0) return 0

  let k = 0
  let nTrans = 0
  for (let i = 0; i < s1.length; i++) {
    if (s1Matches[i]) {
      let j = k
      for (; j < s2.length; j++) {
        if (s2Matches[j]) {
          k = j + 1
          break
        }
      }
      if (s1[i] !== s2[j]) nTrans++
    }
  }

  let weight = (m / s1.length + m / s2.length + (m - nTrans / 2) / m) / 3
  if (weight > 0.7) {
    let l = 0
    while (s1[l] === s2[l] && l < 4) l++
    weight = weight + l * 0.1 * (1 - weight)
  }
  return weight
}
