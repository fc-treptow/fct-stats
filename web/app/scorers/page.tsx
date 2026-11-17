import DataTable, { type Column } from "@/components/DataTable";
import SeasonSelect from "@/components/SeasonSelect";
import { fetchAll, pickSeason, teamLabel } from "@/lib/data";

const CLUB_COLUMNS: Column[] = [
  { key: "player", label: "Spieler", type: "player" },
  { key: "teams", label: "Team(s)" },
  { key: "goals_league", label: "Tore Liga", type: "num" },
  { key: "goals_all", label: "Tore ges.", type: "num" },
  { key: "appearances", label: "Einsätze", type: "num" },
  { key: "minutes_per_goal", label: "Min./Tor", type: "num" },
];

const LEAGUE_COLUMNS: Column[] = [
  { key: "league_rank", label: "Platz", type: "num" },
  { key: "player", label: "Spieler", type: "player" },
  { key: "team", label: "Verein" },
  { key: "goals", label: "Tore", type: "num" },
];

export default async function ScorersPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const { seasons, season } = await pickSeason((await searchParams).season);
  const [squad, league] = await Promise.all([
    fetchAll((sb) => sb.from("v_squad").select("*").eq("season", season).gt("goals_all", 0)),
    fetchAll((sb) => sb.from("v_scorers").select("*").eq("season", season).eq("competition_type", "1")),
  ]);

  // Club ranking: one row per player, summed over teams.
  const byPlayer = new Map<string, any>();
  for (const r of squad) {
    const p = byPlayer.get(r.pass_nr) ?? { ...r, goals_league: 0, goals_all: 0, appearances: 0, minutes: 0, teams: [] as string[] };
    p.goals_league += Number(r.goals_league);
    p.goals_all += Number(r.goals_all);
    p.appearances += Number(r.appearances);
    p.minutes += Number(r.minutes);
    p.teams.push(teamLabel(r.team_group));
    byPlayer.set(r.pass_nr, p);
  }
  const club = [...byPlayer.values()].map((p) => ({
    ...p,
    player: "",
    teams: [...new Set(p.teams)].join(", "),
    minutes_per_goal: p.goals_all ? Math.round(p.minutes / p.goals_all) : null,
  }));

  // League rankings: one per league competition in which our teams play.
  const leagues = new Map<string, any[]>();
  for (const r of league) {
    const list = leagues.get(r.competition) ?? [];
    list.push(r);
    leagues.set(r.competition, list);
  }
  const ourLeagues = [...leagues.entries()].filter(([, rows]) => rows.some((r) => r.is_ours));

  return (
    <main>
      <div className="page-head">
        <h1>Torschützen</h1>
        <SeasonSelect seasons={seasons} season={season} />
      </div>

      <h2>Vereinsintern {season}</h2>
      <DataTable columns={CLUB_COLUMNS} rows={club} defaultSort={{ key: "goals_all", desc: true }} search empty="Noch keine Tore." />

      {ourLeagues.map(([competition, rows]) => {
        const shown = rows.filter((r) => r.league_rank <= 10 || r.is_ours).map((r) => ({ ...r, player: "" }));
        return (
          <section key={competition}>
            <h2>{competition.replace("Meisterschaft - ", "")}</h2>
            <DataTable columns={LEAGUE_COLUMNS} rows={shown} defaultSort={{ key: "league_rank" }} rowClass="is_ours" />
          </section>
        );
      })}
      <p className="muted small">Ligaranglisten: Top 10 der Staffel plus alle FC Treptow Spieler (markiert).</p>
    </main>
  );
}
