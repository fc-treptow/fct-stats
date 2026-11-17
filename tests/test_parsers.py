"""Parser tests. Fixtures mirror the real DFBnet export layout (names are made up)."""
from datetime import date

from importer import parsers
from importer.dfbnet import decode, parse_flow_page

META = (
    "SAISON;Verein;Sportdisziplin;Wettkampftyp;Mannschaftsart;Spielklasse;Gebiet;Wettkampf;STAFFEL;STAND\n"
    "26/27;Fußball-Club Treptow e.V. (66011358);Fußball;Meisterschaft;Herren;;;;Meisterschaft - Herren Kreisliga B St.1;17.11.2026 19:10:14\n"
    "\n"
)

APPEARANCES = (
    "Spieler/-innen Einsätze und Nicht-Einsätze (Spielzeiten)\n" + META +
    "SAISON;PASSNR;SPIELER-NACHNAME;SPIELER-VORNAME;ANSTOSSDATUM;ANSTOSSZEIT;MANNSCHAFT;AKTIV;SPIELER-RUECKNR;STAFFEL-POKALRUNDE;SPIELKENNUNG;SP-TAG;HEIM;GAST;SPZT-1HZ;SPZT-2HZ;VON;BIS;EINSATZ-REAL;EINSATZ-NORMIERT;STATUS;NAT;FIFA-NAT;KEY;\n"
    "26/27;\"0000-1111\";Müller;Max;16.08.2026;13:30;FC Treptow II River Plate;Ja;;Kreisliga B Herren Kreisliga B St.1;\"661010007\";1;FC Treptow II River Plate;SV Beispiel;'45';'90';;;;;Amateur;Deutschland;GER;Müller Max 0000-1111;\n"
    "26/27;\"0000-1111\";Müller;Max;23.08.2026;16:00;FC Treptow II River Plate;Ja;3;Berlin-Pokal Runde 1;\"760017039\";1;FC Treptow II River Plate;FSV Test II;'45';'90';'1';'90';90;90;Amateur;Deutschland;GER;Müller Max 0000-1111;\n"
    "26/27;\"0000-2222\";Schmidt;Ali;23.08.2026;16:00;FC Treptow II River Plate;Ja;14;Berlin-Pokal Runde 1;\"760017039\";1;FC Treptow II River Plate;FSV Test II;'45';'90';'63';'90';27;27;Amateur;Türkei;TUR;Schmidt Ali 0000-2222;\n"
    "26/27;\"0000-3333\";Nowak;Jan;23.08.2026;16:00;FC Treptow II River Plate;Ja;17;Berlin-Pokal Runde 1;\"760017039\";1;FC Treptow II River Plate;FSV Test II;'45';'90';;;;;Amateur;Polen;POL;Nowak Jan 0000-3333;\n"
)

YELLOW = (
    "Gelbe Karten bisher\n" + META +
    "SPIELER-NACHNAME;SPIELER-VORNAME;SPIELER-RUECKNR;VEREIN;1.GK;2.GK;3.GK;4.GK;5.GK;SPERRE;6.GK;7.GK;8.GK;9.GK;10.GK;SPERRE;\n"
    "Müller;Max;;FC Treptow II River Plate;20.09.2026;01.11.2026;\n"
    "Schmidt;Ali;;FC Treptow II River Plate;30.08.2026;06.09.2026;13.09.2026;20.09.2026;\n"
    "Andere;Person;;SV Beispiel;30.08.2026;06.09.2026;13.09.2026;20.09.2026;27.09.2026;X;04.10.2026;\n"
)

RED = (
    "Rote- und Gelb-Rote Karten bisher\n" + META +
    "SP-TAG;VEREIN;GELB-ROT SPIELER-NACHNAME;GELB-ROT SPIELER-VORNAME;GELB-ROT SPIELER-RUECKNR;ROT SPIELER-NACHNAME;ROT SPIELER-VORNAME;ROT SPIELER-RUECKNR\n"
    "5;FC Treptow II River Plate;Nowak;Jan;;Schmidt;Ali;;\n"
    "9;FC Treptow II River Plate;;;;Müller;Max;7;\n"
)

GOALS = (
    "Torschützen bisher\n" + META +
    "NNAME;VNAME;RUECKENNR;MANNSCHAFT;TORE\n"
    "Andere;Person;;SV Beispiel;19\n"
    "Müller;Max;;FC Treptow II River Plate;7\n"
)


def test_appearances():
    apps = parsers.parse_appearances(APPEARANCES)
    assert len(apps) == 4
    not_in_squad, started, sub, bench = apps
    assert not not_in_squad.in_squad and not not_in_squad.played
    assert started.played and started.minute_on == 1 and started.minutes_real == 90
    assert started.match_id == "760017039" and started.pass_nr == "0000-1111"
    assert started.kickoff_date == date(2026, 8, 23) and started.half2_end == 90
    assert sub.minute_on == 63 and sub.minutes_real == 27
    assert bench.in_squad and not bench.played


def test_yellow():
    rows = parsers.parse_yellow(YELLOW)
    assert [len(r.card_dates) for r in rows] == [2, 4, 6]
    assert rows[1].card_dates[-1] == date(2026, 9, 20)
    assert rows[2].ban_marks[0] == "X"


def test_red():
    rows = parsers.parse_red(RED)
    assert [(r.matchday, r.kind, r.last_name) for r in rows] == [(5, "GR", "Nowak"), (5, "R", "Schmidt"), (9, "R", "Müller")]
    assert rows[2].shirt_no == 7


def test_goals():
    rows = parsers.parse_goals(GOALS)
    assert rows[0].goals == 19 and rows[1].team == "FC Treptow II River Plate"


def test_decode_cp1252():
    assert decode("Fußball Einsätze".encode("cp1252")) == "Fußball Einsätze"
    assert decode("Fußball".encode("utf-8")) == "Fußball"


FLOW_PAGE = """
<html><body><form action="/spielplus/mod_sbo/webflow17.do" method="post">
<input type="hidden" name="kontext.scrollToResults" value="false">
<input type="hidden" name="kontext.teamSearchPanel.selectedType" value="CARDS">
<input type="hidden" name="kontext.teamSearchPanel.seasonId" value="26/27">
<input type="hidden" name="kontext.teamSearchPanel.teamId" value="">
<select><option value="CARDS">1. Karten gesamt bisher</option><option value="GOAL_SCORER">5. Torschützen bisher</option></select>
<select><option value="26/27">26/27</option><option value="25/26">25/26</option></select>
<select><option value="">Keine Auswahl</option><option value="T1">FC Treptow</option></select>
</form></body></html>
"""


def test_flow_page():
    action, fields, options = parse_flow_page(FLOW_PAGE, "https://www.dfbnet.org/spielplus/mod_sbo/webflow.do?event=X")
    assert action == "https://www.dfbnet.org/spielplus/mod_sbo/webflow17.do"
    assert fields["kontext.teamSearchPanel.seasonId"] == "26/27"
    assert options["teamId"][1] == ("T1", "FC Treptow")
    assert [v for v, _ in options["seasonId"]] == ["26/27", "25/26"]
