"""Parsers for the DFBnet statistics exports (semicolon separated, metadata block on top)."""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime, time


def _clean(v: str | None) -> str:
    v = (v or "").strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        v = v[1:-1]
    return v.strip()


def _int(v: str) -> int | None:
    v = _clean(v)
    return int(v) if re.fullmatch(r"-?\d+", v) else None


def _date(v: str) -> date | None:
    v = _clean(v)
    try:
        return datetime.strptime(v, "%d.%m.%Y").date()
    except ValueError:
        return None


def _time(v: str) -> time | None:
    v = _clean(v)
    try:
        return datetime.strptime(v, "%H:%M").time()
    except ValueError:
        return None


def table(text: str, first_col: str, must_have: str | None = None) -> tuple[list[str], list[list[str]]]:
    """Find the data header row (starting with `first_col`, containing `must_have`) and return header + rows."""
    rows = list(csv.reader(io.StringIO(text), delimiter=";", quotechar='"'))
    for i, r in enumerate(rows):
        if r and r[0].strip() == first_col and (must_have is None or must_have in [c.strip() for c in r]):
            header = [h.strip() for h in r]
            data = [x for x in rows[i + 1:] if any(c.strip() for c in x)]
            return header, data
    raise ValueError(f"Header starting with {first_col!r} not found")


# --------------------------------------------------------------------------- appearances

@dataclass
class Appearance:
    season: str
    pass_nr: str
    last_name: str
    first_name: str
    kickoff_date: date | None
    kickoff_time: time | None
    club_team: str
    active: bool
    shirt_no: int | None
    competition: str
    match_id: str
    matchday: int | None
    home: str
    away: str
    half1_end: int | None
    half2_end: int | None
    minute_on: int | None
    minute_off: int | None
    minutes_real: int | None
    minutes_norm: int | None
    status: str
    nationality: str
    fifa_nat: str

    @property
    def in_squad(self) -> bool:  # on the match report (has a shirt number) or played
        return self.shirt_no is not None or self.played

    @property
    def played(self) -> bool:
        return self.minute_on is not None


def parse_appearances(text: str) -> list[Appearance]:
    header, data = table(text, "SAISON", must_have="PASSNR")
    idx = {h: i for i, h in enumerate(header)}

    def g(r, col):
        i = idx.get(col)
        return _clean(r[i]) if i is not None and i < len(r) else ""

    out = []
    for r in data:
        if not g(r, "PASSNR") or not g(r, "SPIELKENNUNG"):
            continue
        out.append(Appearance(
            season=g(r, "SAISON"), pass_nr=g(r, "PASSNR"),
            last_name=g(r, "SPIELER-NACHNAME"), first_name=g(r, "SPIELER-VORNAME"),
            kickoff_date=_date(g(r, "ANSTOSSDATUM")), kickoff_time=_time(g(r, "ANSTOSSZEIT")),
            club_team=g(r, "MANNSCHAFT"), active=g(r, "AKTIV").lower() == "ja",
            shirt_no=_int(g(r, "SPIELER-RUECKNR")), competition=g(r, "STAFFEL-POKALRUNDE"),
            match_id=g(r, "SPIELKENNUNG"), matchday=_int(g(r, "SP-TAG")),
            home=g(r, "HEIM"), away=g(r, "GAST"),
            half1_end=_int(g(r, "SPZT-1HZ")), half2_end=_int(g(r, "SPZT-2HZ")),
            minute_on=_int(g(r, "VON")), minute_off=_int(g(r, "BIS")),
            minutes_real=_int(g(r, "EINSATZ-REAL")), minutes_norm=_int(g(r, "EINSATZ-NORMIERT")),
            status=g(r, "STATUS"), nationality=g(r, "NAT"), fifa_nat=g(r, "FIFA-NAT"),
        ))
    return out


# --------------------------------------------------------------------------- cards

@dataclass
class YellowTally:
    last_name: str
    first_name: str
    shirt_no: int | None
    team: str
    card_dates: list[date] = field(default_factory=list)
    ban_marks: list[str] = field(default_factory=list)  # raw SPERRE column values, in order


def parse_yellow(text: str) -> list[YellowTally]:
    header, data = table(text, "SPIELER-NACHNAME")
    out = []
    for r in data:
        r = r + [""] * (len(header) - len(r))
        t = YellowTally(_clean(r[0]), _clean(r[1]), _int(r[2]), _clean(r[3]))
        for h, v in zip(header[4:], r[4:]):
            v = _clean(v)
            if h.endswith(".GK"):
                d = _date(v)
                if d:
                    t.card_dates.append(d)
            elif h == "SPERRE":
                t.ban_marks.append(v)
        if t.last_name or t.first_name:
            out.append(t)
    return out


@dataclass
class RedCard:
    matchday: int | None
    team: str
    kind: str  # "GR" (Gelb-Rot) or "R" (Rot)
    last_name: str
    first_name: str
    shirt_no: int | None


def parse_red(text: str) -> list[RedCard]:
    _, data = table(text, "SP-TAG")
    out = []
    for r in data:
        r = r + [""] * (8 - len(r))
        md, team = _int(r[0]), _clean(r[1])
        if _clean(r[2]) or _clean(r[3]):
            out.append(RedCard(md, team, "GR", _clean(r[2]), _clean(r[3]), _int(r[4])))
        if _clean(r[5]) or _clean(r[6]):
            out.append(RedCard(md, team, "R", _clean(r[5]), _clean(r[6]), _int(r[7])))
    return out


# --------------------------------------------------------------------------- goals

@dataclass
class GoalTally:
    last_name: str
    first_name: str
    shirt_no: int | None
    team: str
    goals: int


def parse_goals(text: str) -> list[GoalTally]:
    _, data = table(text, "NNAME")
    out = []
    for r in data:
        r = r + [""] * (5 - len(r))
        goals = _int(r[4])
        if goals is None:
            continue
        out.append(GoalTally(_clean(r[0]), _clean(r[1]), _int(r[2]), _clean(r[3]), goals))
    return out
