export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem('edge-comments:' + key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem('edge-comments:' + key, value);
  } catch {
    // The widget also works when browser storage is unavailable.
  }
}
