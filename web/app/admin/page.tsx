import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import ImportButton from "./ImportButton";

const STATUS: Record<string, string> = { ok: "OK", partial: "Teilweise", failed: "Fehler", running: "Läuft" };

function fmt(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString("de-DE", { timeZone: "Europe/Berlin" }) : "";
}

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!isAdmin(auth.user?.email)) notFound();

  const { data: runs } = await supabase
    .from("import_runs")
    .select("id, started_at, finished_at, mode, status, details")
    .order("started_at", { ascending: false })
    .limit(15);

  return (
    <main>
      <h1>Import aus DFBnet</h1>
      <p className="muted">Läuft automatisch jede Woche in der Nacht von Sonntag auf Montag. Hier manuell starten:</p>
      <div className="card">
        <ImportButton />
      </div>

      <h2>Letzte Läufe</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Start</th><th>Ende</th><th>Umfang</th><th>Status</th>
              <th className="num">Einsätze</th><th className="num">Gelb</th><th className="num">Rot</th><th className="num">Tore</th><th>Fehler</th>
            </tr>
          </thead>
          <tbody>
            {(runs ?? []).map((r) => (
              <tr key={r.id} className={r.status !== "ok" ? "highlight" : ""}>
                <td>{fmt(r.started_at)}</td>
                <td>{fmt(r.finished_at)}</td>
                <td>{r.mode === "full" ? "Alle Saisons" : "Aktuell"}</td>
                <td>{STATUS[r.status] ?? r.status}</td>
                <td className="num">{r.details?.appearances ?? ""}</td>
                <td className="num">{r.details?.yellow ?? ""}</td>
                <td className="num">{r.details?.red ?? ""}</td>
                <td className="num">{r.details?.goals ?? ""}</td>
                <td className="small">{r.details?.errors?.length ? `${r.details.errors.length} Exporte fehlgeschlagen` : r.details?.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Details und Logs: GitHub → fc-treptow/fct-stats → Actions → DFBnet import. Wenn das DFBnet-Passwort abläuft, das Secret DFBNET_PASSWORD
        dort aktualisieren.
      </p>
    </main>
  );
}
