# Texas Poker Kaiji

An offline six-max Texas Hold'em ladder. Kaiji plays one static shove chart. A seeded field of at least a thousand bots — GTO-style, Elo-dynamic, frozen, and locally adapting — shares the same rating pool. The app is here to test a friend's claim: in this room, updating a strategy is wasted work.

No server, no API keys, no network calls at runtime. Ratings stay in `localStorage`.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:47221](http://127.0.0.1:47221).

`npm run test:engine` checks the evaluator, chip conservation, Kaiji's chart, the Elo example, and a full 240-hand match.

## Play

- **The table** deals six-handed matches. Speed runs from 1× (every action) through 1000× (batched hands, chart still updates).
- **Blind bet required** posts 50/100. Off, nobody posts; an all-check hand moves 0 chips. The minimum opening bet stays 100.
- **Heads-up** is you against Kaiji with the mouse. It does not move the ladder.
- **Experiment** states the claim and plots Elo and chips from the run. The verdict is computed. A deadline locks Kaiji's final Elo.
- **New run** sets the seed and the player count (at least 1,000, default 1,200). There are no teams. The same seed repeats the deals.
- **Ladder** ranks each player by their own Elo. Switch between the top 20 and the top 100.
- **Win rate**, shown to the left of Kaiji's Elo, is the share of rated matches in which he tied or took the best chip result.
- Phones can play it in Safari or Chrome. Add it to the home screen if you want it full screen. Heads-up buttons sit at the bottom of the felt.

The default deadline is 1,008 matches: one match every 10 simulated minutes from 5 Oct 2026 00:00 UTC through the 23:50 UTC match on 11 Oct 2026. Each match is 240 hands, shown as read-only text. The hand stop is the match count times 240 (241,920 at the default) and updates when the match count changes. Either limit stops the run. A match cut off before 240 hands is not rated.

## How the slides were read

The slides fix six-max Hold'em, standard hand ranks, split pots, hidden hole cards, 240-hand matches, fresh 10,000-chip stacks, and ranking by cumulative net chips. They do not set a blind size. This app uses 50/100 when blinds are on.

Everyone in this sim starts at 1,500. Place score for six players is `(6 − place) / 5`. Ties split the average of the tied place scores. Expected score is the mean of logistic expectations against each opponent (base 10, divisor 400). `K = 32`. The slides illustrate that formula from 1,760: a win against a 1,560 opponent is about +7.69, which rounds to their +8. Their +17 against a 1,960 is an illustration; this K is about +24. A ladder saved under the old 1,760 baseline is discarded on load so a reload opens at 1,500.

Odd chips in a split go to the first winner left of the button. A short all-in reopens betting. The Elo update is zero-sum at the table. Kaiji is one rating, and he is rated every match. Each tier line on the chart is the average rating of players of that style who have sat, not 1,500 plus the sum of all of them. That sum is shown separately as the group pile. A pile climbs faster than Kaiji because hundreds of small results are added together. A dynamic bot reads his own rating, not the pile.

Kaiji is one player and only plays the fixed chart. Each match draws him plus five other players from the field, and each of those seats keeps that player for all 240 hands.

Kaiji preflop: all-in with any pocket pair or AK, AQ, AJ, AT (suited or offsuit); otherwise check if free, else fold. Postflop: all-in with top pair or better (top pair and overpair must use a hole card; two pair or better always shoves); otherwise check if free, else fold.

## Deploy to GitHub Pages

The build is a static export. A push to `main` runs `.github/workflows/pages.yml`, which builds with `NEXT_PUBLIC_BASE_PATH` set to `/<repository-name>` and publishes `out/` through GitHub Actions. The playable site is [https://me0wx-lr.github.io/texas-poker-kaiji/](https://me0wx-lr.github.io/texas-poker-kaiji/).

Local `npm run dev` and `npm run build` leave the base path empty, so the app still opens at the site root. To preview the project-site build:

```bash
NEXT_PUBLIC_BASE_PATH=/texas-poker-kaiji npm run build
```

The app does not need a Node server after that build.

## Stack

Next.js, TypeScript, Tailwind, shadcn/ui. The poker table is custom. The hand evaluator and the bot field run in the browser.
