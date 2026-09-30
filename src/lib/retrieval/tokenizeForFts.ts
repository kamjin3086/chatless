export function fallbackTokenize(text: string): string {
  return text
    .replace(/([\u4e00-\u9fff])/g, ' $1 ')
    .replace(/[^\w\u4e00-\u9fff.+_-]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export async function tokenizeForFts(text: string): Promise<string> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const tokenized = await invoke<string>('tokenize_for_fts_command', { text });
    if (tokenized && tokenized.trim()) return tokenized;
  } catch {
    // tests / non-tauri
  }
  return fallbackTokenize(text);
}
