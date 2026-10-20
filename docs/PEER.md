# Peer to peer: a shared game with no server

A shared game played browser to browser (begun 17 October 2026, on the `peer-to-peer` branch). The Rust server
(`docs/SERVER.md`) hosts games for players who reach it. A **peer game** needs no server at all: the host's page
keeps the game, and each guest's page connects straight to it over WebRTC. It works from a static build
(`npm run build`) served from anywhere, and from the dev server.

## The shape

```
Host's browser                                               Guest's browser
  the page: predicts, draws (WasmGame + Wire)                  the page: predicts, draws (WasmGame + Wire)
    | MessagePort (link.ts)                                      |
  HostTable (host-table.ts)  <------- RTCDataChannel --------->  LinkTransport (link.ts)
    an engine of its own (WebAssembly):
    the game everybody plays
```

- **The host's page is the server.** `HostTable` answers what `play.rs` answers, in the same shapes: `open`, `join`,
  `call`, `ask`, `resume`, `seat`, `start`, `say`, and the pushes `{ push }`, `{ table }` and `{ chat }`. So the wire
  (`wire.ts`) and everything that reads the table (`shared-game.ts`, the lobby, the players' panel, the chat, the
  "Waiting for ..." line) work at a peer game exactly as at a server's. The rules about who may act are the
  engine's (`engine::game::seats`), told whom they play for before each intent (`restoreSeating`), so they are not
  written again.
- **The host plays through the table too**, over a `MessagePort`, so the host's page is held to the game as a
  guest's is, and a page that parts from it is stood where it says. The host's page runs two engines: the one it
  predicts with, as every page does, and the table's.
- **A guest meets the host before their page boots** (`ui/PeerJoin.tsx`). Once the channel is open, the guest reads
  the project the game is played over (`{ op: "project" }`), boots over it, and the wire joins the game over the
  same channel.

## Finding each other: codes carried by hand (the default chosen)

WebRTC needs the two pages to exchange a description of themselves once before they can connect. With no server
to carry it, the players carry it themselves (`connect.ts`):

1. In the lobby, the host presses **Invite a player** and sends the code it writes, by chat, mail or anything else.
2. The guest picks **Peer to Peer -> Join** in the menu, gives a name, pastes the code, and sends back the reply
   code their page writes.
3. The host pastes the reply under that invitation and presses **Connect**. The guest's page boots into the lobby.

One invitation is for one guest; another guest needs another.

**The other way round: the guest's code first.** A host need not be waiting with an invitation. The guest's page
writes a code of its own (it says who they are), the host pastes it under **A player sent you a code?** in the lobby
or the players' panel (Escape, in the game) and presses **Answer**, and the guest pastes the answer the host's page
writes. This is how a guest comes back (below), and the join screen offers it too (**No code? Write one for my
host**).

There are four kinds of code - the host's invitation, the guest's reply, the guest's own code, the host's answer -
and each box takes only its own, saying which it wanted when another is pasted. A code is `TE1.` followed by the
description, deflated and in URL-safe base64. A page finds the address the internet sees it at with a public STUN server
(`stun.l.google.com`), which learns only that address, never anything of the game. `?ice=none` asks no STUN
server, which is enough on one machine or one network; the tests use it.

**What will not connect:** two players both behind networks that let no stranger in (some phone networks, some
offices). That needs a relay (TURN), which this does not have.

## A link instead of codes, where the Rust server serves the page

The codes need carrying by somebody. Where the Rust server serves the page - `npm run dev`, or a build it serves
through the tunnel (`docs/HOSTING.md`) - it carries them, and the players paste nothing (`server/serve/src/peer.rs`,
`src/game/peer/relay.ts`):

1. The host's page, signed in, opens a **room** at the server's relay as the game opens, and the lobby (or the
   players' panel) shows **Send everybody this link** - `/?peer=join&room=<id>`.
2. A guest opens it, gives a name and presses **Join**. Their page leaves its own code at the room (the guest-first
   code above) - a **knock** - and waits ("Waiting for your host to let you in…", five minutes at most). The host's
   page takes what was left at its room every second, and asks the host over the lobby or the game: **At the door -
   Gus wants to join - Let in / Turn away** (`ui/PeerKnocks.tsx`). Let in, the host's page answers the code, the
   guest's page takes the answer, and the channel opens; turned away, the guest's page says "The host did not let you
   in." A guest needs no account.
3. **Coming back is by itself.** A knock from a player already at the game - by their tab's id - is let in without
   asking. Cut off, the guest's page knocks at the room again at once ("Reconnecting to your host…"), and is back in
   a few seconds; reloaded, it joins again without a click. The codes are shown only if the room does not answer.

**The host removes a guest** with **Remove** beside their name under **Your guests** (the lobby, or the players'
panel): their page is told and let go, their seats are nobody's (the host plays those characters), and everybody is
told the table. The removed guest's page says "The host removed you from the game. You play on alone.", drops the
table and plays on by itself, and does not knock again; opened again from the link, they knock as anybody does, and
it is the host's to let them in again. Codes carried by hand are the host's consent already: the host pastes them.

Only the codes pass through the server, and only until they are taken: nothing of the game does. The relay keeps its
rooms in memory alone, never in `data/`. A room is as hard to guess as a game's invitation, and goes ten minutes after
its host's page last asked at it; a code is at most 16 KB, a room holds at most 32 knocks not yet taken and 256 in
all, and there are at most 500 rooms. The relay changes nothing about who can reach whom: two players both behind
strict networks still cannot connect, with or without it.

Where there is no server - a static build, or a page whose host is not signed in - there is no room, no link, and
the codes are carried by hand as above. The codes are always offered beside the link, for anybody it does not work
for.

## Who is who

There are no accounts. A page's id is made for the tab (`sessionStorage`), so a reload keeps it and another tab,
even of the same browser, is somebody else. Its name is the one given (`?as=`, else the last one given, kept in
the browser). The id a guest gives is taken as theirs. A guest who says they are the host is turned away. Beyond
that the host trusts the guests' word about who they are, since anybody the host invites is somebody the host
chose. The same goes for their name across evenings: a tab's id is new each evening, so a save knows its players by
name as well (below).

## What the table refuses, as the server does

- No page tells the game how its own stands (`NEVER_TOLD`).
- The test driver's hands (`TEST_HANDS`) are taken from the host's page alone, and only in development.
- Only the host opens the game, starts it, says who plays whom once it has started, loads a save into it, and begins
  another project in it (`begin`: a camp's portal taking everybody into an adventure, the table kept, the guests
  pushed the project with the board, as `play.rs` does). Anybody offers an adventure of their own for the host to
  begin (`offer`), a project the engine would open, as the server's table keeps one.
- A guest takes a seat nobody has, or leaves their own, before the start.
- The host's dice are the game's: the host is trusted, since the game is in their browser anyway.

## Long messages

A data channel takes a message only so long - a browser's `max-message-size`, a quarter of a megabyte or less - and a
project is often longer: a New Game camp with the SRD's characters laid in it is about 370 KB, the Ashwell over a
megabyte. A guest could not join a peer game at a camp at all until a channel sent a long text in pieces (`pieces`,
`PIECE_LONGEST` characters each) and put them together again as they came (`Joiner`, `link.ts`) - in order, as the
channel keeps them. A port takes any length, and is not cut.

## Saves

The host's page saves its own game into its own browser, as a game played alone does - with who played whom kept
beside it (`peer/table-saves.ts`): the seats, those kept for players not back yet, and the name of everybody in
them (`SaveSlot.seats`, `SaveSlot.names`). **Load** reads the save from the host's browser and loads it into the
table's game (`{ op: "load" }`), everybody's page following, and everybody is seated again as the server seats
them: each player at the game in their own, the others' kept for them - "Kept for Gus" in the lobby - until they
come.

A player's id is their tab's, so another evening every id is new. A seat is matched to a player by the id it was
saved with, or else by the name that id went by - alike but for case and the space around it - so Gus, coming from
any browser as Gus, is seated in his own as he joins, and the host in theirs. Two players going by one name would
share the match: the first to come takes the seats. A guest's page saves nothing worth having: the game is the
host's.

## A guest coming back

No server means nothing can carry the codes but the players: a guest whose link has truly gone cannot be put back
without them. What is done instead:

- **A link is known to be gone.** The channel closes when WebRTC says its connection failed or closed, which a
  network gone never says on the channel itself. The host's page shows the guest away (`(away)` beside their
  name), and the others are told.
- **Cut off in the same tab, the game goes on where it was** (`ui/PeerRejoin.tsx`). The guest's page says it has
  lost the host, plays on alone, and writes the guest's own code at once. The host answers it, the guest pastes the
  answer, and the guest's wire - which waited for the link instead of giving up after its tries (`heldLink`,
  `peer-play.ts`) - asks the table for the game (`resume`) and is stood where it is. Nothing boots again, and nothing
  played meanwhile parts from the host's game: the guest's page is stood where the host's is.
- **A page opened again** (reloaded, or its tab restored) shows the join screen; the guest writes their own code
  from it, and boots into the game going on, not the lobby.
- **Either way they are the same player, their seat still theirs**: a tab keeps its id across a reload.

## What it does not do yet

- **With no server, coming back takes the host's hand**, as above: two codes, carried between the two of you. Where the
  Rust server serves the page, its relay carries them (above).
- **The game ends with the host's page.** Nothing is handed on, as the server hands on a game whose host has
  gone.
- **A different project, opened by the host after boot,** is played alone. Only the game the page boots with is
  the peer game - and an adventure the host begins at a camp's portal, which the table goes into together (`begin`).
- No friends, no invitation links, no list of games to join: those are the server's.

## Running it

- **Menu:** **Peer to Peer** -> give your name -> **Join** a game, or host one of your games (or a save) from the
  list.
- **By address:** `/?peer=host&as=Hana` hosts the demo as a lobby; `/?peer=join&as=Gus` joins. Add `&ice=none`
  on one machine.
- **Tests:** `server/serve/src/peer.rs` and `server/serve/tests/peer_routes.rs` (the relay: who may open a room, a knock
  taken once and answered once and only by the host, the limits, a room gone), `tests/e2e/peer-relay.spec.ts` (on the
  server alone: the host's link, a guest with no account joining by one click and let in, back by itself after a drop
  and after a reload; a stranger turned away; a guest removed, told so, not back by themselves, let in again), `src/game/peer/*.test.ts` (the relay asked from the page; the table played by the real engine; the link, and a guest's link lost and
  come back; the codes, each of its kind; a save's seats, matched by name), `tests/e2e/peer-saves.spec.ts` (an evening
  saved and hosted again from a new tab, the guest's seat kept and theirs by name as they come from a browser of
  their own), `tests/e2e/peer-rejoin.spec.ts` (a guest cut off in the same tab, and one
  whose page was opened again, each back by their own code and the host's answer, playing on, nothing parted), and
  `tests/e2e/peer.spec.ts`: two browsers and no server, the codes carried through the very boxes a player pastes
  into, a guest seated in the lobby, the game started, each playing their own, and a fight whose GM's turn the
  guest hands over, played on the host's table, the round going on on both pages, the logs alike, nothing parted.
  It runs in the ordinary e2e run, and is skipped in the server's run, which has a server.
  `npm run test:e2e:peer-static` builds the game statically, serves it with `vite preview` - no server of any
  kind - and plays on it the invitation, the lobby and play, both ways a guest comes back, and a save hosted again
  (not the menu's, nor the fight's, which moves a character by the test driver's hand, which a build refuses).

## Files

| File | What |
| --- | --- |
| `src/game/peer/host-table.ts` | the host's table: `play.rs`'s shared game, in the host's page |
| `src/game/peer/link.ts` | a link (port or data channel) and the page's transport over one; a long text sent over a channel in pieces |
| `src/game/peer/connect.ts` | WebRTC: the invitation, the reply, the codes |
| `src/game/peer/peer-play.ts` | the page's peer mode: who it is, the table, the wire's way in, inviting |
| `src/game/ui/PeerJoin.tsx` | the guest's screen before boot |
| `src/game/ui/PeerInvites.tsx` | the host's invitations, and the answer to a player's own code, in the lobby and the players' panel |
| `src/game/ui/PeerRejoin.tsx` | a guest cut off from the host, coming back in the same tab; or told they were removed |
| `src/game/ui/PeerKnocks.tsx` | the host's door: who knocked at the room, let in or turned away |
| `src/game/peer/table-saves.ts` | the host's saves, who played whom kept with each |
| `src/game/peer/relay.ts` | the server's relay, from the page: a room, knocks, answers, the link |
| `server/serve/src/peer.rs` | the relay: the codes carried, in memory, for those who open a room's link |
| `src/game/wasm-game.ts` | the host's table made beside the page's engine; the wire given the peer way in |
