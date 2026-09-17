# Respite

A slow, grim idle RPG. Your crews work, your hunt goes on, the camp keeps its fire.

The site is static (GitHub Pages). The rules live in `src/shared/`, and the browser and the server both run them. The browser plays the camp forward live. A Supabase Edge Function runs the same rules and holds the save that counts.

## Layout

| Path | What |
|---|---|
| `index.html`, `css/`, `assets/` | The page shell, stylesheets and images |
| `src/shared/` | The rules: registry, storage, skills, the hunt, the camp, the market's save side, migrations |
| `src/client/` | The browser: store (prediction and sync), net (Supabase), router, shell, pages and popups |
| `src/server/` | The game function's handler (runs in Deno on Supabase, tested in Node) |
| `supabase/` | SQL to run once (`schema.sql`, then `migrations/002_server.sql`, then `migrations/003_profiles_from_saves.sql`), the function wrapper and config |
| `.github/workflows/deploy-game.yml` | Deploys the game function when `src/shared`, `src/server` or `supabase/functions` change |
| `tests/` | Engine, SQL, server, client store and browser tests (`tests/ref-v4/` keeps the v4 rules the port is checked against) |
| `dev/` | The local stage (`server.mjs` with a fake Supabase on PGlite), the style guide (`kit.html`) and a page runner |
| `docs/` | Architecture: CONTRACT, ENGINE, CLIENT, SERVER, UI-KIT, UI-REQUIREMENTS |
| `notes and md/` | Game rules as built: combat, weather, online |

## Run it locally

```
npm install
npx playwright install chromium   # only for the browser tests
npm run dev                        # http://127.0.0.1:8787 with a local database and fake accounts
```

## Test

```
npm test            # engine, SQL, server and client store
npm run test:e2e    # the whole stack in a real browser
```

## Rules for changes

- No em dashes, en dashes or infinity signs anywhere; `tests/engine/purity.test.mjs` checks the whole repo.
- The UI builds only from `docs/UI-KIT.md`.
- Every list of skills keeps each artisan in the same position as its trade (`TRADE_ORDER`, `ARTISAN_ORDER` in `src/shared/registry.js`).
- A change to the rules that would make an older browser predict differently bumps `ENGINE_VERSION` in `src/shared/version.js`. Then deploy the function and the site together.
