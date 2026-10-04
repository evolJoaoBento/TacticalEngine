# Hosting the game for friends

How to run Tactical Engine on your own machine so friends can play it over the internet
(`docs/SERVER.md`, phase 5, slice 2).

**What this gives you today:** each friend signs in to an account on your server and plays **their own
game** there. The server's game is the one that counts (phase 5, slice 1), and their saves are kept on your
machine. **Several people playing one game together is not here yet.** That is the shared game, slice 3 of
phase 5.

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
   again without it. Invitations come with the lobby (slice 5).

3. **Start a tunnel to `http://127.0.0.1:8430`,** with whichever tunnel program you use. It gives you a
   public `https://...` address: send that to your friends.

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
