import { vi } from 'vitest';

export function memorySession(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

/**
 * Put a location and a session store around the module under test.
 *
 * The rule reads the build's NODE_ENV, so a test that wants the stub on has to say which
 * build it is describing; inheriting the shell's value made these pass or fail by accident
 * (`NODE_ENV=production npx vitest run …` failed 3 of them).
 */
export function enterBrowser(search: string): void {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubGlobal('window', {
    location: { search },
    sessionStorage: memorySession(),
  });
}
