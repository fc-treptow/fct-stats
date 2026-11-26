// Per-game view of a player profile: all matches of one team in one season, with the player's
// role, minutes and cards in each. Pure functions (no Supabase), so they can be tested alone.
import { fmtDate, matchCategory, matchTeamGroup } from "./data";

type Row = Record<string, any>;

export const CATEGORY_LABELS: Record<string, string> = { league: "Liga", cup: "Pokal", friendly: "Freundschaftsspiel" };

/** Teams (team_group) of a player in a season, most games first: appearances, then Kader. */
export function teamsBySeason(seasonRows: Row[], season: string) {
  const teams = new Map<string, { group: string; clubTeams: string[]; appearances: number; squad: number }>();
  for (const r of seasonRows) {
    if (r.season !== season) continue;
    const t = teams.get(r.team_group) ?? { group: r.team_group, clubTeams: [] as string[], appearances: 0, squad: 0 };
    t.clubTeams.push(r.club_team);
    t.appearances += Number(r.appearances ?? 0);
    t.squad += Number(r.squad ?? 0);
    teams.set(r.team_group, t);
  }
  const all = [...teams.values()];
  const used = all.filter((t) => t.appearances > 0 || t.squad > 0);
  return (used.length ? used : all).sort((a, b) => b.appearances - a.appearances || b.squad - a.squad);
}

export type Game = {
  date: string; // ISO, for sorting
  datum: string;
  wettbewerb: string;
  gegner: string;
  einsatz: string;
  von_bis: string;
  minutes: number | null;
  yellow: number | null;
  yellow_red: number | null;
  red: number | null;
  not_in_squad: boolean;
};

/**
 * matches: the season's matches of our club teams (any group; filtered to `group` here).
 * personMatches: the player's person_matches rows. yellow: his v_yellow_status rows (with card_dates).
 * red: his v_red_cards rows. Cards that cannot be pinned to one of the matches end up in `unmatched`.
 */
export function buildGames(group: string, matches: Row[], personMatches: Row[], yellow: Row[], red: Row[]) {
  const ours = matches
    .filter((m) => matchTeamGroup(m.club_team, m.competition) === group)
    .sort((a, b) => `${a.kickoff_date} ${a.kickoff_time ?? ""}`.localeCompare(`${b.kickoff_date} ${b.kickoff_time ?? ""}`));
  const clubTeams = new Set(ours.map((m) => m.club_team));
  const pm = new Map(personMatches.map((a) => [a.match_id, a]));
  const cards = new Map<string, { yellow: number; yellow_red: number; red: number }>();
  const unmatched: string[] = [];
  const addCard = (matchId: string, k: "yellow" | "yellow_red" | "red") => {
    const c = cards.get(matchId) ?? { yellow: 0, yellow_red: 0, red: 0 };
    c[k] += 1;
    cards.set(matchId, c);
  };

  // Yellow cards come as dates per competition: the team's match of that category on that date.
  for (const y of yellow) {
    if (!clubTeams.has(y.team)) continue;
    const cat = y.competition_type === "1" ? "league" : y.competition_type === "308" ? "cup" : null;
    for (const d of y.card_dates ?? []) {
      const hits = ours.filter(
        (m) => m.club_team === y.team && m.kickoff_date === d && (!cat || matchCategory(m.competition) === cat),
      );
      if (hits.length === 1) addCard(hits[0].match_id, "yellow");
      else unmatched.push(`Gelb am ${fmtDate(d)} (${y.competition})`);
    }
  }
  // Red and yellow-red cards come with a matchday: the team's match of that category and matchday.
  for (const r of red) {
    if (!clubTeams.has(r.team)) continue;
    const kind = r.kind === "R" ? "red" : "yellow_red";
    const hits = r.matchday
      ? ours.filter(
          (m) => m.club_team === r.team && m.matchday === r.matchday && matchCategory(m.competition) === r.category,
        )
      : [];
    if (hits.length === 1) addCard(hits[0].match_id, kind);
    else unmatched.push(`${kind === "red" ? "Rot" : "Gelb-Rot"}${r.matchday ? `, ${r.matchday}. Spieltag` : ""} (${r.competition})`);
  }

  const games: Game[] = ours.map((m) => {
    const a = pm.get(m.match_id);
    const cat = matchCategory(m.competition);
    const home = m.home === m.club_team;
    const played = !!a?.played;
    const c = cards.get(m.match_id);
    return {
      date: m.kickoff_date,
      datum: fmtDate(m.kickoff_date),
      wettbewerb: `${CATEGORY_LABELS[cat]}${!m.matchday || cat === "friendly" ? "" : cat === "cup" ? `, Runde ${m.matchday}` : `, ${m.matchday}. ST`}`,
      gegner: `${home ? m.away : m.home} (${home ? "H" : "A"})`,
      einsatz: played ? (Number(a.minute_on) <= 1 ? "Startelf" : "eingewechselt") : a?.in_squad ? "Bank" : "–",
      von_bis: played && a.minute_on != null && a.minute_off != null ? `${Math.max(Number(a.minute_on), 1)}.–${a.minute_off}.` : "",
      minutes: played ? Number(a.minutes_real ?? 0) : null,
      yellow: c?.yellow || null,
      yellow_red: c?.yellow_red || null,
      red: c?.red || null,
      not_in_squad: !a?.in_squad && !played,
    };
  });
  return { games, unmatched };
}
