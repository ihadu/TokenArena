export function buildUsageHref(
  currentSearch: string,
  updates: Record<string, string | null>,
  basePath = "/usage",
) {
  const next = new URLSearchParams(currentSearch);

  for (const [key, value] of Object.entries(updates)) {
    if (!value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }

  const query = next.toString();

  return query ? `${basePath}?${query}` : basePath;
}
