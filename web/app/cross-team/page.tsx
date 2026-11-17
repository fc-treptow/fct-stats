import DataTable, { type Column } from "@/components/DataTable";
import SeasonSelect from "@/components/SeasonSelect";
import { fetchAll, pickSeason } from "@/lib/data";

const COLUMNS: Column[] = [
  { key: "player", label: "Spieler", type: "player" },
  { key: "apps_1", label: "1. Herren", type: "num" },
  { key: "apps_2", label: "2. Herren", type: "num" },
  { key: "apps_3", label: "3. Herren", type: "num" },
  { key: "apps_7er", label: "7er", type: "num" },
  { key: "apps_total", label: "Gesamt", type: "num" },
  { key: "teams_used", label: "Teams", type: "num" },
];

export default async function CrossTeamPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const { seasons, season } = await pickSeason((await searchParams).season);
  const rows = await fetchAll((sb) => sb.from("v_cross_team").select("*").eq("season", season));
  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Teamübergreifende Einsätze</h1>
          <div className="muted small">Spieler mit Einsätzen in mehr als einem Team (alle Wettbewerbe).</div>
        </div>
        <SeasonSelect seasons={seasons} season={season} />
      </div>
      <DataTable
        columns={COLUMNS}
        rows={rows.map((r) => ({ ...r, player: "" }))}
        defaultSort={{ key: "apps_total", desc: true }}
        search
        empty="Keine teamübergreifenden Einsätze in dieser Saison."
      />
      <p className="muted small">
        Wichtig für die Spielberechtigung in unteren Mannschaften (Festspielen) – maßgeblich sind die Regeln in der BFV-Spielordnung.
      </p>
    </main>
  );
}
