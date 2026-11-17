"""DFBnet access: login and the "Statistiken" web flow of the SpielberichtOnline module.

The statistics page is a stateful server-side "webflow": every change of a
dropdown is a POST with event=REFRESH_LIST_EVENT that returns a fresh page
(with a new form action URL and new dropdown options). event=SEARCH_EVENT
returns the export file (CSV, or a ZIP containing a CSV). Changing the report
type resets the team/fixture-list selection, so the type is always set first.
"""
from __future__ import annotations

import io
import logging
import time
import zipfile
from dataclasses import dataclass, asdict
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

BASE = "https://www.dfbnet.org"
STATS_URL = f"{BASE}/spielplus/mod_sbo/webflow.do?event=START_STATISTICS&dmg_menu=10241"
PORTAL_URL = "https://portal.dfbnet.org/de/startseite"
P = "kontext.teamSearchPanel."

TEAM_TYPE_HERREN = "27"
# Meisterschaft, Pokal, Freundschaftsspiel, Turnier, Spielnachmittag
COMPETITION_TYPES = {"1": "Meisterschaft", "308": "Pokal", "70": "Freundschaftsspiel",
                     "300": "Turnier", "305": "Spielnachmittag"}

REPORT_APPEARANCES = "PLAYER_APPEARANCES_WITHOUT_MATCH_TIMES"  # "7. Einsätze und Nicht-Einsätze (Spielzeiten)"
REPORT_YELLOW = "CARDS_YELLOW"                                  # "3. Gelbe Karten bisher"
REPORT_RED = "CARDS_YELLOW_RED"                                 # "4. Rote- und Gelb-Rote Karten bisher"
REPORT_GOALS = "GOAL_SCORER"                                    # "5. Torschützen bisher"
REPORTS = [REPORT_APPEARANCES, REPORT_YELLOW, REPORT_RED, REPORT_GOALS]

USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 fct-stats"


class FlowError(RuntimeError):
    pass


class LoginError(RuntimeError):
    pass


# --------------------------------------------------------------------------- login

def login(username: str, password: str, debug_dir: Path | None = None) -> requests.Session:
    """Log in with a headless browser (DFBnet uses a Keycloak SSO) and return a
    requests.Session carrying the resulting cookies."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(locale="de-DE", user_agent=USER_AGENT)
        page = ctx.new_page()
        try:
            page.goto(STATS_URL, wait_until="domcontentloaded")
            if not _has_login_form(page) and "Statistiken suchen" not in page.content():
                # Not redirected to the SSO: start from the portal's "DFBnet Verein" login.
                page.goto(PORTAL_URL, wait_until="domcontentloaded")
                link = page.locator("a", has_text="DFBnet Verein").first
                href = link.get_attribute("href")
                page.goto(urljoin(page.url, href), wait_until="domcontentloaded")
            if _has_login_form(page):
                page.fill("input[name=username]", username)
                page.fill("input[name=password]", password)
                page.locator("#kc-login, button[type=submit], input[type=submit]").first.click()
                # DFBnet pages keep loading ads/trackers, so "networkidle" never happens:
                # wait until we have left the SSO login page instead.
                try:
                    page.wait_for_url(lambda u: "auth.dfbnet.org" not in u, timeout=45_000)
                    page.wait_for_load_state("domcontentloaded")
                except Exception:
                    pass
                if _has_login_form(page):
                    raise LoginError("Login rejected (still on the login form) - check DFBNET_USERNAME / DFBNET_PASSWORD")
            page.goto(STATS_URL, wait_until="domcontentloaded")
            if "Statistiken suchen" not in page.content():
                raise LoginError("Logged in, but the statistics page did not open (permissions changed?)")
            cookies = ctx.cookies()
        except Exception:
            if debug_dir:
                debug_dir.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(debug_dir / "login-failure.png"), full_page=True)
                (debug_dir / "login-failure.url.txt").write_text(page.url)
            raise
        finally:
            browser.close()

    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    for c in cookies:
        s.cookies.set(c["name"], c["value"], domain=c["domain"], path=c.get("path", "/"))
    log.info("Logged in to DFBnet")
    return s


def _has_login_form(page) -> bool:
    return page.locator("input[name=password]").count() > 0


# --------------------------------------------------------------------------- web flow

@dataclass
class CatalogEntry:
    season: str
    competition_type: str
    team_id: str
    team_name: str
    fixture_list_id: str
    fixture_list_name: str


@dataclass
class ExportFile:
    filename: str
    text: str


def decode(raw: bytes) -> str:
    # The exports are declared UTF-8 but are actually Windows-1252.
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1252")


def parse_flow_page(html: str, url: str):
    """Return (action_url, fields, options) for a statistics flow page."""
    soup = BeautifulSoup(html, "html.parser")
    form = soup.find("form")
    if form is None or not form.get("action"):
        title = soup.title.get_text(strip=True) if soup.title else ""
        # No page text in the message: logs are public and DFBnet pages show the user's name.
        raise FlowError(f"Unexpected DFBnet page without form ({title or 'no title'}) - session expired or page changed")
    action = urljoin(url, form["action"])
    fields: dict[str, str] = {}
    for inp in form.find_all("input"):
        if inp.get("name"):
            fields[inp["name"]] = inp.get("value", "")
    panel_names = [k for k in fields if k.startswith(P)]
    selects = soup.find_all("select")
    options: dict[str, list[tuple[str, str]]] = {}
    for name, sel in zip(panel_names, selects):
        options[name[len(P):]] = [(o.get("value", ""), " ".join(o.get_text().split())) for o in sel.find_all("option")]
    return action, fields, options


class StatsFlow:
    def __init__(self, session: requests.Session, delay: float = 0.15):
        self.s = session
        self.delay = delay
        self.restart()

    def restart(self):
        r = self.s.get(STATS_URL, timeout=60)
        r.raise_for_status()
        self.action, self.fields, self.options = parse_flow_page(r.text, r.url)
        if "selectedType" not in self.options:
            raise FlowError("Statistics page not available - session expired or no permission?")

    def _post(self, event: str, override: dict[str, str] | None = None) -> requests.Response:
        data = dict(self.fields)
        for k, v in (override or {}).items():
            data[P + k] = v
        data["event"] = event
        time.sleep(self.delay)
        r = self.s.post(self.action, data=data, timeout=120)
        r.raise_for_status()
        return r

    def value(self, key: str) -> str:
        return self.fields.get(P + key, "")

    def set(self, key: str, value: str):
        if self.value(key) == value:
            return
        r = self._post("REFRESH_LIST_EVENT", {key: value})
        self.action, self.fields, self.options = parse_flow_page(r.text, r.url)
        if self.value(key) != value:
            raise FlowError(f"Could not select {key}={value} (options: {self.options.get(key)})")

    def choices(self, key: str) -> list[tuple[str, str]]:
        return [o for o in self.options.get(key, []) if o[0]]

    def search(self) -> list[ExportFile]:
        """Run the search. Returns the exported file(s); [] when there is no data."""
        r = self._post("SEARCH_EVENT")
        raw = r.content
        disp = r.headers.get("content-disposition", "")
        ctype = r.headers.get("content-type", "")
        if raw[:2] == b"PK":
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                return [ExportFile(n, decode(z.read(n))) for n in z.namelist()]
        if disp or "html" not in ctype:
            name = disp.split("filename=")[-1].split(";")[0].strip('"') if "filename=" in disp else "export.csv"
            return [ExportFile(name, decode(raw))]
        # HTML page = no results; keep the flow state in sync.
        self.action, self.fields, self.options = parse_flow_page(r.text, r.url)
        return []

    def select_entry(self, report: str, e: CatalogEntry):
        self.set("selectedType", report)  # first: resets the rest
        self.set("seasonId", e.season)
        self.set("teamTypeId", TEAM_TYPE_HERREN)
        self.set("competitionTypeId", e.competition_type)
        self.set("teamId", e.team_id)
        self.set("fixtureListId", e.fixture_list_id)

    # ---- high level

    def seasons(self) -> list[str]:
        return [v for v, _ in self.choices("seasonId")]

    def catalog(self, seasons: list[str]) -> list[CatalogEntry]:
        out: list[CatalogEntry] = []
        for season in seasons:
            self.set("seasonId", season)
            if TEAM_TYPE_HERREN not in [v for v, _ in self.choices("teamTypeId")]:
                continue
            self.set("teamTypeId", TEAM_TYPE_HERREN)
            for comp in COMPETITION_TYPES:
                if comp not in [v for v, _ in self.choices("competitionTypeId")]:
                    continue
                self.set("competitionTypeId", comp)
                for team_id, team_name in self.choices("teamId"):
                    self.set("teamId", team_id)
                    for fl_id, fl_name in self.choices("fixtureListId"):
                        out.append(CatalogEntry(season, comp, team_id, team_name, fl_id, fl_name))
            log.info("Catalog %s: %d entries so far", season, len(out))
        return out

    def fetch(self, report: str, e: CatalogEntry, retries: int = 2) -> list[ExportFile]:
        for attempt in range(retries + 1):
            try:
                self.select_entry(report, e)
                return self.search()
            except (FlowError, requests.RequestException) as exc:
                if attempt == retries:
                    raise
                log.warning("Retrying %s %s after error: %s", report, asdict(e), exc)
                time.sleep(2)
                self.restart()
        return []
