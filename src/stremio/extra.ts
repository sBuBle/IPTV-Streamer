export interface CatalogExtra {
  search?: string;
  genre?: string;
  skip: number;
}

/** Parses the "extra" path segment Stremio appends to catalog requests, e.g. "search=kan&skip=100". */
export function parseExtra(segment: string | undefined): CatalogExtra {
  if (!segment) return { skip: 0 };
  const params = new URLSearchParams(segment);
  const skip = Number(params.get("skip") ?? 0);
  return {
    search: params.get("search")?.trim() || undefined,
    genre: params.get("genre")?.trim() || undefined,
    skip: Number.isFinite(skip) && skip > 0 ? Math.floor(skip) : 0,
  };
}
