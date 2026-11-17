import { createClient } from "@/lib/supabase/server";

export const TEAMS = [
  { key: "1", label: "1. Herren" },
  { key: "2", label: "2. Herren" },
  { key: "3", label: "3. Herren" },
  { key: "7er", label: "7er" },
] as const;

export function teamLabel(key: string) {
  return TEAMS.find((t) => t.key === key)?.label ?? key;
}

export const COMPETITION_TYPES: Record<string, string> = {
  "1": "Meisterschaft",
  "308": "Pokal",
  "70": "Freundschaftsspiel",
  "300": "Turnier",
  "305": "Spielnachmittag",
};

type Row = Record<string, any>;

/** Reads all rows of a query, page by page (Supabase returns at most 1000 rows per request). */
export async function fetchAll<T extends Row = Row>(
  build: (sb: Awaited<ReturnType<typeof createClient>>) => any,
): Promise<T[]> {
  const sb = await createClient();
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(sb).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export async function getSeasons(): Promise<string[]> {
  const rows = await fetchAll<{ season: string }>((sb) => sb.from("v_seasons").select("season"));
  return rows.map((r) => r.season).sort((a, b) => seasonSortKey(b) - seasonSortKey(a));
}

/** "26/27" -> 2026, "99/00" -> 1999 */
export function seasonSortKey(s: string) {
  const y = parseInt(s.slice(0, 2), 10);
  return y >= 90 ? 1900 + y : 2000 + y;
}

export async function pickSeason(requested?: string) {
  const seasons = await getSeasons();
  const season = requested && seasons.includes(requested) ? requested : seasons[0];
  return { seasons, season };
}

export function fullName(r: { first_name?: string; last_name?: string }) {
  return `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
}

export function fmtDate(d?: string | null) {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}.${m}.${y}`;
}
