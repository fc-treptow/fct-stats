# fct-stats

Player and team statistics for FC Treptow's teams, imported automatically from DFBnet.

## How the import works

`importer/` logs in to DFBnet (headless browser for the SSO login) and uses the
**SpielberichtOnline → Statistiken** page: for every season, team and competition it
downloads four exports and loads them into PostgreSQL.

| DFBnet report | Table | Used for |
|---|---|---|
| 7. Einsätze und Nicht-Einsätze (Spielzeiten) | `players`, `matches`, `appearances` | minutes, matches, starts, subs, squad |
| 3. Gelbe Karten bisher | `yellow_tallies` | yellow cards, ban warning (DFBnet bans after every 5th yellow) |
| 4. Rote- und Gelb-Rote Karten bisher | `red_cards` | red / yellow-red cards |
| 5. Torschützen bisher | `goal_tallies` | scorer lists (whole league) |

Card tables only keep rows of our own teams (`CLUB_PATTERN`). Raw exports are kept in
`raw_exports` so the data can be re-processed without logging in again.

Views for the app: `v_player_season`, `v_yellow_status`, `v_name_to_player`.

## Running

GitHub Action **DFBnet import** (`.github/workflows/import.yml`):
- weekly, Monday night: current season
- manual ("Run workflow"): `current`, `full` (all seasons) or a list of seasons

Repository secrets:

| Secret | |
|---|---|
| `DFBNET_USERNAME` | DFBnet login |
| `DFBNET_PASSWORD` | DFBnet password (expires regularly in DFBnet — update it here too) |
| `DATABASE_URL` | Postgres connection string (Supabase). Optional: without it the run only fetches and uploads the exports as a 3-day artifact. |

Locally:

```bash
pip install -r requirements.txt && python -m playwright install chromium
export DFBNET_USERNAME=... DFBNET_PASSWORD=... DATABASE_URL=...
python -m importer run --mode current      # or: fetch / load, --mode full, --seasons 26/27,25/26
python -m pytest -q
```
