/**
 * Pastel 调色板与稳定颜色映射。
 * 同一 Tip 的 id 稳定映射到固定颜色，重渲染/重启/筛选/搜索均不变。
 */

export const PASTEL_TONES = [
  "pastel-butter",
  "pastel-peach",
  "pastel-rose",
  "pastel-lilac",
  "pastel-sky",
  "pastel-mint",
  "pastel-sage",
  "pastel-sand",
] as const;

export type PastelTone = (typeof PASTEL_TONES)[number];

/** FNV-1a 32 位稳定散列。 */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 根据 Tip id 返回稳定的 pastel tone。 */
export function pastelForTip(id: string): PastelTone {
  return PASTEL_TONES[stableHash(id) % PASTEL_TONES.length];
}

/** Tailwind 类名（bg-* 由 token 映射）。 */
export function pastelClass(tone: PastelTone): string {
  return `bg-${tone}`;
}
