# Texas Poker Kaiji

An offline six-max Texas Hold'em ladder. Kaiji plays one static shove chart. A seeded field of 50 to 1,200 bots — solver GTO, Elo-dynamic, frozen, and locally adapting — shares the same rating pool. The app is here to test a friend's claim: in this room, updating a strategy is wasted work.

No server, no API keys, no network calls at runtime. Ratings stay in `localStorage`.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:47221](http://127.0.0.1:47221).

`npm run test:engine` checks the evaluator, chip conservation, Kaiji's chart, the Elo example, and a full 240-hand match.

## Play

- **The table** deals Kaiji's six-handed match. The rest of the room is seated at the same time, AI against AI, for the same 240 hands. When Kaiji has played 1,008 matches, every player has too. 1× still plays every action. Faster settings batch whole hands. The slider stops at the fastest pace this browser held on a full field, including solver GTO, and the control shows that measured multiplier plus the live hands per second.
- **Blind bet required** posts 50/100. Off, nobody posts; an all-check hand moves 0 chips. The minimum opening bet stays 100.
- **Heads-up** rates you and the player across from you after 240 hands, with the same K=32 formula as the six-max table. Match randomly, sit Kaiji, or choose a style or personality and draw one player of that type. Next hand stays with that player. New opponent draws again. A shorter sit is not rated. While that tab is open, other players play their own heads-up matches and the ladder on the screen moves with them. A locked run does not move. Sound on starts a synthesized pulse and hits for cards, chips, an all-in, and the result. The browser only starts audio after you tap.
- **Six-max** seats you with five players. Random five draws anyone in the field. Choose seats sets each chair to a style, a personality, or name, and the same player cannot sit twice. You fold, check, call, bet, raise, or go all-in. After 240 hands the table is rated with the same K=32 formula. A shorter sit is not rated. While that tab is open, the rest of the field keeps playing and the ladder moves, unless the run is locked. Host opens a joinable table: share the five-character code or the `#table-CODE` link, friends sit in open chairs, and empty chairs become AIs when the host deals. The host deals, hole cards are encrypted on the public relay, and a joined table does not move the ladder. A guest who disconnects keeps that chair and can sit back down with the same name during a hand. The host can kick a player, and can seat a random AI or a chosen one in an open chair. The host's chair does not.
- **Experiment** states the claim and plots Elo and chips from the run. The verdict is computed. A deadline locks Kaiji's final Elo.
- **New run** sets the seed and the player count (50 to 1,200, default 1,200). There are no teams. The same seed repeats the deals.
- **Ladder** ranks each player by their own Elo. Switch between the top 20 and the top 100.
- **Win rate**, shown to the left of Kaiji's Elo, is the share of rated matches in which he tied or took the best chip result.
- Phones can play it in Safari or Chrome. Add it to the home screen if you want it full screen. Heads-up and six-max buttons sit at the bottom of the felt.

The default deadline is 1,008 matches: one match every 10 simulated minutes from 5 Oct 2026 00:00 UTC through the 23:50 UTC match on 11 Oct 2026. Each match is 240 hands, shown as read-only text. The hand stop is the match count times 240 (241,920 at the default) and updates when the match count changes. Either limit stops the run. A match cut off before 240 hands is not rated.

## How the slides were read

The slides fix six-max Hold'em, standard hand ranks, split pots, hidden hole cards, 240-hand matches, fresh 10,000-chip stacks, and ranking by cumulative net chips. They do not set a blind size. This app uses 50/100 when blinds are on.

Everyone in this sim starts at 1,500. Place score for six players is `(6 − place) / 5`. Ties split the average of the tied place scores. Expected score is the mean of logistic expectations against each opponent (base 10, divisor 400). `K = 32`. The slides illustrate that formula from 1,760: a win against a 1,560 opponent is about +7.69, which rounds to their +8. Their +17 against a 1,960 is an illustration; this K is about +24. A ladder saved under the old 1,760 baseline is discarded on load so a reload opens at 1,500.

Odd chips in a split go to the first winner left of the button. A short all-in reopens betting. The Elo update is zero-sum at the table. Kaiji is one rating, and he is rated every match. Each tier line on the chart is the average rating of players of that style who have sat, not 1,500 plus the sum of all of them. That sum is shown separately as the group pile. A pile climbs faster than Kaiji because hundreds of small results are added together. A dynamic bot reads his own rating, not the pile.

Kaiji is one player and only plays the fixed chart. Each match seats him and every other player. His table keeps the same five opponents for all 240 hands. The other tables are only AIs, reshuffled every match. A player count that is not a multiple of six still seats everyone: a leftover seat becomes a short table, and a single leftover becomes a five-handed table plus a heads-up.

Kaiji preflop: all-in with any pocket pair or AK, AQ, AJ, AT (suited or offsuit); otherwise check if free, else fold. Postflop: all-in with top pair or better (top pair and overpair must use a hole card; two pair or better always shoves); otherwise check if free, else fold.

GTO-style bots do not use that chart. Postflop they sample a Discounted CFR strategy solved by [postflop-solver](https://github.com/b-inary/postflop-solver) (the open-source engine behind Desktop Postflop). The tree is heads-up, button versus big blind, 100bb, with 66% pot bets and 2.5x raises, on eight flops that stand in for the rest of the deck. Preflop they open or defend the same ranges that solve was given, so the postflop mix is the equilibrium for those ranges. Rebuild it with `npm run solve:gto` (needs Rust). The solver itself is AGPL-3.0-or-later and is downloaded by Cargo; it is not bundled into the site.

## Deploy to GitHub Pages

The build is a static export. A push to `main` runs `.github/workflows/pages.yml`, which builds with `NEXT_PUBLIC_BASE_PATH` set to `/<repository-name>` and publishes `out/` through GitHub Actions. The playable site is [https://me0wx-lr.github.io/texas-poker-kaiji/](https://me0wx-lr.github.io/texas-poker-kaiji/).

Local `npm run dev` and `npm run build` leave the base path empty, so the app still opens at the site root. To preview the project-site build:

```bash
NEXT_PUBLIC_BASE_PATH=/texas-poker-kaiji npm run build
```

The app does not need a Node server after that build.

## Stack

Next.js, TypeScript, Tailwind, shadcn/ui. The poker table is custom. The hand evaluator and the bot field run in the browser.
