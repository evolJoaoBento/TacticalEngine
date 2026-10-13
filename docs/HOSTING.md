# Hosting the game for friends

How to run Tactical Engine on your own machine so friends can play it over the internet
(`docs/SERVER.md`, phase 5, slices 2 to 5).

**What this gives you today:** each friend signs in to an account on your server, and joins **your game**
with its invitation. You host it from the menu, as a lobby: your friends join it, take their seats, and you start
it together. Everybody at it sees what everybody else does, and you say who plays which character.
Each friend plays the character you seated them in and nobody else, with a selection of their own; you play
every character nobody is seated in. A question - a roll, how a hit lands, a death move, a line of a
conversation - is put to whoever plays the character it is about, and the others see whom it waits on. The
server's game is the one that counts (phase 5, slice 1), and saves are kept on your machine.

**Not yet:** a rest is yours to call, and you choose everybody's downtime moves.

## What it is

- **The Rust server** (`server/`, `tactical-serve`) serves the game, the accounts, the saves and the games
  themselves (`/__play`, a websocket). It listens on `127.0.0.1:8430`: this machine only.
- **A tunnel** is a program on your machine that friends reach at a public `https://` address. It passes
  their requests on to the server on this machine. It gives you HTTPS without certificates, and nothing on
  your router has to be opened.

Do not forward a port on your router to the server instead. That would be plain HTTP, and every sign-in and
session cookie would cross the internet unencrypted.

## Once

```bash
npm install
npm run models          # the 3D models, from Hugging Face
```

You also need Rust installed (`rustup`; see `docs/SERVER.md`, "Running it").

## Each time

1. **Build the game for the server, and start it:**

   ```bash
   npm run build:server   # the engine, and the page built to play against the server (dist-server/)
   npm run server         # serves it at http://127.0.0.1:8430/
   ```

   Open `http://127.0.0.1:8430/` yourself and sign in. The server prints where it keeps its files: your
   accounts and saves are in `data/`, which git ignores.

2. **Make your friends' accounts, on this machine.** On `http://127.0.0.1:8430/`, sign out, choose to make
   an account, and make one for each friend with a password you then give them. From beyond this machine
   nobody can make an account unless you start the server with `--sign-up`:

   ```bash
   npm run server -- --sign-up
   ```

   Anybody who has your tunnel's address can then make one. Use it for an evening and start the server
   again without it.

3. **Start a tunnel to `http://127.0.0.1:8430`,** with whichever tunnel program you use. It gives you a
   public `https://...` address.

4. **Host your game, and invite your friends.** In the menu, **Play Together** lists every game you can
   load, and its saves: choose one to host. It opens as a lobby, **Gathering**, over the board, with the
   invitation: a link to the address you opened the game at, ending in `?join=...`. If you opened it at
   `http://127.0.0.1:8430`, send your friends the tunnel's address with the same `?join=...` on the end. A
   friend signed in opens it, or pastes it into **Join a game** under Play Together, and joins your lobby.

5. **Take your seats, and start.** The lobby lists everybody at the game, and each character with who plays
   it. Each friend takes a character nobody has, or leaves their own; you choose for anybody. Whoever nobody
   takes, you play. Nobody plays anybody until you press **Start**, and then everybody starts at once.

6. **Play.** Once the game has started only you, the host, change who plays whom (the settings' **Players**,
   Esc); your friends see it. A friend seated in nobody watches: they can select nobody and do nothing until you
   seat them. A friend who comes late, with the link, joins the game as it is. The game's saves are yours: only
   you save it, into your saves, and only you load a save into it. A save remembers who played whom: host it
   again from Play Together and the lobby keeps each friend's character for them ("Kept for ..."), seating them
   in it the moment they join with the new link.

A game opened the ordinary way - New Game, Load Game - is still yours alone until somebody joins it with the
link in the settings: it starts at once, with no lobby.

## What the server needs from the tunnel

- **HTTPS at the public address.** The session cookie is then marked `Secure`, so a browser never sends it
  over plain HTTP.
- **The public host name, in `Host` or in `X-Forwarded-Host`.** Some tunnels pass the browser's `Host` on
  unchanged. Others rewrite it to `127.0.0.1:8430` and say the public name in `X-Forwarded-Host`. The server
  takes either. It checks every sign-in, every save and every game's websocket against the host the page
  was loaded from, so a page on another site cannot act as your friend. A tunnel that sends neither cannot
  be used.
- **Websockets.** The games are played over one (`/__play`).

**Checking it works:** open the public address in a browser that is not signed in to anything.
- The sign-in card shows, and a friend's account signs in.
- The menu shows the account's name.
- Opening a game, the game plays.

If sign-in says *sent from another origin*, the tunnel is sending neither host name above.
`npm run test:e2e:tunnel` runs this same check against a tunnel that rewrites `Host`, on this machine.

## What friends cannot do

These hold for anything that reaches the server from beyond this machine, which is everything through a
tunnel:

- **Sign in as `admin` with the password it was made with** (`admin`). That password works only on this
  machine. There is no way to change a password yet, so this is what keeps the default harmless.
- **Make an account**, unless the server was started with `--sign-up`.
- **See the card art in `public/cards/`.** It is reference art for this machine only, never handed on.
  Friends see the cards drawn from their numbers instead.
- **Use the test driver's hands** (wounding somebody, placing them, handing them cards). Only a server
  started for the tests takes those.

## Stopping

Stop the tunnel, then the server (Ctrl+C). A game is kept for ten minutes after its player's connection
drops, and goes when the server stops. Saves stay in `data/`.
