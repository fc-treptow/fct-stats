import DataTable, { type Column } from "@/components/DataTable";
import { fetchAll, teamLabel } from "@/lib/data";

const COLUMNS: Column[] = [
  { key: "player", label: "Spieler", type: "player" },
  { key: "teams", label: "Teams" },
  { key: "first_season", label: "Erste Saison" },
  { key: "last_season", label: "Letzte Saison" },
  { key: "seasons", label: "Saisons", type: "num" },
  { key: "appearances", label: "Einsätze", type: "num" },
  { key: "minutes", label: "Minuten", type: "num" },
  { key: "goals", label: "Tore", type: "num" },
  { key: "yellow", label: "Gelb", type: "num" },
  { key: "red", label: "Rot", type: "num" },
];

export default async function PlayersPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const showAll = (await searchParams).all === "1";
  const rows = await fetchAll((sb) => {
    const q = sb.from("v_player_totals").select("*");
    return showAll ? q : q.gt("appearances", 0);
  });
  const data = rows.map((r) => ({
    ...r,
    player: "",
    teams: (r.team_groups ?? "").split(",").filter(Boolean).map(teamLabel).join(", "),
  }));
  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Spieler</h1>
          <div className="muted small">
            {data.length} Spieler seit 2012 ·{" "}
            {showAll ? <a href="/players">nur mit Einsätzen</a> : <a href="/players?all=1">auch ohne Einsatz anzeigen</a>}
          </div>
        </div>
      </div>
      <DataTable columns={COLUMNS} rows={data} defaultSort={{ key: "last_season", desc: true }} search />
    </main>
  );
}
