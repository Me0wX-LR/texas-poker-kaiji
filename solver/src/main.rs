//! Solve eight button-vs-big-blind flops with postflop-solver and write the blueprint
//! the GTO-style bots sample at the table.

use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use postflop_solver::*;

const FLOPS: [&str; 8] = [
    "Kd7c2h", "Ah9d4c", "QhJh4d", "Tc9c6h", "8s7s6h", "KsQsJs", "AcAd7h", "9d8c7h",
];

const IP: &str = "22+,A2s+,A8o+,K9s+,KTo+,Q9s+,QTo+,J9s+,T8s+,97s+,86s+,75s+,64s+,54s";
const OOP: &str = "22+,A2s+,ATo+,K9s+,KJo+,Q9s+,J9s+,T9s,98s,87s,76s,65s,54s";
const THREE: &str = "TT+,AQs+,AKo";
const UTG: &str = "77+,A9s+,A5s-A4s,AJo+,KTs+,KQo,QJs";
const HJ: &str = "55+,A4s+,ATo+,K9s+,KJo+,QTs+,JTs,T9s,98s";

struct Bin {
    sum: [[f64; 4]; 169],
    w: [f64; 169],
}

impl Bin {
    fn new() -> Self {
        Self {
            sum: [[0.0; 4]; 169],
            w: [0.0; 169],
        }
    }

    fn pack(&self) -> Vec<u8> {
        let mut out = vec![0u8; 169 * 4];
        for class in 0..169 {
            if self.w[class] <= 0.0 {
                continue;
            }
            let mut p = [0.0; 4];
            let mut total = 0.0;
            for action in 0..4 {
                let value = (self.sum[class][action] / self.w[class]).max(0.0);
                p[action] = value;
                total += value;
            }
            if total <= 1e-9 {
                continue;
            }
            let mut floors = [0u8; 4];
            let mut remain = [0.0; 4];
            let mut left = 255i32;
            for action in 0..4 {
                let scaled = p[action] / total * 255.0;
                let floor = scaled.floor() as i32;
                floors[action] = floor as u8;
                left -= floor;
                remain[action] = scaled - floor as f64;
            }
            while left > 0 {
                let mut best = 0;
                for action in 1..4 {
                    if remain[action] > remain[best] {
                        best = action;
                    }
                }
                floors[best] = floors[best].saturating_add(1);
                remain[best] = -1.0;
                left -= 1;
            }
            for action in 0..4 {
                out[class * 4 + action] = floors[action];
            }
        }
        out
    }
}

fn class169(c0: Card, c1: Card) -> usize {
    let mut r0 = (c0 >> 2) as usize;
    let mut r1 = (c1 >> 2) as usize;
    let suited = (c0 & 3) == (c1 & 3);
    if r0 < r1 {
        std::mem::swap(&mut r0, &mut r1);
    }
    if r0 == r1 {
        return r0;
    }
    let combo = r0 * (r0 - 1) / 2 + r1;
    if suited {
        13 + combo
    } else {
        13 + 78 + combo
    }
}

fn slot(action: Action) -> usize {
    match action {
        Action::Fold => 0,
        Action::Check | Action::Call => 1,
        Action::Bet(_) | Action::Raise(_) => 2,
        Action::AllIn(_) => 3,
        _ => 1,
    }
}

fn suit_kinds(cards: &[Card]) -> i32 {
    let mut seen = [false; 4];
    for card in cards {
        seen[(card & 3) as usize] = true;
    }
    seen.iter().filter(|flag| **flag).count() as i32
}

fn rank_counts(cards: &[Card]) -> [u8; 13] {
    let mut ranks = [0u8; 13];
    for card in cards {
        ranks[(card >> 2) as usize] += 1;
    }
    ranks
}

/// 3 flush, 2 pair, 4 straightening, 1 overcard, 0 blank. Same order as the TypeScript lookup.
fn texture(before: &[Card], card: Card) -> usize {
    let ranks = rank_counts(before);
    let mut suits = [0u8; 4];
    for previous in before {
        suits[(previous & 3) as usize] += 1;
    }
    let cr = (card >> 2) as usize;
    let cs = (card & 3) as usize;
    if suits[cs] >= 2 {
        return 3;
    }
    if ranks[cr] >= 1 {
        return 2;
    }
    let mut near = 0;
    for rank in 0..13 {
        if ranks[rank] > 0 && rank != cr && (rank as i32 - cr as i32).abs() <= 4 {
            near += 1;
        }
    }
    if near >= 2 {
        return 4;
    }
    let max_board = (0..13).rev().find(|rank| ranks[*rank] > 0).unwrap_or(0);
    if cr > max_board {
        1
    } else {
        0
    }
}

fn mark_range(range: &str) -> [u8; 169] {
    let parsed = range.parse::<Range>().unwrap_or_else(|err| panic!("{range}: {err}"));
    let mut out = [0u8; 169];
    for rank in 0..13u8 {
        if parsed.get_weight_pair(rank) > 0.0 {
            out[rank as usize] = 1;
        }
    }
    for hi in 1..13u8 {
        for lo in 0..hi {
            let combo = (hi as usize * (hi as usize - 1)) / 2 + lo as usize;
            if parsed.get_weight_suited(hi, lo) > 0.0 {
                out[13 + combo] = 1;
            }
            if parsed.get_weight_offsuit(hi, lo) > 0.0 {
                out[13 + 78 + combo] = 1;
            }
        }
    }
    out
}

fn add_current(game: &PostFlopGame, bin: &mut Bin) {
    if game.is_terminal_node() || game.is_chance_node() {
        return;
    }
    let player = game.current_player();
    let actions = game.available_actions();
    let strategy = game.strategy();
    let holes = game.private_cards(player);
    let weights = game.weights(player);
    let n = holes.len();
    let board = game.current_board();
    let mut mask = 0u64;
    for card in &board {
        mask |= 1u64 << card;
    }
    for (index, &(c0, c1)) in holes.iter().enumerate() {
        if mask & ((1u64 << c0) | (1u64 << c1)) != 0 {
            continue;
        }
        let weight = weights[index] as f64;
        if weight <= 0.0 {
            continue;
        }
        let class = class169(c0, c1);
        bin.w[class] += weight;
        for (action_index, action) in actions.iter().enumerate() {
            let prob = strategy[action_index * n + index] as f64;
            bin.sum[class][slot(*action)] += prob * weight;
        }
    }
}

fn find(game: &PostFlopGame, kind: &str) -> Option<usize> {
    game.available_actions().iter().position(|action| match kind {
        "check" => matches!(action, Action::Check),
        "call" => matches!(action, Action::Call),
        "bet" => matches!(action, Action::Bet(_) | Action::AllIn(_)),
        "raise" => matches!(action, Action::Raise(_) | Action::AllIn(_) | Action::Bet(_)),
        _ => false,
    })
}

fn cards_from(mask: u64) -> Vec<Card> {
    (0..52).filter(|card| mask & (1u64 << card) != 0).map(|card| card as Card).collect()
}

fn b64(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut i = 0;
    while i + 3 <= bytes.len() {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8) | bytes[i + 2] as u32;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(TABLE[((n >> 6) & 63) as usize] as char);
        out.push(TABLE[(n & 63) as usize] as char);
        i += 3;
    }
    if i < bytes.len() {
        let left = bytes.len() - i;
        let mut n = (bytes[i] as u32) << 16;
        if left == 2 {
            n |= (bytes[i + 1] as u32) << 8;
        }
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        if left == 2 {
            out.push(TABLE[((n >> 6) & 63) as usize] as char);
            out.push('=');
        } else {
            out.push('=');
            out.push('=');
        }
    }
    out
}

fn json_bytes(bytes: &[u8]) -> String {
    format!("\"{}\"", b64(bytes))
}

fn json_flags(flags: &[u8; 169]) -> String {
    flags.iter().map(|flag| flag.to_string()).collect::<Vec<_>>().join(",")
}

struct SolvedFlop {
    board: String,
    high: i32,
    mid: i32,
    low: i32,
    paired: i32,
    suits: i32,
    span: i32,
    exploit: f32,
    nodes: Vec<(String, Vec<u8>)>,
}

fn features(flop: [Card; 3]) -> (i32, i32, i32, i32, i32, i32) {
    let mut ranks = [(flop[0] >> 2) as i32, (flop[1] >> 2) as i32, (flop[2] >> 2) as i32];
    ranks.sort_unstable_by(|a, b| b.cmp(a));
    let counts = rank_counts(&flop);
    let paired = if counts.iter().any(|count| *count >= 2) { 1 } else { 0 };
    let suits = suit_kinds(&flop);
    (ranks[0], ranks[1], ranks[2], paired, suits, ranks[0] - ranks[2])
}

fn solve_flop(board: &str) -> SolvedFlop {
    let started = Instant::now();
    let flop = flop_from_str(board).unwrap();
    let (high, mid, low, paired, suits, span) = features(flop);
    let card_config = CardConfig {
        range: [OOP.parse().unwrap(), IP.parse().unwrap()],
        flop,
        turn: NOT_DEALT,
        river: NOT_DEALT,
    };
    let bet_sizes = BetSizeOptions::try_from(("66%", "2.5x")).unwrap();
    let tree_config = TreeConfig {
        initial_state: BoardState::Flop,
        starting_pot: 550,
        effective_stack: 9750,
        rake_rate: 0.0,
        rake_cap: 0.0,
        flop_bet_sizes: [bet_sizes.clone(), bet_sizes.clone()],
        turn_bet_sizes: [bet_sizes.clone(), bet_sizes.clone()],
        river_bet_sizes: [bet_sizes.clone(), bet_sizes],
        turn_donk_sizes: None,
        river_donk_sizes: None,
        add_allin_threshold: 0.0,
        force_allin_threshold: 0.15,
        merging_threshold: 0.1,
    };
    let action_tree = ActionTree::new(tree_config).unwrap();
    let mut game = PostFlopGame::with_config(card_config, action_tree).unwrap();
    game.allocate_memory(true);
    let target = game.tree_config().starting_pot as f32 * 0.02;
    solve(&mut game, 80, target, false);
    let exploit = compute_exploitability(&game);
    println!(
        "{board} exploitability {exploit:.2} chips ({:.1}s)",
        started.elapsed().as_secs_f64()
    );

    let mut nodes: Vec<(String, Vec<u8>)> = Vec::new();
    let mut root = Bin::new();
    add_current(&game, &mut root);
    nodes.push(("F".into(), root.pack()));

    if let Some(bet) = find(&game, "bet") {
        game.play(bet);
        let mut facing = Bin::new();
        add_current(&game, &mut facing);
        nodes.push(("Fb".into(), facing.pack()));
    }

    game.back_to_root();
    if let Some(check) = find(&game, "check") {
        game.play(check);
        let mut checked = Bin::new();
        add_current(&game, &mut checked);
        nodes.push(("Fx".into(), checked.pack()));
    }

    let mut turn_check = vec![Bin::new(), Bin::new(), Bin::new(), Bin::new(), Bin::new()];
    let mut turn_bet = vec![Bin::new(), Bin::new(), Bin::new(), Bin::new(), Bin::new()];
    let mut turn_donk = vec![Bin::new(), Bin::new(), Bin::new(), Bin::new(), Bin::new()];
    let mut river = vec![Bin::new(), Bin::new(), Bin::new(), Bin::new(), Bin::new()];
    let mut river_bet = vec![Bin::new(), Bin::new(), Bin::new(), Bin::new(), Bin::new()];

    game.back_to_root();
    let root_check = find(&game, "check");
    let root_bet = find(&game, "bet");
    if let Some(root_check) = root_check {
        game.play(root_check);
        if let Some(ip_check) = find(&game, "check") {
            game.play(ip_check);
            if game.is_chance_node() {
                let turns = cards_from(game.possible_cards());
                for turn in turns {
                    game.back_to_root();
                    game.play(root_check);
                    let ip_check = find(&game, "check").unwrap();
                    game.play(ip_check);
                    let kind = texture(&flop, turn);
                    game.play(turn as usize);
                    if !game.is_terminal_node() && !game.is_chance_node() {
                        add_current(&game, &mut turn_check[kind]);
                        if let Some(bet) = find(&game, "bet") {
                            game.play(bet);
                            if !game.is_terminal_node() && !game.is_chance_node() {
                                add_current(&game, &mut turn_bet[kind]);
                            }
                        }
                    }

                    game.back_to_root();
                    game.play(root_check);
                    let ip_check = find(&game, "check").unwrap();
                    game.play(ip_check);
                    game.play(turn as usize);
                    if game.is_terminal_node() || game.is_chance_node() {
                        continue;
                    }
                    let Some(oop_check) = find(&game, "check") else { continue };
                    game.play(oop_check);
                    let Some(ip_check) = find(&game, "check") else { continue };
                    game.play(ip_check);
                    if !game.is_chance_node() {
                        continue;
                    }
                    let board4 = game.current_board();
                    let rivers = cards_from(game.possible_cards());
                    for river_card in rivers {
                        game.back_to_root();
                        game.play(root_check);
                        game.play(find(&game, "check").unwrap());
                        game.play(turn as usize);
                        game.play(find(&game, "check").unwrap());
                        game.play(find(&game, "check").unwrap());
                        let kind = texture(&board4, river_card);
                        game.play(river_card as usize);
                        if game.is_terminal_node() || game.is_chance_node() {
                            continue;
                        }
                        add_current(&game, &mut river[kind]);
                        if let Some(bet) = find(&game, "bet") {
                            game.play(bet);
                            if !game.is_terminal_node() && !game.is_chance_node() {
                                add_current(&game, &mut river_bet[kind]);
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some(root_bet) = root_bet {
        game.back_to_root();
        game.play(root_bet);
        if let Some(call) = find(&game, "call") {
            game.play(call);
            if game.is_chance_node() {
                let turns = cards_from(game.possible_cards());
                for turn in turns {
                    game.back_to_root();
                    game.play(root_bet);
                    game.play(find(&game, "call").unwrap());
                    let kind = texture(&flop, turn);
                    game.play(turn as usize);
                    if !game.is_terminal_node() && !game.is_chance_node() {
                        add_current(&game, &mut turn_donk[kind]);
                    }
                }
            }
        }
    }

    for kind in 0..5 {
        nodes.push((format!("T{kind}"), turn_check[kind].pack()));
        nodes.push((format!("Tb{kind}"), turn_bet[kind].pack()));
        nodes.push((format!("Td{kind}"), turn_donk[kind].pack()));
        nodes.push((format!("R{kind}"), river[kind].pack()));
        nodes.push((format!("Rb{kind}"), river_bet[kind].pack()));
    }

    println!("  exported {} nodes", nodes.len());
    SolvedFlop {
        board: board.to_string(),
        high,
        mid,
        low,
        paired,
        suits,
        span,
        exploit,
        nodes,
    }
}

fn main() {
    let ip = mark_range(IP);
    let oop = mark_range(OOP);
    let three = mark_range(THREE);
    let utg = mark_range(UTG);
    let hj = mark_range(HJ);
    assert_eq!(class169(card_from_str("As").unwrap(), card_from_str("Ah").unwrap()), 12);
    assert_eq!(ip[12], 1);
    assert_eq!(three[12], 1);

    let started = Instant::now();
    let mut flops = Vec::new();
    for board in FLOPS {
        flops.push(solve_flop(board));
    }

    let mut body = String::new();
    body.push_str("{\n");
    body.push_str("  \"engine\": \"postflop-solver\",\n");
    body.push_str("  \"revision\": \"9d1509fe5077d019825f833eed04b16d342dfda1\",\n");
    body.push_str("  \"algorithm\": \"Discounted CFR\",\n");
    body.push_str("  \"actions\": [\"f\", \"c\", \"b\", \"a\"],\n");
    body.push_str("  \"betPot\": 0.66,\n");
    body.push_str("  \"raiseMultiple\": 2.5,\n");
    body.push_str("  \"openToBb\": 2.5,\n");
    body.push_str("  \"startingPot\": 550,\n");
    body.push_str("  \"effectiveStack\": 9750,\n");
    body.push_str(&format!("  \"ranges\": {{\"ip\": \"{IP}\", \"oop\": \"{OOP}\", \"three\": \"{THREE}\", \"utg\": \"{UTG}\", \"hj\": \"{HJ}\"}},\n"));
    body.push_str("  \"inRange\": {\n");
    body.push_str(&format!("    \"ip\": [{}],\n", json_flags(&ip)));
    body.push_str(&format!("    \"oop\": [{}],\n", json_flags(&oop)));
    body.push_str(&format!("    \"three\": [{}],\n", json_flags(&three)));
    body.push_str(&format!("    \"utg\": [{}],\n", json_flags(&utg)));
    body.push_str(&format!("    \"hj\": [{}]\n", json_flags(&hj)));
    body.push_str("  },\n");
    body.push_str("  \"flops\": [\n");
    for (index, flop) in flops.iter().enumerate() {
        body.push_str("    {\n");
        body.push_str(&format!("      \"board\": \"{}\",\n", flop.board));
        body.push_str(&format!(
            "      \"high\": {}, \"mid\": {}, \"low\": {}, \"paired\": {}, \"suits\": {}, \"span\": {},\n",
            flop.high, flop.mid, flop.low, flop.paired, flop.suits, flop.span
        ));
        body.push_str(&format!("      \"exploitability\": {:.4},\n", flop.exploit));
        body.push_str("      \"nodes\": {\n");
        for (node_index, (name, bytes)) in flop.nodes.iter().enumerate() {
            let comma = if node_index + 1 == flop.nodes.len() { "" } else { "," };
            body.push_str(&format!("        \"{name}\": {}{comma}\n", json_bytes(bytes)));
        }
        body.push_str("      }\n");
        body.push_str(if index + 1 == flops.len() { "    }\n" } else { "    },\n" });
    }
    body.push_str("  ]\n}\n");

    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/lib/gto-strategy.json");
    fs::write(&path, body).unwrap();
    println!(
        "wrote {} ({:.1}s)",
        path.display(),
        started.elapsed().as_secs_f64()
    );
}
