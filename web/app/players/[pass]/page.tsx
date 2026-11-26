import { notFound, redirect } from "next/navigation";
import DataTable, { type Column } from "@/components/DataTable";
import Flag from "@/components/Flag";
import { COMPETITION_TYPES, fetchAll, fmtDate, fullName, getNationalities, seasonSortKey, teamLabel } from "@/lib/data";

const SEASON_COLUMNS: Column[] = [
  { key: "season", label: "Saison" },
  { key: "team", label: "Team" },
  { key: "squad", label: "Kader", type: "num" },
  { key: "appearances", label: "Einsätze", type: "num" },
  { key: "starts", label: "Startelf", type: "num" },
  { key: "minutes", label: "Minuten", type: "num" },
  { key: "minutes_pct", label: "% Min.", type: "pct" },
  { key: "goals_league", label: "Tore Liga", type: "num" },
  { key: "goals_all", label: "Tore ges.", type: "num" },
  { key: "yellow", label: "Gelb", type: "num" },
  { key: "yellow_red", label: "G-Rot", type: "num" },
  { key: "red", label: "Rot", type: "num" },
];

export default async function PlayerPage({ params }: { params: Promise<{ pass: string }> }) {
  const pass = decodeURIComponent((await params).pass);
  const [seasons, yellow, red, totals, nat] = await Promise.all([
    fetchAll((sb) => sb.from("v_squad").select("*").eq("pass_nr", pass)),
    fetchAll((sb) => sb.from("v_yellow_status").select("*").eq("pass_nr", pass)),
    fetchAll((sb) => sb.from("v_red_cards").select("*").eq("pass_nr", pass)),
    fetchAll((sb) => sb.from("v_player_totals").select("pass_numbers").eq("pass_nr", pass)),
    getNationalities(),
  ]);
  if (seasons.length === 0) {
    // An older pass number of a player: go to the merged profile.
    const ids = await fetchAll((sb) => sb.from("v_player_identity").select("person_id").eq("pass_nr", pass));
    if (ids[0] && ids[0].person_id !== pass) redirect(`/players/${encodeURIComponent(ids[0].person_id)}`);
    notFound();
  }
  const passNumbers: string = totals[0]?.pass_numbers ?? pass;
  const nationality = nat.get(pass) ?? null;

  const p = seasons[0];
  const active = seasons.filter((r) => r.squad > 0 || r.appearances > 0 || r.goals_all > 0 || r.yellow > 0);
  const rows = (active.length ? active : seasons)
    .map((r: any) => ({ ...r, team: `${teamLabel(r.team_group)} (${r.club_team})`, sortKey: seasonSortKey(r.season) }) as any)
    .sort((a, b) => b.sortKey - a.sortKey);
  const sum = (k: string) => seasons.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const currentYellow = yellow
    .filter((y) => y.season === rows[0].season)
    .sort((a, b) => b.yellow_cards - a.yellow_cards);

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>
            <Flag nationality={nationality} />
            {fullName(p)}
          </h1>
          <div className="muted small">
            {nationality ? `${nationality} · ` : ""}
            {passNumbers.includes(",") ? "Passnummern" : "Passnummer"} {passNumbers} · Saisons {rows[rows.length - 1].season} – {rows[0].season}
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="stat"><b>{sum("appearances")}</b><span>Einsätze</span></div>
        <div className="stat"><b>{sum("minutes").toLocaleString("de-DE")}</b><span>Minuten</span></div>
        <div className="stat"><b>{sum("goals_all")}</b><span>Tore</span></div>
        <div className="stat"><b>{sum("yellow")}</b><span>Gelbe Karten</span></div>
        <div className="stat"><b>{sum("red") + sum("yellow_red")}</b><span>Rot / Gelb-Rot</span></div>
      </div>

      {currentYellow.length > 0 && (
        <>
          <h2>Gelbe Karten {rows[0].season}</h2>
          <div className={currentYellow.some((y) => y.one_more_is_ban) ? "notice" : "card"}>
            <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
              {currentYellow.map((y) => (
                <li key={y.competition}>
                  {y.competition} ({COMPETITION_TYPES[y.competition_type] ?? ""}): <b>{y.yellow_cards}</b> Gelbe
                  {y.one_more_is_ban ? " – nächste Gelbe = Sperre" : ""} · letzte am {fmtDate(y.last_card)}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <h2>Saisons</h2>
      <DataTable columns={SEASON_COLUMNS} rows={rows} defaultSort={{ key: "sortKey", desc: true }} />

      {red.length > 0 && (
        <>
          <h2>Platzverweise</h2>
          <div className="card">
            <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
              {red.map((r, i) => (
                <li key={i}>
                  {r.season}: {r.kind === "R" ? "Rot" : "Gelb-Rot"}
                  {r.matchday ? `, ${r.matchday}. Spieltag` : ""} · {r.competition}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </main>
  );
}
