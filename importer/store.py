"""Load fetched exports (an output folder with manifest.json) into PostgreSQL."""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import psycopg

from . import parsers
from .dfbnet import REPORT_APPEARANCES, REPORT_GOALS, REPORT_RED, REPORT_YELLOW

log = logging.getLogger(__name__)
SCHEMA = Path(__file__).resolve().parent.parent / "db" / "schema.sql"


def migrate(conn: psycopg.Connection):
    conn.execute(SCHEMA.read_text())


def load_folder(conn: psycopg.Connection, out_dir: Path, club_pattern: str) -> dict:
    manifest = json.loads((out_dir / "manifest.json").read_text())
    items = [{"entry": f["entry"], "report": f["report"], "filename": f.get("filename"),
              "text": (out_dir / f["path"]).read_text(encoding="utf-8")} for f in manifest["files"]]
    return load_items(conn, manifest["catalog"], items, club_pattern, store_raw=True)


def reprocess(conn: psycopg.Connection, club_pattern: str) -> dict:
    """Rebuild all tables from the raw exports stored in the database (no DFBnet access)."""
    catalog = [
        {"fixture_list_id": r[0], "season": r[1], "competition_type": r[2], "fixture_list_name": r[3],
         "team_id": r[4], "team_name": r[5]}
        for r in conn.execute("select fixture_list_id, season, competition_type, name, team_id, team_name from competitions")
    ]
    by_id = {e["fixture_list_id"]: e for e in catalog}
    items = [
        {"entry": by_id[fl], "report": report, "filename": filename, "text": content}
        for fl, report, filename, content in conn.execute(
            "select fixture_list_id, report, filename, content from raw_exports")
        if fl in by_id
    ]
    log.info("Reprocessing %d stored exports", len(items))
    return load_items(conn, catalog, items, club_pattern, store_raw=False)


def _same_team(a: str, b: str) -> bool:
    return " ".join(a.lower().split()) == " ".join(b.lower().split())


def load_items(conn: psycopg.Connection, catalog: list[dict], items: list[dict], club_pattern: str,
               store_raw: bool) -> dict:
    ours = re.compile(club_pattern, re.I)
    stats = {"competitions": 0, "appearances": 0, "yellow": 0, "red": 0, "goals": 0}

    apps: dict[tuple[str, str], parsers.Appearance] = {}
    with conn.transaction(), conn.cursor() as cur:
        cur.executemany(
            """insert into competitions (fixture_list_id, season, competition_type, name, team_id, team_name)
               values (%s,%s,%s,%s,%s,%s)
               on conflict (fixture_list_id) do update set season=excluded.season,
                 competition_type=excluded.competition_type, name=excluded.name,
                 team_id=excluded.team_id, team_name=excluded.team_name, updated_at=now()""",
            [(e["fixture_list_id"], e["season"], e["competition_type"], e["fixture_list_name"],
              e["team_id"], e["team_name"]) for e in catalog])
        stats["competitions"] = len(catalog)

        for f in items:
            e, report, text = f["entry"], f["report"], f["text"]
            fl, season, comp = e["fixture_list_id"], e["season"], e["fixture_list_name"]
            if store_raw:
                cur.execute(
                    """insert into raw_exports (fixture_list_id, report, filename, content) values (%s,%s,%s,%s)
                       on conflict (fixture_list_id, report) do update set content=excluded.content,
                         filename=excluded.filename, fetched_at=now()""",
                    (fl, report, f.get("filename"), text))

            if report == REPORT_APPEARANCES:
                # The same team-season data comes with every competition of the team: de-duplicate.
                # The export also lists a player's matches for other clubs (before a transfer): skip those.
                for a in parsers.parse_appearances(text):
                    if ours.search(a.club_team):
                        apps[(a.pass_nr, a.match_id)] = a
            elif report == REPORT_YELLOW:
                rows = [t for t in parsers.parse_yellow(text) if ours.search(t.team)]
                cur.execute("delete from yellow_tallies where fixture_list_id=%s", (fl,))
                cur.executemany(
                    "insert into yellow_tallies values (%s,%s,%s,%s,%s,%s,%s,%s,%s) on conflict do nothing",
                    [(season, fl, comp, t.team, t.last_name, t.first_name, t.shirt_no, t.card_dates, t.ban_marks)
                     for t in rows])
                stats["yellow"] += len(rows)
            elif report == REPORT_RED:
                # The export contains the red cards of all our teams: keep only this competition's team.
                rows = [c for c in parsers.parse_red(text) if _same_team(c.team, e["team_name"])]
                cur.execute("delete from red_cards where fixture_list_id=%s", (fl,))
                cur.executemany(
                    """insert into red_cards (season, fixture_list_id, competition, matchday, team, kind,
                         last_name, first_name, shirt_no) values (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    [(season, fl, comp, c.matchday, c.team, c.kind, c.last_name, c.first_name, c.shirt_no)
                     for c in rows])
                stats["red"] += len(rows)
            elif report == REPORT_GOALS:
                rows = parsers.parse_goals(text)
                if e["competition_type"] != "1":  # friendlies/cups: league-wide lists are huge, keep ours only
                    rows = [g for g in rows if ours.search(g.team)]
                merged: dict[tuple, list] = {}
                for g in rows:
                    k = (g.team, g.last_name, g.first_name)
                    if k in merged:
                        merged[k][7] += g.goals
                    else:
                        merged[k] = [season, fl, comp, g.team, g.last_name, g.first_name, g.shirt_no, g.goals]
                cur.execute("delete from goal_tallies where fixture_list_id=%s", (fl,))
                cur.executemany("insert into goal_tallies values (%s,%s,%s,%s,%s,%s,%s,%s)", list(merged.values()))
                stats["goals"] += len(merged)

        stats["appearances"] = _load_appearances(cur, list(apps.values()))
        # Remove other clubs' matches loaded by earlier versions.
        cur.execute("""delete from appearances a using matches m
                       where a.match_id = m.match_id and m.club_team !~* %s""", (club_pattern,))
        cur.execute("delete from matches where club_team !~* %s", (club_pattern,))
    return stats


def _load_appearances(cur, apps: list[parsers.Appearance]) -> int:
    players = {a.pass_nr: (a.pass_nr, a.last_name, a.first_name, a.nationality, a.fifa_nat) for a in apps}
    matches = {a.match_id: (a.match_id, a.season, a.kickoff_date, a.kickoff_time, a.competition, a.matchday,
                            a.club_team, a.home, a.away, a.half2_end) for a in apps}
    cur.executemany(
        """insert into players (pass_nr, last_name, first_name, nationality, fifa_nat) values (%s,%s,%s,%s,%s)
           on conflict (pass_nr) do update set last_name=excluded.last_name, first_name=excluded.first_name,
             nationality=excluded.nationality, fifa_nat=excluded.fifa_nat, updated_at=now()""",
        list(players.values()))
    cur.executemany(
        """insert into matches (match_id, season, kickoff_date, kickoff_time, competition, matchday, club_team,
             home, away, match_length) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
           on conflict (match_id) do update set kickoff_date=excluded.kickoff_date,
             kickoff_time=excluded.kickoff_time, competition=excluded.competition, matchday=excluded.matchday,
             home=excluded.home, away=excluded.away,
             match_length=coalesce(excluded.match_length, matches.match_length)""",
        list(matches.values()))
    cur.executemany(
        """insert into appearances (pass_nr, match_id, shirt_no, in_squad, played, minute_on, minute_off,
             minutes_real, minutes_norm, active, status) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
           on conflict (pass_nr, match_id) do update set shirt_no=excluded.shirt_no,
             in_squad=excluded.in_squad, played=excluded.played, minute_on=excluded.minute_on,
             minute_off=excluded.minute_off, minutes_real=excluded.minutes_real,
             minutes_norm=excluded.minutes_norm, active=excluded.active, status=excluded.status""",
        [(a.pass_nr, a.match_id, a.shirt_no, a.in_squad, a.played, a.minute_on, a.minute_off,
          a.minutes_real, a.minutes_norm, a.active, a.status) for a in apps])
    return len(apps)
