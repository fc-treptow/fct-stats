import { createClient } from "@/lib/supabase/server";

export const TEAMS = [
  { key: "1", label: "1. Herren" },
  { key: "2", label: "2. Herren" },
  { key: "3", label: "3. Herren" },
  { key: "7er", label: "7er" },
] as const;

const OTHER_TEAM_LABELS: Record<string, string> = { ue: "Ü32/Altliga" };

export function teamLabel(key: string) {
  return TEAMS.find((t) => t.key === key)?.label ?? OTHER_TEAM_LABELS[key] ?? key;
}

export const COMP_FILTERS = [
  { key: "league", label: "Nur Liga", categories: ["league"] },
  { key: "competitive", label: "Liga + Pokal", categories: ["league", "cup"] },
  { key: "all", label: "Alle inkl. Freundschaftsspiele", categories: ["league", "cup", "friendly"] },
] as const;

export function pickCompFilter(requested?: string) {
  return COMP_FILTERS.find((f) => f.key === requested) ?? COMP_FILTERS[1];
}

export const COMPETITION_TYPES: Record<string, string> = {
  "1": "Meisterschaft",
  "308": "Pokal",
  "70": "Freundschaftsspiel",
  "300": "Turnier",
  "305": "Spielnachmittag",
};

/** Table column with the player's country flag (rows need `nationality`, see withNationality). */
export const NAT_COLUMN = { key: "nationality", label: "Nat.", type: "flag", title: "Nationalität" } as const;

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

/** Mirrors match_team_group() in db/schema.sql: old-boys matches are recorded under the 1st team's name. */
export function matchTeamGroup(clubTeam: string, competition?: string | null) {
  if (/(Ü ?[0-9]{2}|altliga)/i.test(competition ?? "")) return "ue";
  if (/7er/i.test(clubTeam)) return "7er";
  if (/\bIII\b/i.test(clubTeam)) return "3";
  if (/\bII\b/i.test(clubTeam)) return "2";
  return "1";
}

/** Mirrors match_category() in db/schema.sql: league / cup / friendly from a match's competition label. */
export function matchCategory(competition?: string | null) {
  const c = competition ?? "";
  if (/pokal/i.test(c)) return "cup";
  if (/(FS\/|-FS|freundschaft|turnier|halle)/i.test(c)) return "friendly";
  return "league";
}

/** Nationality (DFBnet country name) per player, keyed by person id and by every pass number. */
export async function getNationalities(): Promise<Map<string, string>> {
  const rows = await fetchAll<{ pass_nr: string; person_id: string | null; nationality: string | null }>((sb) =>
    sb.from("players").select("pass_nr, person_id, nationality").not("nationality", "is", null),
  );
  const out = new Map<string, string>();
  // The person's own (most recent) pass number wins over older ones.
  for (const r of rows) if (r.person_id === r.pass_nr || !r.person_id) out.set(r.pass_nr, r.nationality!);
  for (const r of rows) {
    if (!out.has(r.pass_nr)) out.set(r.pass_nr, r.nationality!);
    if (r.person_id && !out.has(r.person_id)) out.set(r.person_id, r.nationality!);
  }
  return out;
}

/** Adds `nationality` to rows that have a pass_nr (rows of other clubs' players stay without). */
export function withNationality<T extends { pass_nr?: string | null }>(rows: T[], nat: Map<string, string>) {
  return rows.map((r) => ({ ...r, nationality: (r.pass_nr && nat.get(r.pass_nr)) || null }));
}
