export function reciprocalRankFusion<T extends { id: string }>(
  lists: T[][],
  k = 60
): Array<T & { rrfScore: number }> {
  const scores = new Map<string, { item: T; score: number }>();
  for (const list of lists) {
    list.forEach((item, index) => {
      const add = 1 / (k + index + 1);
      const existing = scores.get(item.id);
      if (existing) {
        existing.score += add;
      } else {
        scores.set(item.id, { item, score: add });
      }
    });
  }
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({ ...entry.item, rrfScore: entry.score }));
}
