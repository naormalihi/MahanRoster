/** "גף פיד כחול" → "פיד כחול": the framework's own name, without the "גף" prefix. */
export function frameworkName(gaf: string | null | undefined): string {
  return (gaf ?? "").replace(/^גף\s+/, "").trim();
}
