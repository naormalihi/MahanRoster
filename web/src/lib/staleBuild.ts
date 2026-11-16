/**
 * A tab that still runs an older version after a deploy asks for files that are no longer on
 * the server (a lazily loaded page, the API module). index.html then shows the owl "updating"
 * screen and reloads into the new version.
 */
export const STALE_BUILD =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError|failed to load \S*\/assets\//i;

export const isStaleBuild = (message: string | null | undefined) => !!message && STALE_BUILD.test(message);

/** Shows the update screen and reloads; false when the page has no such screen (tests, demo tools). */
export function showUpdate(): boolean {
  const go = (window as unknown as { __appUpdate?: () => void }).__appUpdate;
  if (!go) return false;
  go();
  return true;
}
