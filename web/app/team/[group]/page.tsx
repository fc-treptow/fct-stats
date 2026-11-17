import Link from "next/link";
import { notFound } from "next/navigation";
import DataTable, { type Column } from "@/components/DataTable";
import SeasonSelect from "@/components/SeasonSelect";
import { TEAMS, fetchAll, fmtDate, fullName, pickSeason, teamLabel } from "@/lib/data";

const COLUMNS: Column[] = [
  { key: "player", label: "Spieler", type: "player" },
  { key: "squad", label: "Kader", type: "num", title: "Auf dem Spielbericht" },
  { key: "appearances", label: "Einsätze", type: "num" },
  { key: "starts", label: "Startelf", type: "num" },
  { key: "subbed_on", label: "Eingew.", type: "num" },
  { key: "subbed_off", label: "Ausgew.", type: "num" },
  { key: "minutes", label: "Minuten", type: "num" },
  { key: "minutes_pct", label: "% Min.", type: "pct", title: "Anteil der möglichen Spielminuten" },
  { key: "goals_league", label: "Tore Liga", type: "num" },
  { key: "goals_all", label: "Tore ges.", type: "num" },
  { key: "yellow_league", label: "Gelb Liga", type: "num" },
  { key: "yellow_red", label: "G-Rot", type: "num" },
  { key: "red", label: "Rot", type: "num" },
];

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ group: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { group } = await params;
  if (!TEAMS.some((t) => t.key === group)) notFound();
  const { seasons, season } = await pickSeason((await searchParams).season);

  const [squad, yellow, red] = await Promise.all([
    fetchAll((sb) => sb.from("v_squad").select("*").eq("season", season).eq("team_group", group)),
    fetchAll((sb) =>
      sb.from("v_yellow_status").select("*").eq("season", season).eq("team_group", group).eq("competition_type", "1"),
    ),
    fetchAll((sb) => sb.from("v_red_cards").select("*").eq("season", season).eq("team_group", group)),
  ]);

  const used = squad.filter((r) => r.squad > 0 || r.appearances > 0);
  const atRisk = yellow.filter((y) => y.one_more_is_ban);
  const competitions = [...new Set(squad.map((r) => r.club_team))];
  const totals = {
    players: used.filter((r) => r.appearances > 0).length,
    goals: used.reduce((s, r) => s + Number(r.goals_league), 0),
    yellow: yellow.reduce((s, r) => s + Number(r.yellow_cards), 0),
    red: red.length,
  };

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>{teamLabel(group)}</h1>
          <div className="muted small">{competitions.join(" · ")}</div>
          <div className="tabs">
            {TEAMS.map((t) => (
              <Link key={t.key} href={`/team/${t.key}?season=${encodeURIComponent(season)}`} className={t.key === group ? "active" : ""}>
                {t.label}
              </Link>
            ))}
          </div>
        </div>
        <SeasonSelect seasons={seasons} season={season} />
      </div>

      <div className="grid">
        <div className="stat"><b>{totals.players}</b><span>eingesetzte Spieler</span></div>
        <div className="stat"><b>{totals.goals}</b><span>Tore Liga</span></div>
        <div className="stat"><b>{totals.yellow}</b><span>Gelbe Karten Liga</span></div>
        <div className="stat"><b>{totals.red}</b><span>Rot / Gelb-Rot</span></div>
      </div>

      <h2>Kartenwarnung</h2>
      {atRisk.length === 0 && red.length === 0 ? (
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
          {red.length > 0 && (
            <>
              <h2 style={{ marginTop: atRisk.length ? "1rem" : 0 }}>Rote und Gelb-Rote Karten</h2>
              <ul>
                {red.map((r, i) => (
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

      <h2>Kader {season}</h2>
      <DataTable
        columns={COLUMNS}
        rows={used.map((r) => ({ ...r, player: "" }))}
        defaultSort={{ key: "minutes", desc: true }}
        rowClass="ban_risk"
        search
        empty="Keine Einsätze in dieser Saison."
      />
      <p className="muted small">
        Einsätze und Minuten aus allen Wettbewerben (Liga, Pokal, Freundschaftsspiele). Gelb markiert: nächste Gelbe Karte in der Liga
        bedeutet Sperre (Sperre nach jeder 5. Gelben).
      </p>
    </main>
  );
}
