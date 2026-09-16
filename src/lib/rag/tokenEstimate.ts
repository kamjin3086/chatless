/** Rough token estimate: CJK ≈ 1 token, other ≈ 4 chars / token. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3040 && code <= 0x30ff)
    ) {
      cjk += 1;
    }
  }
  const rest = Math.max(0, text.length - cjk);
  return Math.max(1, cjk + Math.ceil(rest / 4));
}
