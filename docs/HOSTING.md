# Hosting the game for friends

How to run Tactical Engine on your own machine so friends can play it over the internet
(`docs/SERVER.md`, phase 5, slices 2 to 5).

**What this gives you today:** each friend opens the invitation link you send, makes an account on your server
right there (or signs in to the one they have), and joins **your game**. You host it from the menu, as a lobby: your friends join it, take their seats, and you start
it together. Everybody at it sees what everybody else does, and you say who plays which character.
Each friend plays the character you seated them in and nobody else, with a selection of their own; you play
every character nobody is seated in. A question - a roll, how a hit lands, a death move, a line of a
conversation - is put to whoever plays the character it is about, and the others see whom it waits on. The
server's game is the one that counts (phase 5, slice 1), and saves are kept on your machine.

**A rest is the party's:** anybody who plays a character calls one from the Rest button, everybody agrees to it
or not - one "Not now" calls it off - and each chooses their own characters' two downtime moves. It is taken once
everybody is ready.

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

And a tunnel program. Cloudflare's is free and needs no account for a quick tunnel:

```bash
winget install --id Cloudflare.cloudflared
```

**Change admin's password once,** on this machine: sign in as `admin` / `admin` at `http://127.0.0.1:8430/`, and
in the menu choose **Change password** (beside Sign out). Until you do, `admin` signs in on this machine alone.

## Each time

1. **Build the game for the server, and start it:**

   ```bash
   npm run build:server   # the engine, and the page built to play against the server (dist-server/)
   npm run server         # serves it at http://127.0.0.1:8430/
   ```

   Open `http://127.0.0.1:8430/` yourself and sign in. The server prints where it keeps its files: your
   accounts and saves are in `data/`, which git ignores.

2. **Start a tunnel to the server,** in another terminal:

   ```bash
   cloudflared tunnel --url http://127.0.0.1:8430
   ```

   It prints a public address, `https://<something>.trycloudflare.com`, and passes whatever reaches it on to the
   server on this machine. The address is new each time you start it, and works only while the tunnel and the
   server are both running here. (Any tunnel that gives HTTPS and passes on websockets will do; see "What the
   server needs from the tunnel", below. For an address that stays the same, see "A stable address", below.)

3. **Your friends' accounts are their own, made with an invitation.** Every player has one invitation (the
   menu's **Invite**, beside Change password): a link that makes one account, and is spent once it has. A friend
   opening it is shown the sign-in card ready to make an account; theirs is then made, and they have an invitation
   of their own to pass on. Somebody with only your tunnel's address, or only a game's link, cannot make one.
   You, as admin, see every player there and who invited them, and give anybody a new invitation - one player,
   or **New for everybody**. Each changes their own password from the menu (**Change password**). Friends are in
   the menu too (**Friends**): ask a player by their name, and they accept or decline; whoever's invitation made
   an account is that account's friend from the start. Beside each friend, **Messages** opens what you have written
   each other, outside any game; what they have written you unread is counted there and on **Friends**. A friend
   who is around says so: **online** on the menu, or **in a game**. To let anybody
   who reaches the address make an account, invitation or none, start the server with `--sign-up`
   (`npm run server -- --sign-up`) for an evening, and again without it after.

   The links are made with the address you opened the page at. Opened at `http://127.0.0.1:8430`, send the
   tunnel's address with the same ending (`/?invite=...`).

4. **Host your game, and invite your friends.** In the menu, **Play Together** lists every game you can
   load, and its saves: choose one to host - and above them, **Who can find it**: your friends (the first
   choice), everybody, or only those you send the link. Your friends, or everybody, then see your game in their
   own Play Together and join it with **Join**, no link needed; you change who can find it in the lobby. It opens
   as a lobby, **Gathering**, over the board, with the invitation, which works for anybody you send it to: a link to the address you opened the game at, ending in `?join=...`. If you opened it at
   `http://127.0.0.1:8430`, send your friends the tunnel's address with the same `?join=...` on the end
   (`https://<something>.trycloudflare.com/?join=...`). A friend with an account opens it, or pastes it into
   **Join a game** under Play Together, and joins your lobby. For a friend with no account yet the lobby has a
   second link, your invitation and the game's together (`/?invite=...&join=...`): it makes their account and
   brings them in. It is there while your invitation is not spent.

5. **Take your seats, and start.** The lobby lists everybody at the game, and each character with who plays
   it, and has a place to talk (**Talk**); once the game has started, what was said is in a box above the log, and
   you talk on there. Each friend takes a character nobody has, or leaves their own; you choose for anybody. Whoever nobody
   takes, you play. Nobody plays anybody until you press **Start**, and then everybody starts at once.

6. **Play.** Once the game has started only you, the host, change who plays whom (the settings' **Players**,
   Esc); your friends see it. A friend seated in nobody watches: they can select nobody and do nothing until you
   seat them. A friend who comes late, with the link, joins the game as it is. Only you, the host, save it and
   load a save into it - but the save is everybody's who played: it goes into each one's saves, and any of them can
   host it again from Play Together, even a camp of yours their browser has never had (it is under **Played
   together**). A save remembers who played whom: host it
   again from Play Together and the lobby keeps each friend's character for them ("Kept for ..."), seating them
   in it the moment they join. **A friend coming back needs no new link:** signed in, their own Play Together
   shows your game waiting for them ("Kara kept Violet for you"), whoever you let find it, and **Join** takes
   them to their seat.

   **If you go,** the game goes on: once your page has been closed for half a minute, the running of it passes to
   the first friend still at it, who says who plays whom, starts it, and saves it from then on - into everybody's
   saves, as you did. Come back and you are a player at it.

A game opened the ordinary way - New Game, Load Game - is still yours alone until somebody joins it with the
link in the settings: it starts at once, with no lobby.

## A stable address

The quick tunnel's address is new every time, and a browser keeps a sign-in for one address only, so each evening
your friends need the new address and sign in again. A **named tunnel** keeps one address, say
`https://play.example.com`, for good: your friends bookmark it, and stay signed in there for thirty days after they
sign in (the server keeps the sign-ins in `data/`).

**It needs a domain of your own, on Cloudflare.** A Cloudflare account is free, but Cloudflare publishes a tunnel
only at a name in a domain you have added to it (a "website" in its dashboard): a domain you already own, moved to
Cloudflare's name servers, or one bought from Cloudflare's own registrar. The game gets a name under it, such as
`play.`.

Once, from Cloudflare's dashboard:

1. **Add your domain** to your Cloudflare account, and wait until it says the domain is active.
2. **Make the tunnel:** **Networking** > **Tunnels** > **Create a tunnel**, give it a name, and choose Windows. It
   shows an install command with the tunnel's token in it: run it in a terminal opened as administrator. It
   installs `cloudflared` as a Windows service, so the tunnel starts with Windows and is always up. Keep the token
   to yourself: anybody who has it can run your tunnel.
3. **Give it the game's address:** the tunnel's **Routes** tab > **Add route** > **Published application**. A
   subdomain (`play`), your domain, and as the **Service URL** `http://127.0.0.1:8430`. Leave the other settings
   as they are: the tunnel then passes your friends' `Host` on unchanged, which is what the server needs.

Then each evening is steps 1 and 3 to 6 of "Each time" above, with no step 2: start the server, host your game,
and send `https://play.example.com/?join=...`. While the server is not running, the address answers with
Cloudflare's error page.

**What it does not change:** every game you host gets a new invitation, `?join=...`. A friend you host a save
for finds the game waiting in their Play Together without it (step 6 above); anybody new to the game still needs
tonight's link.

(Cloudflare also has a command-line way to make a named tunnel - `cloudflared tunnel login`, `create`,
`route dns` and `run`, with a `config.yml` - which needs the same domain. The dashboard's is the shorter.)

## What the server needs from the tunnel

- **HTTPS at the public address.** The session cookie is then marked `Secure`, so a browser never sends it
  over plain HTTP.
- **The public host name, in `Host` or in `X-Forwarded-Host`.** Some tunnels pass the browser's `Host` on
  unchanged. Others rewrite it to `127.0.0.1:8430` and say the public name in `X-Forwarded-Host`. The server
  takes either. It checks every sign-in, every save and every game's websocket against the host the page
  was loaded from, so a page on another site cannot act as your friend. A tunnel that sends neither cannot
  be used.
- **Websockets.** The games are played over one (`/__play`).

**Checking it works:** host a game, and open the lobby's link for somebody new at the public address in a
browser that is not signed in to anything (a private window will do).
- The sign-in card shows, saying you have been invited to a game, ready to make an account.
- Made, the page opens on your game, and the lobby lists both of you.
- Opening the game's link alone, or the address alone, the card signs in but makes no account.

If sign-in says *sent from another origin*, the tunnel is sending neither host name above.
`npm run test:e2e:tunnel` runs this same check against a tunnel that rewrites `Host`, on this machine.

## What friends cannot do

These hold for anything that reaches the server from beyond this machine, which is everything through a
tunnel:

- **Sign in as `admin` with the password it was made with** (`admin`). That password works only on this
  machine; once you change it, `admin` signs in from anywhere with the new one.
- **Make an account** without a player's invitation not yet spent, unless the server was started with
  `--sign-up`.
- **See the card art in `public/cards/`.** It is reference art for this machine only, never handed on.
  Friends see the cards drawn from their numbers instead.
- **Use the test driver's hands** (wounding somebody, placing them, handing them cards). Only a server
  started for the tests takes those.

## Stopping

Stop the tunnel, then the server (Ctrl+C). A game is kept for ten minutes after its player's connection
drops, and goes when the server stops. Saves stay in `data/`.

A page whose connection drops tries to connect again of itself for about a minute, and is back where it was. The
server beats every connection every twenty seconds, so the tunnel never shuts one as idle, and a connection that
goes silent for a minute is closed and opened again.
