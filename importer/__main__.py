"""fct-stats importer.

    python -m importer fetch --mode current|full --out out     # DFBnet -> CSV files + manifest.json
    python -m importer load  --out out                          # CSV files -> database
    python -m importer run   --mode current|full --out out     # both (load only if DATABASE_URL is set)

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
    ap.add_argument("command", choices=["fetch", "load", "run"])
    ap.add_argument("--mode", choices=["current", "full"], default="current")
    ap.add_argument("--seasons", help="comma separated, e.g. 26/27,25/26 (overrides --mode)")
    ap.add_argument("--out", type=Path, default=Path("out"))
    a = ap.parse_args()
    seasons = a.seasons.split(",") if a.seasons else None

    manifest = None
    if a.command in ("fetch", "run"):
        manifest = fetch(a.mode, a.out, seasons)
    if a.command == "load" or (a.command == "run" and os.environ.get("DATABASE_URL")):
        load(a.out, a.mode)
    elif a.command == "run":
        log.info("DATABASE_URL not set - skipped loading; exports are in %s", a.out)
    if manifest and manifest["errors"] and len(manifest["errors"]) > len(manifest["files"]):
        sys.exit("Too many errors")


if __name__ == "__main__":
    main()
