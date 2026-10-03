//! Where to draw a conversation that has never been drawn (`src/engine/dialogue/layout.ts`): distance
//! from the start picks the column, order of discovery the row, so a conversation reads left to right
//! the way it is played. A node that carries a position keeps it; nodes nothing reaches go in a column
//! of their own past the end. The graph readers - dangling links, unreachable nodes - sit here too, as
//! the same traversal over the same graph.

use crate::dialogue::schema::{CanvasPoint, Dialogue, DialogueNode};
use crate::js;
use std::collections::{HashMap, HashSet};

pub const DEFAULT_COLUMN_WIDTH: f64 = 320.0;
pub const DEFAULT_ROW_HEIGHT: f64 = 200.0;

/// Every node a node can lead to, in the order an author would read them.
pub fn targets_of(node: &DialogueNode) -> Vec<&str> {
    let mut targets: Vec<&str> = Vec::new();
    targets.extend(node.goto.as_deref());
    for choice in node.choices.iter().flatten() {
        targets.extend(choice.goto.as_deref());
        if let Some(check) = &choice.check {
            targets.extend(check.goto_on_success.as_deref());
            targets.extend(check.goto_on_failure.as_deref());
        }
    }
    targets
}

/// A position for every node, in the dialogue's order.
pub fn layout_dialogue(dialogue: &Dialogue, column_width: f64, row_height: f64) -> Vec<(String, CanvasPoint)> {
    let by_id: HashMap<&str, &DialogueNode> = dialogue.nodes.iter().map(|node| (node.id.as_str(), node)).collect();
    let mut depth: HashMap<&str, i64> = HashMap::new();

    // Breadth-first, so a node's column is its shortest distance from the start.
    let mut queue: Vec<&str> = Vec::new();
    if by_id.contains_key(dialogue.start.as_str()) {
        queue.push(&dialogue.start);
        depth.insert(&dialogue.start, 0);
    }
    let mut head = 0;
    while head < queue.len() {
        let id = queue[head];
        for target in targets_of(by_id[id]) {
            if !by_id.contains_key(target) || depth.contains_key(target) {
                continue;
            }
            depth.insert(target, depth[id] + 1);
            queue.push(target);
        }
        head += 1;
    }

    let orphan_column = depth.values().copied().max().unwrap_or(-1) + 1;
    // Rows are assigned per column in document order, so adding a node does not reshuffle the others.
    let mut rows: HashMap<i64, i64> = HashMap::new();
    let mut positions: Vec<(String, CanvasPoint)> = Vec::new();
    for node in &dialogue.nodes {
        if let Some(position) = node.position {
            positions.push((node.id.clone(), position));
            continue;
        }
        let column = depth.get(node.id.as_str()).copied().unwrap_or(orphan_column);
        let row = rows.get(&column).copied().unwrap_or(0);
        rows.insert(column, row + 1);
        positions.push((node.id.clone(), CanvasPoint { x: column as f64 * column_width, y: row as f64 * row_height }));
    }
    positions
}

/// Node ids a dialogue links to and does not define, in `sort()`'s order. A dangling link ends the
/// conversation at run time rather than failing it, so this is for an editor or a content test to catch.
pub fn dangling_links(dialogue: &Dialogue) -> Vec<String> {
    let defined: HashSet<&str> = dialogue.nodes.iter().map(|n| n.id.as_str()).collect();
    let mut missing: Vec<String> = Vec::new();
    let mut check = |id: Option<&str>| {
        if let Some(id) = id.filter(|id| !defined.contains(id)) {
            if !missing.iter().any(|m| m == id) {
                missing.push(id.to_string());
            }
        }
    };
    check(Some(&dialogue.start));
    for node in &dialogue.nodes {
        check(node.goto.as_deref());
        for choice in node.choices.iter().flatten() {
            check(choice.goto.as_deref());
            check(choice.check.as_ref().and_then(|c| c.goto_on_success.as_deref()));
            check(choice.check.as_ref().and_then(|c| c.goto_on_failure.as_deref()));
        }
    }
    missing.sort_by(|a, b| js::utf16_cmp(a, b));
    missing
}

/// Nodes no path can reach from the start, in `sort()`'s order.
pub fn unreachable_nodes(dialogue: &Dialogue) -> Vec<String> {
    // A `Map` built from the list: a repeated id is the last node with it.
    let by_id: HashMap<&str, &DialogueNode> = dialogue.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut seen: HashSet<&str> = HashSet::new();
    let mut queue: Vec<&str> = vec![&dialogue.start];
    while let Some(id) = queue.pop() {
        if seen.contains(id) {
            continue;
        }
        let Some(node) = by_id.get(id) else { continue };
        seen.insert(id);
        queue.extend(targets_of(node));
    }
    let mut unreached: Vec<String> = dialogue.nodes.iter().map(|n| n.id.clone()).filter(|id| !seen.contains(id.as_str())).collect();
    unreached.sort_by(|a, b| js::utf16_cmp(a, b));
    unreached
}
