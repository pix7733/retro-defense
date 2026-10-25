# Retro Defense

A Retro Bowl-style defensive football game that teaches NFHS (LHSAA) rules and your team's own calls.

- **Play Game:** 4 opponent drives. Before every snap a game-plan call or a rules question pops up with a 15-second play clock. A correct read gives you a great jump on the runner; a wrong one leaves you out of position. Then you chase and make the tackle (drag to move, DIVE to burst).
- **Film Room:** study every question with no clock, filtered to game plan, rules or your misses.
- **Coach Panel:** add game-plan items (e.g. "H goes in motion → call LUCK") with an animated formation/motion picture, assign them to positions or specific players, set expiry dates, see per-player and per-question miss rates, change positions, reset PINs.

## Stack
Static site (no build) on GitHub Pages + Supabase Postgres. Tables live in a private `fb` schema; the browser only calls `public.fb_*` functions that check a session token. Players log in with name + PIN; joining needs the team code, coach access needs the coach code (both changeable in Coach Panel → Settings).

## Setup
1. Run `supabase/migrations/001_init.sql`, then `002_seed.sql` (change the codes in `fb.settings`).
2. Put the project URL and publishable key in `js/config.js`.
3. GitHub → Settings → Pages → Deploy from branch `main`, folder `/`.

Leave `js/config.js` blank to run in demo mode (localStorage, team code RAMS, coach code COACH1).

Rules content follows the NFHS rules book; verify state-specific (LHSAA) adoptions before adding them.
