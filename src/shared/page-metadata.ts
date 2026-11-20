const MAX_PAGE_URL_CHARACTERS = 2_000;
const MAX_PAGE_TITLE_CHARACTERS = 300;

/** Shorten a string to at most `limit` Unicode code points. */
export function truncateCharacters(value: string, limit: number): string {
  return value.length <= limit ? value : [...value].slice(0, limit).join('');
}

/** Fit a Page URL and title into their stored lengths. */
export function storedPageMetadata(url: string, title: string) {
  return {
    url: truncateCharacters(url, MAX_PAGE_URL_CHARACTERS),
    title: truncateCharacters(title, MAX_PAGE_TITLE_CHARACTERS),
  };
}
