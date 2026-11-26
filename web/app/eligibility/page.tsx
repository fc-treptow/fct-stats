import DataTable, { type Column } from "@/components/DataTable";
import { createClient } from "@/lib/supabase/server";
import { NAT_COLUMN, fmtDate, fullName, getNationalities, withNationality } from "@/lib/data";
import {
  RULE,
  berlinToday,
  isIsoDate,
  lastSunday,
  nextSunday,
  opponent,
  type CountingMatch,
  type EligibilityRow,
} from "@/lib/eligibility";
import CopyMessage from "./CopyMessage";

const FREE_COLUMNS: Column[] = [
  NAT_COLUMN,
  { key: "player", label: "Spieler", type: "player" },
  { key: "apps_higher", label: "Einsätze 1.", type: "num", title: "Einsätze für die 1. Herren in dieser Saison" },
  { key: "last_higher_fmt", label: "Letzter Einsatz 1.", title: "Letzter Einsatz für die 1. Herren" },
  { key: "apps_lower", label: "Pflichtspiele 3.", type: "num", title: "Liga- und Pokaleinsätze für die 3. Herren" },
];

const LOCKED_COLUMNS: Column[] = [
  NAT_COLUMN,
  { key: "player", label: "Spieler", type: "player" },
  { key: "reason", label: "Eingesetzt in" },
  { key: "apps_higher", label: "Einsätze 1.", type: "num", title: "Einsätze für die 1. Herren in dieser Saison" },
  { key: "apps_lower", label: "Pflichtspiele 3.", type: "num", title: "Liga- und Pokaleinsätze für die 3. Herren" },
];

function shortDate(d: string) {
  return fmtDate(d).slice(0, 6);
}

function fmtTs(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : "–";
}

export default async function EligibilityPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const requested = (await searchParams).date;
  const matchDate = isIsoDate(requested) ? requested : nextSunday();
  const sb = await createClient();

  const [countingRes, playersRes, importRes, nat] = await Promise.all([
    sb.rpc("eligibility_counting_matches", { p_higher: RULE.higher, p_date: matchDate }),
    sb.rpc("eligibility", { p_higher: RULE.higher, p_lower: RULE.lower, p_date: matchDate }),
    sb.from("import_runs").select("finished_at").eq("status", "ok").order("finished_at", { ascending: false }).limit(1),
    getNationalities(),
  ]);
  const error = countingRes.error ?? playersRes.error;
  const counting = ((countingRes.data ?? []) as CountingMatch[]).slice().sort((a, b) => b.kickoff_date.localeCompare(a.kickoff_date));
  const players = withNationality((playersRes.data ?? []) as EligibilityRow[], nat);

  const lastImport: string | null = importRes.data?.[0]?.finished_at ?? null;
  const lastImportDay = lastImport ? berlinToday(new Date(lastImport)) : null;
  // The weekend's matches arrive with the Sunday-night import. Older data may miss the last matchday.
  const stale = !lastImportDay || lastImportDay <= lastSunday();

  const countingLabels = counting.map((m) => `${shortDate(m.kickoff_date)} vs ${opponent(m)}`);
  const free = players
    .filter((p) => !p.locked)
    .sort((a, b) => b.apps_higher - a.apps_higher || a.last_name.localeCompare(b.last_name, "de"))
    .map((p) => ({ ...p, player: "", last_higher_fmt: fmtDate(p.last_higher) }));
  const locked = players
    .filter((p) => p.locked)
    .sort((a, b) => a.last_name.localeCompare(b.last_name, "de"))
    .map((p) => ({
      ...p,
      player: "",
      reason: p.locking.map((l) => `${shortDate(l.date)} vs ${opponent(l)} (${l.minutes ?? "?"}′)`).join(", "),
    }));

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Einsatzcheck 1. → 3. Herren</h1>
          <div className="muted small">
            Wer aus dem Kader der 1. Herren darf im nächsten Spiel der 3. Herren eingesetzt werden?
          </div>
        </div>
        <form className="season-select" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <label>
            Spiel der 3. Herren am{" "}
            <input type="date" name="date" defaultValue={matchDate} className="btn btn-small" />
          </label>
          <button className="btn btn-small">Prüfen</button>
        </form>
      </div>

      {error && <p className="alert">Daten konnten nicht geladen werden: {error.message}</p>}

      <div className={stale ? "notice" : "ok"} style={{ marginBottom: "1rem" }}>
        <strong>Datenstand: Import vom {fmtTs(lastImport)}.</strong>{" "}
        {stale
          ? "Spiele vom letzten Wochenende fehlen möglicherweise noch. Bitte den Import abwarten (läuft in der Nacht von Sonntag auf Montag) oder unter „Import“ starten lassen."
          : "Spiele bis einschließlich zum letzten Wochenende sind enthalten."}
      </div>

      <div className="card">
        <strong>Diese Spiele der 1. Herren zählen:</strong>{" "}
        {countingLabels.length ? countingLabels.join(" · ") : "noch keine Pflichtspiele in dieser Saison"}
        <div className="muted small" style={{ marginTop: "0.4rem" }}>
          Festgespielt ist, wer in mindestens einem der letzten zwei tatsächlich ausgetragenen Pflichtspiele (Liga/Pokal) der
          1. Herren vor dem Spieltag eingesetzt wurde. Bank zählt nicht, Freundschaftsspiele zählen nicht. Bis zu {RULE.maxLocked}{" "}
          festgespielte Spieler dürfen trotzdem eingesetzt werden ({RULE.reference}).
        </div>
      </div>

      <div className="grid" style={{ margin: "1rem 0" }}>
        <div className="stat"><b>{free.length}</b><span>frei einsetzbar</span></div>
        <div className="stat"><b>{locked.length}</b><span>festgespielt</span></div>
        <div className="stat"><b>max. {RULE.maxLocked}</b><span>davon einsetzbar</span></div>
      </div>

      <h2>✅ Frei einsetzbar ({free.length})</h2>
      <DataTable
        columns={FREE_COLUMNS}
        rows={free}
        defaultSort={{ key: "apps_higher", desc: true }}
        empty="Keine Spieler."
      />

      <h2>⛔ Festgespielt – max. {RULE.maxLocked} einsetzbar ({locked.length})</h2>
      <DataTable columns={LOCKED_COLUMNS} rows={locked} defaultSort={{ key: "player" }} empty="Keine festgespielten Spieler." />

      <h2>Nachricht für die Gruppe</h2>
      <CopyMessage
        matchDate={fmtDate(matchDate)}
        counting={countingLabels}
        free={free.map((p) => ({ name: fullName(p), apps: p.apps_higher }))}
        locked={locked.map((p) => ({ name: fullName(p), apps: p.apps_higher, reason: p.reason }))}
        maxLocked={RULE.maxLocked}
      />

      <p className="muted small">
        Liste: alle Spieler mit mindestens einem Einsatz für die 1. Herren in dieser Saison. Nicht geprüft: Einsätze für die 2. Herren,
        Sperren (Gelb/Rot), Spielberechtigung und Sperrvermerke – siehe DFBnet „Offene Sperren“ und „Spielberechtigungsliste“. Die
        Verantwortung für die Aufstellung liegt beim Verein.
      </p>
    </main>
  );
}
