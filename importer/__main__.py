"""fct-stats importer.

    python -m importer fetch --mode current|full --out out     # DFBnet -> CSV files + manifest.json
    python -m importer load  --out out                          # CSV files -> database
    python -m importer run   --mode current|full --out out     # both (load only if DATABASE_URL is set)
    python -m importer reprocess                                # rebuild tables from stored raw exports
    python -m importer migrate                                  # apply db/schema.sql only

Environment: DFBNET_USERNAME, DFBNET_PASSWORD, DATABASE_URL (optional), CLUB_PATTERN (default "FC Treptow").
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from dataclasses import asdict
from pathlib import Path

from . import dfbnet

log = logging.getLogger("importer")


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-")[:60]


def fetch(mode: str, out: Path, seasons: list[str] | None = None) -> dict:
    user, pw = os.environ.get("DFBNET_USERNAME"), os.environ.get("DFBNET_PASSWORD")
    if not user or not pw:
        sys.exit("DFBNET_USERNAME and DFBNET_PASSWORD must be set")
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    session = dfbnet.login(user, pw, debug_dir=out / "debug")
    flow = dfbnet.StatsFlow(session)

    all_seasons = flow.seasons()
    if seasons:
        wanted = [s for s in all_seasons if s in seasons]
    elif mode == "full":
        wanted = all_seasons
    else:
        wanted = all_seasons[:1]
    log.info("Seasons: %s", ", ".join(wanted))

    catalog = flow.catalog(wanted)
    log.info("Catalog: %d team/competition combinations", len(catalog))

    files, errors = [], []
    for report in dfbnet.REPORTS:
        for e in catalog:
            try:
                exported = flow.fetch(report, e)
            except Exception as exc:  # keep going, report at the end
                log.error("Failed %s %s / %s / %s: %s", report, e.season, e.team_name, e.fixture_list_name, exc)
                errors.append({"report": report, "entry": asdict(e), "error": str(exc)})
                continue
            for i, f in enumerate(exported):
                rel = Path(_slug(e.season)) / f"{_slug(e.team_name)}__{e.fixture_list_id}" / f"{report}{'-' + str(i) if i else ''}.csv"
                (out / rel).parent.mkdir(parents=True, exist_ok=True)
                (out / rel).write_text(f.text, encoding="utf-8")
                files.append({"report": report, "entry": asdict(e), "path": str(rel), "filename": f.filename})
        log.info("Report %s done (%d files total)", report, len(files))

    manifest = {"mode": mode, "seasons": wanted, "catalog": [asdict(e) for e in catalog],
                "files": files, "errors": errors, "seconds": round(time.time() - t0)}
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    log.info("Fetched %d files with %d errors in %ds", len(files), len(errors), manifest["seconds"])
    return manifest


def check(out: Path) -> dict:
    """Parse every fetched file and log row counts (no personal data) - catches format changes early."""
    from . import parsers
    fn = {dfbnet.REPORT_APPEARANCES: parsers.parse_appearances, dfbnet.REPORT_YELLOW: parsers.parse_yellow,
          dfbnet.REPORT_RED: parsers.parse_red, dfbnet.REPORT_GOALS: parsers.parse_goals}
    manifest = json.loads((out / "manifest.json").read_text())
    summary, problems = {}, []
    for f in manifest["files"]:
        try:
            rows = fn[f["report"]]((out / f["path"]).read_text(encoding="utf-8"))
        except Exception as exc:
            problems.append(f"{f['path']}: {exc}")
            continue
        key = f"{f['entry']['season']} | {f['entry']['team_name']} | {f['entry']['fixture_list_name']}"
        summary.setdefault(key, {})[f["report"]] = len(rows)
        if f["report"] == dfbnet.REPORT_APPEARANCES:
            summary[key]["played"] = sum(r.played for r in rows)
            summary[key]["matches"] = len({r.match_id for r in rows})
    for k, v in summary.items():
        log.info("check %s: %s", k, v)
    for p in problems:
        log.error("parse problem %s", p)
    if problems:
        sys.exit(f"{len(problems)} files could not be parsed")
    return summary


def reprocess() -> dict:
    import psycopg
    from . import store

    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as conn:
        store.migrate(conn)
        run_id = conn.execute("insert into import_runs (mode) values ('reprocess') returning id").fetchone()[0]
        stats = store.reprocess(conn, os.environ.get("CLUB_PATTERN", "FC Treptow"))
        conn.execute("update import_runs set finished_at=now(), status='ok', details=%s where id=%s",
                     (json.dumps(stats), run_id))
    log.info("Reprocessed: %s", stats)
    return stats


def load(out: Path, mode: str) -> dict:
    import psycopg
    from . import store

    url = os.environ["DATABASE_URL"]
    with psycopg.connect(url, autocommit=True) as conn:
        store.migrate(conn)
        run_id = conn.execute("insert into import_runs (mode) values (%s) returning id", (mode,)).fetchone()[0]
        try:
            stats = store.load_folder(conn, out, os.environ.get("CLUB_PATTERN", "FC Treptow"))
            manifest = json.loads((out / "manifest.json").read_text())
            status = "ok" if not manifest["errors"] else "partial"
            stats["errors"] = manifest["errors"]
        except Exception as exc:
            conn.execute("update import_runs set finished_at=now(), status='failed', details=%s where id=%s",
                         (json.dumps({"error": str(exc)}), run_id))
            raise
        conn.execute("update import_runs set finished_at=now(), status=%s, details=%s where id=%s",
                     (status, json.dumps(stats, ensure_ascii=False, default=str), run_id))
    log.info("Loaded: %s", {k: v for k, v in stats.items() if k != "errors"})
    return stats


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(prog="importer")
    ap.add_argument("command", choices=["fetch", "load", "run", "reprocess", "migrate"])
    ap.add_argument("--mode", choices=["current", "full"], default="current")
    ap.add_argument("--seasons", help="comma separated, e.g. 26/27,25/26 (overrides --mode)")
    ap.add_argument("--out", type=Path, default=Path("out"))
    a = ap.parse_args()
    seasons = a.seasons.split(",") if a.seasons else None

    if a.command == "reprocess":
        reprocess()
        return
    if a.command == "migrate":
        import psycopg
        from . import store
        with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as conn:
            store.migrate(conn)
            conn.execute("select rebuild_derived()")
        log.info("Schema applied")
        return

    manifest = None
    if a.command in ("fetch", "run"):
        manifest = fetch(a.mode, a.out, seasons)
    if a.command in ("fetch", "run"):
        check(a.out)
    if a.command == "load" or (a.command == "run" and os.environ.get("DATABASE_URL")):
        load(a.out, a.mode)
    elif a.command == "run":
        log.info("DATABASE_URL not set - skipped loading; exports are in %s", a.out)
    if manifest and manifest["errors"] and len(manifest["errors"]) > len(manifest["files"]):
        sys.exit("Too many errors")


if __name__ == "__main__":
    main()
