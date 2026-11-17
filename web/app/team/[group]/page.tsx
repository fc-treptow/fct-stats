import Link from "next/link";
import { notFound } from "next/navigation";
import DataTable, { type Column } from "@/components/DataTable";
import FilterTabs from "@/components/FilterTabs";
import SeasonSelect from "@/components/SeasonSelect";
import { COMP_FILTERS, TEAMS, fetchAll, fmtDate, fullName, pickCompFilter, pickSeason, teamLabel } from "@/lib/data";

const COLUMNS: Column[] = [
  { key: "player", label: "Spieler", type: "player" },
  { key: "squad", label: "Kader", type: "num", title: "Auf dem Spielbericht (eingesetzt oder Bank)" },
  { key: "appearances", label: "Einsätze", type: "num" },
  { key: "starts", label: "Startelf", type: "num" },
  { key: "subbed_on", label: "Eingew.", type: "num" },
  { key: "subbed_off", label: "Ausgew.", type: "num" },
  { key: "minutes", label: "Minuten", type: "num" },
  { key: "minutes_pct", label: "% Min.", type: "pct", title: "Anteil an allen Spielminuten des Teams im gewählten Wettbewerb" },
  { key: "goals", label: "Tore", type: "num" },
  { key: "yellow_league", label: "Gelb Liga", type: "num", title: "Gelbe Karten in der Liga (Sperre nach jeder 5.)" },
  { key: "yellow_red", label: "G-Rot", type: "num" },
  { key: "red", label: "Rot", type: "num" },
];

type Row = Record<string, any>;

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ group: string }>;
  searchParams: Promise<{ season?: string; comp?: string }>;
}) {
  const { group } = await params;
  if (!TEAMS.some((t) => t.key === group)) notFound();
  const sp = await searchParams;
  const { seasons, season } = await pickSeason(sp.season);
  const filter = pickCompFilter(sp.comp);
  const cats = [...filter.categories];

  const [perCat, teamMatches, goals, yellow, red] = await Promise.all([
    fetchAll((sb) =>
      sb.from("v_player_season_cat").select("*").eq("season", season).eq("team_group", group).in("category", cats),
    ),
    fetchAll((sb) => sb.from("v_team_matches").select("*").eq("season", season).eq("team_group", group).in("category", cats)),
    fetchAll((sb) => sb.from("v_goals_cat").select("*").eq("season", season).eq("team_group", group).in("category", cats)),
    fetchAll((sb) =>
      sb.from("v_yellow_status").select("*").eq("season", season).eq("team_group", group).eq("competition_type", "1"),
    ),
    fetchAll((sb) => sb.from("v_red_cards").select("*").eq("season", season).eq("team_group", group)),
  ]);

  // One row per player, summed over the selected categories.
  const players = new Map<string, Row>();
  for (const r of perCat) {
    const p =
      players.get(r.pass_nr) ??
      { pass_nr: r.pass_nr, first_name: r.first_name, last_name: r.last_name, player: "", squad: 0, appearances: 0,
        starts: 0, subbed_on: 0, subbed_off: 0, minutes: 0, goals: 0, yellow_league: 0, yellow_red: 0, red: 0, ban_risk: false };
    for (const k of ["squad", "appearances", "starts", "subbed_on", "subbed_off", "minutes"]) p[k] += Number(r[k]);
    players.set(r.pass_nr, p);
  }
  for (const g of goals) {
    const p = players.get(g.pass_nr);
    if (p) p.goals += Number(g.goals);
  }
  for (const y of yellow) {
    const p = y.pass_nr && players.get(y.pass_nr);
    if (p) {
      p.yellow_league = Math.max(p.yellow_league, Number(y.yellow_cards));
      p.ban_risk = p.ban_risk || y.one_more_is_ban;
    }
  }
  const redShown = red.filter((r) => cats.includes(r.category));
  for (const r of redShown) {
    const p = r.pass_nr && players.get(r.pass_nr);
    if (p) p[r.kind === "R" ? "red" : "yellow_red"] += 1;
  }
  const possible = teamMatches.reduce((s, t) => s + Number(t.possible_minutes), 0);
  const matchCount = teamMatches.reduce((s, t) => s + Number(t.matches), 0);
  const rows: Row[] = [...players.values()]
    .filter((p) => p.squad > 0 || p.appearances > 0)
    .map((p) => ({ ...p, minutes_pct: possible ? Math.round((100 * p.minutes) / possible) : null }));

  const atRisk = yellow.filter((y) => y.one_more_is_ban);
  const redLeague = red.filter((r) => r.category === "league");
  const teamNames = [...new Set(teamMatches.map((t) => t.club_team))];
  const qs = (extra: Record<string, string>) =>
    "?" + new URLSearchParams({ season, comp: filter.key, ...extra }).toString();

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>{teamLabel(group)}</h1>
          <div className="muted small">{teamNames.join(" · ")}</div>
          <div className="tabs">
            {TEAMS.map((t) => (
              <Link key={t.key} href={`/team/${t.key}${qs({})}`} className={t.key === group ? "active" : ""}>
                {t.label}
              </Link>
            ))}
          </div>
        </div>
        <SeasonSelect seasons={seasons} season={season} />
      </div>

      <div className="grid">
        <div className="stat"><b>{matchCount}</b><span>Spiele ({filter.label})</span></div>
        <div className="stat"><b>{rows.filter((r) => r.appearances > 0).length}</b><span>eingesetzte Spieler</span></div>
        <div className="stat"><b>{rows.reduce((s, r) => s + r.goals, 0)}</b><span>Tore</span></div>
        <div className="stat"><b>{yellow.reduce((s, r) => s + Number(r.yellow_cards), 0)}</b><span>Gelbe Karten Liga</span></div>
        <div className="stat"><b>{redShown.length}</b><span>Rot / Gelb-Rot</span></div>
      </div>

      <h2>Kartenwarnung (Liga)</h2>
      {atRisk.length === 0 && redLeague.length === 0 ? (
        <div className="ok">Niemand ist eine Gelbe Karte von einer Sperre entfernt.</div>
      ) : (
        <div className="notice">
          {atRisk.length > 0 && (
            <>
              <h2>Nächste Gelbe = Sperre</h2>
              <ul>
                {atRisk.map((y) => (
                  <li key={y.last_name + y.first_name}>
                    {y.pass_nr ? <Link href={`/players/${encodeURIComponent(y.pass_nr)}`}>{fullName(y)}</Link> : fullName(y)}{" "}
                    – {y.yellow_cards} Gelbe (letzte am {fmtDate(y.last_card)}) · <span className="muted">{y.competition}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {redLeague.length > 0 && (
            <>
              <h2 style={{ marginTop: atRisk.length ? "1rem" : 0 }}>Rote und Gelb-Rote Karten</h2>
              <ul>
                {redLeague.map((r, i) => (
                  <li key={i}>
                    {r.pass_nr ? <Link href={`/players/${encodeURIComponent(r.pass_nr)}`}>{fullName(r)}</Link> : fullName(r)} –{" "}
                    {r.kind === "R" ? "Rot" : "Gelb-Rot"}
                    {r.matchday ? `, ${r.matchday}. Spieltag` : ""} · <span className="muted">{r.competition}</span>
                  </li>
                ))}
              </ul>
              <p className="muted small">Die Sperrdauer bei Rot steht nicht im DFBnet-Export, siehe DFBnet „Offene Sperren“.</p>
            </>
          )}
        </div>
      )}

      <div className="page-head" style={{ marginTop: "1.75rem", marginBottom: "0.75rem" }}>
        <h2 style={{ margin: 0 }}>Kader {season}</h2>
        <FilterTabs param="comp" value={filter.key} options={COMP_FILTERS.map((f) => ({ key: f.key, label: f.label }))} />
      </div>
      <DataTable
        columns={COLUMNS}
        rows={rows}
        defaultSort={{ key: "minutes", desc: true }}
        rowClass="ban_risk"
        search
        empty="Keine Einsätze in dieser Saison."
      />
      <p className="muted small">
        Kader = auf dem Spielbericht (eingesetzt oder Bank). % Min. = Anteil an allen Spielminuten des Teams ({matchCount} Spiele) im
        gewählten Wettbewerb. Gelb markiert: nächste Gelbe Karte in der Liga bedeutet Sperre (Sperre nach jeder 5. Gelben).
        Ü32/Altliga-Spiele zählen nicht zur 1. Herren.
      </p>
    </main>
  );
}
