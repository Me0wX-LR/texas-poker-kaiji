# GTO blueprint

GTO-style bots play a strategy produced by [postflop-solver](https://github.com/b-inary/postflop-solver) (Wataru Inariba, AGPL-3.0-or-later). That library is the open-source Discounted CFR engine behind WASM Postflop and Desktop Postflop. It is not vendored here. `cargo run --release` downloads it and writes `src/lib/gto-strategy.json`.

The solve is heads-up after a single raised pot: the big blind defends, the button bets. Bet size is 66% of the pot, raises are 2.5x, and the tree runs from the flop through the river. Eight flops stand in for the rest; the bot picks the closest one.

```bash
cargo run --release --manifest-path solver/Cargo.toml
```
