# Rummikub

A Rummikub PWA for GitHub Pages: you against four computer players. First launch opens a tutorial.

## Rules implemented
- 106 tiles (1–13 × 4 colors × 2, plus 2 jokers), 14 each, draw pool for the rest.
- Valid sets: runs (3+ consecutive, same color, no wrap) and groups (3–4 same number, distinct colors); jokers are wild.
- First meld ≥ 30 points from your own rack only, without touching the table.
- After that: rearrange freely; at end of turn every set must be valid, no table tile may be removed, and at least one rack tile must be played. Jokers can only be taken by replacing them with the real tile and replayed in the same turn.
- Otherwise draw one tile (or pass when the pool is empty). Rack empty wins; if nobody can move, lowest rack wins.
- **Every move, human or AI, passes through the same `validateTurn` check in `rules.js`.** The AIs see only their own rack and the public table and all use the same player logic, so the deal decides the winner.

## Files
| file | purpose |
|---|---|
| `rules.js` | rules engine (set analysis, turn validation, game state) |
| `ai.js` | computer player |
| `app.js`, `style.css`, `index.html` | UI, tutorial, game loop |
| `sw.js`, `manifest.webmanifest`, `version.js` | PWA + auto-update |

## Auto-update
`sw.js` is network-first and `version.js` is stamped with the build time + commit by the deploy workflow, so each deploy yields a new service worker. On every open (and when the app regains focus or connectivity) the app checks for an update; a new worker activates immediately (`skipWaiting` + `clients.claim`) and the page reloads itself, resuming any saved game.

## Deploying
Repo **Settings → Pages → Source: GitHub Actions**, then push to `main`. See `.github/workflows/pages.yml`.

## Development
```
python3 -m http.server 8000      # serve locally
node tests/rules.test.js         # rule unit tests
node tests/sim.js 100            # 100 full AI-only games, every move validated
```
