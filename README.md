# Shuttle Sticks

An HTML5 stick-figure badminton game. Its gameplay and physics were rebuilt from a
reverse-engineered Flash game; the computer opponent is new. No build step, no dependencies:
open `index.html` in a browser.

## Modes

- **Single Player**: Tournament (five rounds against a fixed ladder), 1v1 and Training.
- **Multiplayer**: Local 1v1 (two players on one keyboard) and Online 1v1.

1v1 is new to this remake: pick your player, then any computer opponent (the flyers excepted,
since the computer can't steer one) and a difficulty. Easy, Normal and Hard play like the
tournament's Round 1, Quarter-Finals and Final Match. Champion is the planner with the mistakes
taken out: near-instant reactions, exact footwork, no mistimed swings, always the best shot. Its
character's speed, jump and power are left as they are. It wins about 93% of points against the
Final-level computer. Tab cycles the
difficulty, and the choice is remembered.

Behind the title menu two computer players with random characters play silently for as long as
the menu is up, with a new pair each time you return to it.

## Online 1v1

Multiplayer → Online 1v1 → **Create Room** gives you a four-character code to send to your
opponent; they pick **Join Room** and type it. Each player picks a character and presses Ready,
and the creator's game starts the match. Both play with the single-player keys. The creator is on
the left, and a YOU marker shows each player which side is theirs. Rematch needs both players to
ask; if one leaves, the other is told.

How it works (`js/online.js`): each screen runs the match and is in charge of its own player,
so both players move, jump and swing with no delay. Your own game decides whether your racket met
the shuttle. When it did, the launch (contact point, power, angle) goes to the other screen, which
launches the same shot from the same moment.

One game at a time owns the shuttle: only that player can hit it, and only that game decides
where it came down and who won the point, so the two screens never award different points. A shot
heading over the net belongs to the opponent from the moment it's hit, so they can return it
without waiting. One that will come down on the hitter's side (a mishit, a serve into the net)
stays the hitter's to hit again. If the flight surprises the owner (a roll over the tape, a bounce
back off the net), it hands the shuttle over when it actually crosses.

The two games keep their clocks in step (pings four times a second, timed from the quickest
exchanges), and every message says when it happened. Each screen shows two clocks. Your half of
the court is drawn as it is now. The opponent is drawn a little in the past: just far enough back
that, in 95% of recent frames, their news for that moment had already arrived (about the one-way
delay plus a frame). Both games step on the same 60 fps timeline, so each frame of the opponent is
one their own screen drew, with the position and swing frame it showed. So their figure is never
a guess. It's their own recorded movement and swing, replayed at normal speed, and it doesn't jump
when news comes in. When the delay changes, the drawing eases onto other frames of theirs rather
than skipping or repeating one. The rare frame that runs ahead of the news is run on from their
held keys and eased back.

The shuttle switches between the two clocks during each flight. After your hit, its drawing
gradually slows to fall back onto their clock by the time they could first reach it. So when their
hit arrives the screen is just reaching that moment, and the shuttle turns at their racket on the
very frame their racket met it. After their hit it gradually speeds back to now before you could
first reach it. How long each change takes comes from the flight itself: where the shuttle will
be, where each player stands, and how fast they can run and jump to reach it. Spread over all that
time, the speed change at its peak is under 10% on a typical shot at a 40 ms ping, about 15% at
100 ms and about 25% at 200 ms. It never goes below 0.6x or above 1.8x, and the pace eases in and
out. Only in the quickest exchanges at the net is there too little time, and then the shuttle can
turn a frame or two from the racket. Their hit's spark and sound, and their points, come when the
drawing gets there. Only the drawing runs on their clock; the flight itself is always where it
really is, so your return is judged on that.

The room's creator can switch prediction off on the Create Room screen. Each screen then draws
exactly what has arrived.

After pairing, the two browsers try to connect directly over WebRTC (`js/net.js`). The room
server passes the connection setup between them, and public STUN servers (Google, Cloudflare)
tell each side its public address. Match traffic then goes straight between the players over two
channels: an unordered one that never resends, for movement and pings, and a reliable one for
hits, points and rematches. Picking players stays on the server. If no direct link forms within
10 seconds, or it drops, the game keeps going through the server as before. Some mobile and office networks block direct links. The corner of the
screen says which is in use: "Direct" or "Relayed", with the ping.

The room server (`server/server.js`) only pairs players by code and passes messages between
them. It needs Node 18 or newer and no packages.

- Local play: `node server/server.js`, then open http://localhost:8787 in two windows (it serves
  the game too). A page opened from disk looks for the server on localhost:8787; `?server=wss://host/ws`
  points it elsewhere.
- On the VM: install `ops/systemd/stickman-rooms.service` (instructions at its top) and reload
  nginx with the `/ws` block in `ops/nginx/stickman.conf`. `ops/deploy.sh` restarts the service
  when `server/` changes, provided `sudo -n systemctl restart stickman-rooms` is allowed;
  otherwise it logs a reminder.

## The computer opponent

The original's computer ran to a spot near the shuttle and swung as soon as it came into a fixed
reach zone. It never knew which part of its swing would meet the shuttle, so it netted about half
its rallies, and it almost never jumped. `js/ai.js` replaces it with one that plans each return:

- After its reaction time, it replays the incoming flight with the game's own physics. Clip
  timing and the frame clock are matched exactly, so it knows which swing frame will be showing
  on every coming frame.
- For each coming frame and each frame of its overhead and underhand swings, it works out where
  to stand, whether and when to jump to get the racket there, and when to start swinging.
- It flies every shot that would come off the racket and drops the ones that would net. It
  scores the rest on how far short in time you will be, and marks down shots that fall apart if
  its feet are a few px off. It jump-smashes high shuttles because those score well.
- Its mistakes are human-sized: reaction time, footwork error, swings a frame off or badly
  mistimed, how tight it plays the net, and how much it goes for winners rather than just getting
  it back. `ROUND_AI` in `js/characters.js` sets them per tournament round. It now plays with
  its character's own speed, jump and power, so Pogo Pete jumps higher than Big Boris.

Calibrated against the same planner fixed at Quarter-Final level, that reference player wins
about 77%, 65%, 53%, 37% and 22% of points against rounds 1 to 5. Planning a return takes well
under a millisecond once warmed up.

## Controls

| | Single player | Local 1v1: P1 | Local 1v1: P2 |
|---|---|---|---|
| Move | ← → / A D | A D | ← → |
| Jump | ↑ / W | W | ↑ |
| Swing | ↓ / S / Space | S / Space | ↓ |

Jetpack Jo and Rocket Rae fly with the mouse and swing on click.

Training puts you against a shot machine that keeps feeding clears, lobs, drops, drives and smashes, and counts your returns, misses and best streak. T toggles the shot trail: the shuttle's predicted flight and landing spot, the same prediction the debug overlay draws. The machine is new to this remake.
P pauses (in the tournament the pause screen shows the bracket), Esc returns to the menu, M toggles sound. Add `?unlockall` to the URL to open every character.

` (backtick) toggles the debug overlay: racket boxes (filled while the swing can still hit), the reach polygon, net boxes, court limits, the predicted shuttle path and landing estimate, the computer's target spot and planned contact point (+), plus live numbers for the shuttle and both players, including the computer's current plan. The setting is remembered between visits.

## What carries over from the original

- The world: a 640×426 stage at 60 fps, gravity 1200, floor at y=400, walls at x=33 and x=607, the net post at 317.25, and the exact net body and net tape boxes.
- Shuttle flight: drag of `0.965^(60·dt)`, collision checked in four sub-steps per frame, the net-tape roll and net-body bounce, wall bounce of 0.8 with a 200 minimum speed, and the original's landing-prediction pass.
- Swings: the per-frame racket angle and hitbox for every swing animation, read from the original timelines. Overhead shot angle is racket rotation + 30°, and late contact past 100° gets 1.25× power. Underhand is a fixed 40° lift. Holding the swing button builds power.
- Serves: serve power and angle, the frame each serve releases on, the service-line clamp, and the floater's pop serve.
- The computer's serve: the original's three serving spots, and jump serves that get more frequent each round.
- Rules and flow: matches to 7, the winner serves, five tournament rounds with a fixed opponent ladder per character (except the finals: where the original pitted Zara, Nimbus and Boris against their own mirror, they now face Turbo, Boris and Pogo Pete), and unlock tiers of 4, 4, 2 and 2.
- Engine timing: integer-millisecond frame timestamps, timeline clips that advance by elapsed time, positions stored in 1/20 px steps, and the original's one-shared-update-list behaviour.
  One deliberate change: the original rounds every position toward the stage's left edge, so a shuttle drifting slowly right falls a little short while one drifting left overshoots. That made shots toward the right-hand player net about twice as often in computer-vs-computer play. Here the shuttle's sideways moves are rounded toward zero in both directions. Flights toward the right-hand side are unchanged bit for bit; flights toward the left land on average 1 px (at most about 7 px) nearer the net.

The art, characters, names, text, sound effects and music are original to this project. Nothing was extracted from the SWF except numeric gameplay data (`js/rigs.js`).

## Files

- `js/rigs.js`: measured swing and hitbox geometry for each body type
- `js/core.js`: frame clock, update list, timeline clips, timers, input
- `js/sim.js`: shuttle, players, match rules, training machine, effects
- `js/ai.js`: the computer opponent
- `js/net.js`, `js/online.js`: Online 1v1 connection and peer-to-peer sync
- `js/version.js`: the build number (stamped by `ops/deploy.sh`)
- `server/server.js`: the room server for Online 1v1 (not published with the game files)
- `js/characters.js`: roster, ladders, unlock tiers
- `js/music.js`: music engine (synth voices, reverb, delay, ducking) and the two tracks, written as note data
- `js/render.js`, `js/ui.js`, `js/audio.js`, `js/main.js`: drawing, screens, sound effects, boot

## Hosting

Live at https://stickman.urbancare.ge, on the urbancare VM. Every push to `main` is published
within about a minute: the VM's `watch-deploy.sh` syncs `~/stickman` and runs `ops/deploy.sh`,
which copies the game files into a new release and switches nginx to it
(`ops/nginx/stickman.conf`). There is no build step there either. Online 1v1 also needs the room
server running there (see Online 1v1 above).

The title screen's bottom-left corner shows which build is live, e.g. `build 12 · fd88f2c`: the
commit count (it only goes up) and the commit. `deploy.sh` writes it into `js/version.js` in each
release; a copy run from the repo says `dev build`. Online, the two games swap builds when they
pair, and if they differ (or one is too old to say) character select asks whoever is behind to
reload instead of letting them start.
