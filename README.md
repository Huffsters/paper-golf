# Paper Golf ⛳

A daily paper-golf puzzle in the spirit of Wordle, live at **https://golf.huffsters.com**.

Everyone in the world plays the same hand-drawn hole each day. Pick a club, aim in one
of 8 directions, and thread your shots past trees, sand, and water to the flag in the
fewest strokes. Results share as a spoiler-light emoji trail; streaks and stats live in
your browser.

## How it works

- **Static site + one tiny API** — hosted on Cloudflare Pages, with the daily
  leaderboard as a Pages Function (`functions/api/scores.js`) backed by a D1 database.
  No accounts: players are an anonymous UUID in `localStorage` plus a self-chosen
  display name; one score per browser per day (first post stands). The function
  reuses the game's own solver, so scores below the day's optimal are rejected.
  Without the D1 binding the API returns 503 and the game simply hides the
  leaderboard — everything else works.
- The daily course is **generated client-side** from a seeded PRNG keyed to the puzzle
  number (days since launch, rolling over at each player's local midnight). Everyone
  gets a byte-identical course.
- A built-in **BFS solver** validates every generated course: it must be finishable in
  3–6 optimal strokes or the generator deterministically re-rolls. **Par = optimal + 1**,
  so a perfect round is always a Birdie.
- Streaks, stats, and the in-progress round persist in `localStorage`.

## Rules

- Clubs: Driver (6 cells), Iron (4), Wedge (2), Putter (1); 8 compass directions;
  diagonals count one cell per step.
- 🌲 **Trees** block the ball mid-flight — it drops short.
- 🟦 **Water**: penalty stroke, replay from where you swung (the ball flies *over*
  water if it lands beyond it).
- 🟨 **Sand**: next shot must be Wedge or Putter.
- Land exactly on the hole to sink it. Reach par + 5 and you pick up (✗, breaks streak).
- The daily round is timed (wall clock, first swing → final putt; survives reloads via
  `startedAt` in progress). The leaderboard ranks by strokes, then time, then post
  order; untimed entries sort last within a stroke count.
- Free play (footer toggle) deals endless randomly-seeded holes from the same
  generator — no stats, streak, timer, or leaderboard.

## Development

No build step — plain ES modules.

```
npx wrangler pages dev . --port 8792 --d1 DB   # full stack: site + API + local D1
py -m http.server 8791                         # static only (leaderboard hidden)
node test/sim.mjs                              # simulate 730 days: solvability, determinism, par spread
```

## Deploying

Push to `main` — Cloudflare Pages auto-deploys (framework preset: **None**, no build
command, output directory `/`).

Leaderboard one-time setup: create a D1 database (Storage & Databases → D1 →
Create → name it `paper-golf`), then in the Pages project add the binding
(Settings → Bindings → Add → D1 database, variable name **DB**, select the
database) and redeploy. The schema creates itself on first request.

When changing `css/style.css` or `js/*.js`, bump the `?v=N` query on the asset URLs in
`index.html` so returning players' browsers pick up the new files.

⚠️ Do not change `EPOCH` in `js/course.js` after launch — it defines the puzzle
numbering, and moving it changes everyone's daily course.
