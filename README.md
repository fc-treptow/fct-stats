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
| `DATABASE_URL` | Postgres connection string (Supabase). Optional: without it the run only fetches and checks the exports. |

Locally:

```bash
pip install -r requirements.txt && python -m playwright install chromium
export DFBNET_USERNAME=... DFBNET_PASSWORD=... DATABASE_URL=...
python -m importer run --mode current      # or: fetch / load, --mode full, --seasons 26/27,25/26
python -m pytest -q
```

## Web app (`web/`)

Next.js app on Vercel (project root directory: `web`). Login with Google, only
`@fc-treptow.de` accounts (Google OAuth app type "Internal" + check in the app +
database trigger on sign-up + row-level security on all tables).

Screens: team overview with card warning (`/team/1`, `/team/2`, `/team/3`, `/team/7er`),
scorers (`/scorers`), players and profiles (`/players`), cross-team use (`/cross-team`),
import status and "Update now" for admins (`/admin`).

Environment variables (see `web/.env.example`): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ADMIN_EMAILS`, `GITHUB_DISPATCH_TOKEN`.

The database schema (tables, views, security) lives in `db/schema.sql` and is applied
by every import run.

## Public repository

This repository is public. No credentials or player data belong in it: credentials live in
GitHub/Vercel secrets, data only in Supabase (readable only for @fc-treptow.de accounts).
Workflow logs print counts only, and exports are not uploaded as artifacts.
