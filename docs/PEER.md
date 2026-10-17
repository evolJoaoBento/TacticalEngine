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

One invitation is for one guest; another guest needs another. A code is `TE1.` followed by the description,
deflated and in URL-safe base64. A page finds the address the internet sees it at with a public STUN server
(`stun.l.google.com`), which learns only that address, never anything of the game. `?ice=none` asks no STUN
server, which is enough on one machine or one network; the tests use it.

**What will not connect:** two players both behind networks that let no stranger in (some phone networks, some
offices). That needs a relay (TURN), which this does not have.

**Other ways it could go, not built:** the Rust server, or any small relay, carrying the codes instead (an
invitation link again, no pasting), or a public broker. Each brings back a server of some kind, which is what
this mode does without.

## Who is who

There are no accounts. A page's id is made for the tab (`sessionStorage`), so a reload keeps it and another tab,
even of the same browser, is somebody else. Its name is the one given (`?as=`, else the last one given, kept in
the browser). The id a guest gives is taken as theirs. A guest who says they are the host is turned away. Beyond
that the host trusts the guests' word about who they are, since anybody the host invites is somebody the host
chose.

## What the table refuses, as the server does

- No page tells the game how its own stands (`NEVER_TOLD`).
- The test driver's hands (`TEST_HANDS`) are taken from the host's page alone, and only in development.
- Only the host opens the game, starts it, says who plays whom once it has started, and loads a save into it.
- A guest takes a seat nobody has, or leaves their own, before the start.
- The host's dice are the game's: the host is trusted, since the game is in their browser anyway.

## Saves

The host's page saves its own game into its own browser, as a game played alone does. **Load** reads the save
from the host's browser and loads it into the table's game (`{ op: "load" }`), everybody's page following. A
guest's page saves nothing worth having: the game is the host's. Who played whom is not kept in such a save yet.

## What it does not do yet

- **A dropped guest comes back with a fresh invitation.** A guest whose channel closes plays on alone; their
  wire gives up after its tries, and the host invites them again. The game is still the host's, and a guest who
  comes back with the same tab is the same player, their seat still theirs.
- **The game ends with the host's page.** Nothing is handed on, as the server hands on a game whose host has
  gone.
- **A different project, opened by the host after boot,** is played alone. Only the game the page boots with is
  the peer game.
- No friends, no invitation links, no list of games to join: those are the server's.

## Running it

- **Menu:** **Peer to Peer** -> give your name -> **Join** a game, or host one of your games (or a save) from the
  list.
- **By address:** `/?peer=host&as=Hana` hosts the demo as a lobby; `/?peer=join&as=Gus` joins. Add `&ice=none`
  on one machine.
- **Tests:** `src/game/peer/*.test.ts` (the table played by the real engine; the link; the codes), and
  `tests/e2e/peer.spec.ts`: two browsers and no server, the codes carried through the very boxes a player pastes
  into, a guest seated in the lobby, the game started, each playing their own, and a fight whose GM's turn the
  guest hands over, played on the host's table, the round going on on both pages, the logs alike, nothing parted.
  It runs in the ordinary e2e run, and is skipped in the server's run, which has a server.
  `npm run test:e2e:peer-static` builds the game statically, serves it with `vite preview` - no server of any
  kind - and plays the first of those tests on it (the fight's moves a character by the test driver's hand, which a
  build refuses).

## Files

| File | What |
| --- | --- |
| `src/game/peer/host-table.ts` | the host's table: `play.rs`'s shared game, in the host's page |
| `src/game/peer/link.ts` | a link (port or data channel) and the page's transport over one |
| `src/game/peer/connect.ts` | WebRTC: the invitation, the reply, the codes |
| `src/game/peer/peer-play.ts` | the page's peer mode: who it is, the table, the wire's way in, inviting |
| `src/game/ui/PeerJoin.tsx` | the guest's screen before boot |
| `src/game/ui/PeerInvites.tsx` | the host's invitations, in the lobby and the players' panel |
| `src/game/wasm-game.ts` | the host's table made beside the page's engine; the wire given the peer way in |
