# Shuttle Sticks

An HTML5 stick-figure badminton game. Its gameplay, physics and AI were rebuilt from a
reverse-engineered Flash game. No build step, no dependencies: open `index.html` in a browser.

## Modes

- **Single Player**: Tournament (five rounds against a fixed ladder), 1v1 and Training.
- **Multiplayer**: Local 1v1, two players on one keyboard.

1v1 is new to this remake: pick your player, then any computer opponent (the flyers excepted,
since the computer can't steer one) and a difficulty. Easy, Normal and Hard play like the
tournament's Round 1, Quarter-Finals and Final Match. Tab cycles the difficulty, and the choice is remembered.

Behind the title menu two computer players with random characters play silently for as long as
the menu is up, with a new pair each time you return to it. The original's computer only ever
played the right-hand side; the demo's left-hand player runs the same logic on a mirrored court.

## Controls

| | Single player | Local 1v1: P1 | Local 1v1: P2 |
|---|---|---|---|
| Move | ← → / A D | A D | ← → |
| Jump | ↑ / W | W | ↑ |
| Swing | ↓ / S / Space | S / Space | ↓ |

Jetpack Jo and Rocket Rae fly with the mouse and swing on click.

Training puts you against a shot machine that keeps feeding clears, lobs, drops, drives and smashes, and counts your returns, misses and best streak. T toggles the shot trail: the shuttle's predicted flight and landing spot, the same prediction the debug overlay draws. The machine is new to this remake.
P pauses (in the tournament the pause screen shows the bracket), Esc returns to the menu, M toggles sound. Add `?unlockall` to the URL to open every character.

` (backtick) toggles the debug overlay: racket boxes (filled while the swing can still hit), the reach and computer-swing polygons, net boxes, court limits, the predicted shuttle path and the AI's landing estimate and target, plus live numbers for the shuttle and both players. The setting is remembered between visits.

## What carries over from the original

- The world: a 640×426 stage at 60 fps, gravity 1200, floor at y=400, walls at x=33 and x=607, the net post at 317.25, and the exact net body and net tape boxes.
- Shuttle flight: drag of `0.965^(60·dt)`, collision checked in four sub-steps per frame, the net-tape roll and net-body bounce, wall bounce of 0.8 with a 200 minimum speed, and the landing-prediction pass the AI uses.
- Swings: the per-frame racket angle and hitbox for every swing animation, read from the original timelines. Overhead shot angle is racket rotation + 30°, and late contact past 100° gets 1.25× power. Underhand is a fixed 40° lift. Holding the swing button builds power.
- Serves: serve power and angle, the frame each serve releases on, the service-line clamp, and the floater's pop serve.
- AI: the target-offset logic, skill rolls, jump and jump-serve choices, the 500 ms swing cooldown, and the round-by-round tuning (speed 1.1 to 1.15, skill 100 to 65).
- Rules and flow: matches to 7, the winner serves, five tournament rounds with a fixed opponent ladder per character (except the finals: where the original pitted Zara, Nimbus and Boris against their own mirror, they now face Turbo, Boris and Pogo Pete), and unlock tiers of 4, 4, 2 and 2.
- Engine timing: integer-millisecond frame timestamps, timeline clips that advance by elapsed time, positions stored in 1/20 px steps, and the original's one-shared-update-list behaviour.
  One deliberate change: the original rounds every position toward the stage's left edge, so a shuttle drifting slowly right falls a little short while one drifting left overshoots. That made shots toward the right-hand player net about twice as often in computer-vs-computer play. Here the shuttle's sideways moves are rounded toward zero in both directions. Flights toward the right-hand side are unchanged bit for bit; flights toward the left land on average 1 px (at most about 7 px) nearer the net.

The art, characters, names, text, sound effects and music are original to this project. Nothing was extracted from the SWF except numeric gameplay data (`js/rigs.js`).

## Files

- `js/rigs.js`: measured swing and hitbox geometry for each body type
- `js/core.js`: frame clock, update list, timeline clips, timers, input
- `js/sim.js`: shuttle, players, AI, match rules, effects
- `js/characters.js`: roster, ladders, unlock tiers
- `js/music.js`: music engine (synth voices, reverb, delay, ducking) and the two tracks, written as note data
- `js/render.js`, `js/ui.js`, `js/audio.js`, `js/main.js`: drawing, screens, sound effects, boot

## Hosting

Live at https://stickman.urbancare.ge, on the urbancare VM. Every push to `main` is published
within about a minute: the VM's `watch-deploy.sh` syncs `~/stickman` and runs `ops/deploy.sh`,
which copies the game files into a new release and switches nginx to it
(`ops/nginx/stickman.conf`). There is no build step there either.
