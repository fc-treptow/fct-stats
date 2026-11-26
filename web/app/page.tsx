import Link from "next/link";
import DataTable, { type Column } from "@/components/DataTable";
import { TEAMS, fetchAll, fmtDate, matchCategory, matchTeamGroup, pickSeason, teamLabel } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { berlinToday, nextSunday, opponent } from "@/lib/eligibility";

// Start page: one card per men's team plus the alerts coaches check before a matchday.

const HOME_TEAMS = TEAMS.slice(0, 3);
const CLUB = /FC Treptow/i;
// Yellow-card bans (every 5th card) only count in the league (Meisterschaft), not in cup matches.
const LEAGUE_TYPE = "1";

const BAN_RISK_COLUMNS: Column[] = [
  { key: "player", label: "Spieler", type: "player" },
  { key: "team", label: "Team" },
  { key: "competition", label: "Wettbewerb" },
  { key: "yellow_cards", label: "Gelb", type: "num", title: "Gelbe Karten in diesem Wettbewerb" },
  { key: "last_card_fmt", label: "Letzte Gelbe" },
];

const RED_COLUMNS: Column[] = [
  { key: "player", label: "Spieler", type: "player" },
  { key: "team", label: "Team" },
  { key: "kind_label", label: "Karte" },
  { key: "competition", label: "Wettbewerb" },
  { key: "matchday", label: "Spieltag", type: "num" },
];

type Row = Record<string, any>;

function fmtTs(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : "–";
}

export default async function Home() {
  const { season } = await pickSeason();
  const today = berlinToday();
  const sunday = nextSunday(today);
  const groups: string[] = HOME_TEAMS.map((t) => t.key);
  const sb = await createClient();

  const [matches, yellow, red, imports] = await Promise.all([
    fetchAll<Row>((sb) =>
      sb
        .from("matches")
        .select("match_id, kickoff_date, competition, club_team, home, away")
        .eq("season", season)
        .lte("kickoff_date", today)
        .order("kickoff_date", { ascending: false }),
    ),
    fetchAll<Row>((sb) =>
      sb
        .from("v_yellow_status")
        .select("*")
        .eq("season", season)
        .eq("one_more_is_ban", true)
        .eq("competition_type", LEAGUE_TYPE)
        .in("team_group", groups)
        .not("pass_nr", "is", null),
    ),
    fetchAll<Row>((sb) => sb.from("v_red_cards").select("*").eq("season", season).in("team_group", groups)),
    sb.from("import_runs").select("finished_at").eq("status", "ok").order("finished_at", { ascending: false }).limit(1),
  ]);
  const lastImport: string | null = imports.data?.[0]?.finished_at ?? null;

  // League yellow exports cover the whole league: keep our players only.
  const banRisk = yellow
    .filter((y) => CLUB.test(y.team))
    .map((y): Row => ({ ...y, player: "", team: teamLabel(y.team_group), last_card_fmt: fmtDate(y.last_card) }))
    .sort((a, b) => a.team.localeCompare(b.team, "de") || a.last_name.localeCompare(b.last_name, "de"));
  const reds = red
    .filter((r) => CLUB.test(r.team))
    .map((r): Row => ({ ...r, player: "", team: teamLabel(r.team_group), kind_label: r.kind === "R" ? "Rot" : "Gelb-Rot" }));

  const teams = HOME_TEAMS.map((t) => {
    const own = matches.filter((m) => matchTeamGroup(m.club_team, m.competition) === t.key);
    const last = own[0] as { kickoff_date: string; competition: string; home: string | null; away: string | null } | undefined;
    const official = own.filter((m) => matchCategory(m.competition) !== "friendly");
    const risk = new Set(banRisk.filter((y) => y.team_group === t.key).map((y) => y.pass_nr)).size;
    return { ...t, last, played: own.length, official: official.length, risk };
  });

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Übersicht</h1>
          <div className="muted small">
            Saison {season} · Datenstand: Import vom {fmtTs(lastImport)}
          </div>
        </div>
        <form action="/players" className="home-search">
          <input name="q" className="search" placeholder="Spieler suchen…" aria-label="Spieler suchen" />
          <button className="btn btn-small">Suchen</button>
        </form>
      </div>

      <div className="team-cards">
        {teams.map((t) => (
          <Link key={t.key} href={`/team/${t.key}`} className="card team-card">
            <h2>{t.label}</h2>
            <div className="small">
              {t.last ? (
                <>
                  <span className="muted">Letztes Spiel:</span> {fmtDate(t.last.kickoff_date)} vs {opponent(t.last)}
                  <div className="muted">{t.last.competition}</div>
                </>
              ) : (
                <span className="muted">Noch keine Spiele in dieser Saison.</span>
              )}
            </div>
            <div className="team-card-stats">
              <span>
                <b>{t.official}</b> Pflichtspiele
              </span>
              <span>
                <b>{t.played}</b> Spiele gesamt
              </span>
              <span className={t.risk ? "risk" : ""}>
                <b>{t.risk}</b> vor Gelbsperre
              </span>
            </div>
            <span className="team-card-link">Zur Mannschaft →</span>
          </Link>
        ))}
      </div>

      <div className="card home-eligibility">
        <div>
          <strong>Einsatzcheck 1. → 3. Herren</strong>
          <div className="muted small">Wer aus der 1. Herren darf am Sonntag, {fmtDate(sunday)}, in der 3. Herren spielen?</div>
        </div>
        <Link href={`/eligibility?date=${sunday}`} className="btn btn-primary">
          Jetzt prüfen
        </Link>
      </div>

      <h2>⚠️ Gelbsperre droht ({banRisk.length})</h2>
      <p className="muted small">Spieler mit 4, 9, 14 … Gelben Karten in der Liga: Die nächste Gelbe bedeutet eine Sperre. Pokalspiele werden hier nicht mitgezählt.</p>
      <DataTable
        columns={BAN_RISK_COLUMNS}
        rows={banRisk}
        defaultSort={{ key: "team" }}
        empty="Aktuell droht niemandem eine Gelbsperre."
      />

      <h2>🟥 Platzverweise in dieser Saison ({reds.length})</h2>
      <DataTable columns={RED_COLUMNS} rows={reds} defaultSort={{ key: "team" }} empty="Keine Platzverweise in dieser Saison." />
      <p className="muted small">Die Sperrdauer steht nicht in den Exporten – siehe DFBnet „Offene Sperren“.</p>
    </main>
  );
}
