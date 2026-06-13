/**
 * Storage seam: the save system speaks KVStorage, never localStorage
 * directly — engine tests run headless on the memory implementation.
 */
export interface KVStorage {
  get(key: string): string | null;
  /** May throw (quota) — the save system converts that into SaveError:STORAGE. */
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export function createMemoryStorage(): KVStorage {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
    keys: () => [...map.keys()],
  };
}

/** null = storage unavailable (private mode, disabled) — UI shows the banner. */
export function createLocalStorageAdapter(): KVStorage | null {
  try {
    const probe = "sichen.probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
  } catch {
    return null;
  }
  return {
    get: (key) => window.localStorage.getItem(key),
    set: (key, value) => window.localStorage.setItem(key, value),
    remove: (key) => window.localStorage.removeItem(key),
    keys: () => {
      const out: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key !== null) out.push(key);
      }
      return out;
    },
  };
}
