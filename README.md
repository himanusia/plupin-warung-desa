# Warung Desa

The official Plupin example game: a village food stall in 3D, up to four players. Customers walk up
with an order; you take rice, kerupuk and sambal, fry tempe in the wok, build the plate and tap the
customer. A right plate pays, a fast one pays more, today's special pays half again, a wrong one is
thrown away. A shift is 90 seconds; the last 30 are a rush.

**Playing together is a real advantage, not just louder:** a second cook who taps the frying wok stirs
it and the tempe is done sooner; a cook can pass their plate to another; with two or more cooks,
"pesta" orders need two plates from two different cooks and pay double; serves close together build a
team combo; more cooks bring more customers and raise the star targets (60/110/160 for one cook).

**You play as your Plupin account.** The game reads who you are with `getPlayer()`: name, badge, the
body, colour and skin you made on the platform, and the emotes you own. Skins are platform-wide, so
they follow you here. Signed out, the game asks you to sign in to Plupin first.

It is an example first. Every Plupin feature a game can use is used **once, in one named place**, so a
creator can read that file and copy it. Official games are published from the official Plupin account
with the same `plupin up` a stranger uses; this repository is pinned at `example/warung-desa` of the
platform and carries no platform code.

The cast is **Plup**, the mascot, in three.js (`createPlup`): the same character as the lobby, moved
by the same clips as every emote. No Roblox rig is used anywhere.

## What it shows

| Where | What it shows |
| --- | --- |
| `src/game.ts` | the rules as pure functions: time comes in as `now`, chance from a seeded generator, a waiting room before the shift; stir, pass, pesta orders, combo and rush; 17 tests |
| `src/account.ts` | `getPlayer` and `connectPlayer`: the player's Plupin account, their look and emotes; sign-in gate; friend links |
| `src/hints.ts` | the next sensible step as a pure function (tested), used for the hint line and the pointer in the world |
| `src/settings.ts` | music/effects volume, graphics quality, shake and hints, remembered between visits |
| `src/actors.ts` | `createPlup` as cooks and customers: colour, named faces for moods, accessories on the body bone, a gold apron, hops and squash-and-stretch |
| `src/emotes.ts` | emotes as data: the free ones from `EMOTES`, the official animated `emote-sorak` as the plain keyframes the shop stores, and a clip the game authors itself (`WADDLE`) |
| `src/scene.ts`, `src/toon.ts` | a toon-shaded world that matches the mascot (banded shading, ink outlines), a camera that fits any screen, and a layout that narrows on a phone |
| `src/fx.ts` | juice: tweens, particles, camera shake, hit-stop |
| `src/audio.ts` | music and effects synthesised with Web Audio: no audio files, a mute switch, a faster tune in the last seconds |
| `src/net.ts` | `Room`, `Peers`, the `host` event and the party code: one elected seat runs the rules and publishes the world, the others send taps (`authority: "host"`) |
| `src/roll.ts` | `rollPlatformRandom`: today's special comes from the platform's random number, never `Math.random` |
| `src/board.ts` | `Leaderboard`: reads the declared board. It has no submit, on purpose: see below |
| `src/shop.ts` | `requestPurchase` and `getEntitlements`: a permanent gold apron (Σ20, declared in `plupin.json` `products`); the game never spends Sigma and reads what the player owns back from the platform |
| `plupin.json` | `engine: "3d"`, `authority: "host"`, one declared leaderboard, one product |

## Playing with friends (party)

Press **Ajak teman** on the title screen: the waiting room shows who is in the room, only the host
can press **Mulai**, and **Undang teman** shares the game's link. The platform's own party works too:
in the Plupin lobby press **Undang**, then **Mulai**, and every friend opens the game with a party code
(`?p=<code>`) that seats them in the same room (`new Room({ party })`). A game cannot mint party codes;
the platform's lobby does.

### Why the leaderboard only reads

A score is written by the room that finished a match under the platform's own rules (a turn-based
document), so a game that runs its own rules on the host cannot write one, and a client cannot spoof
one. Warung Desa declares the board `koin` and shows what the platform holds, which is nothing until
a refereed mode exists. It does not pretend otherwise.

## Play and test

```bash
bun install
bun test src          # the rules
bun run typecheck
bun run build         # prints the bundle size
bun run dev           # http://127.0.0.1:5173   (add ?round=20 for a short practice shift)
```

Dependencies are the published packages `@plupin/character` and `@plupin/game-sdk` plus `three`
(`resolve.dedupe` keeps one copy of three so the character and the game share one scene graph). To
play offline as a stand-in player run `plupin dev dist` after `bun run build`.

The field exposes `data-orders`, `data-plate`, `data-wajan`, `data-phase` and `data-hits` (pixel
positions of what can be tapped) so a test plays the game the way a person would.

## Controls

Tap a shelf, the wok or another cook (to pass them your plate) and your Plup hops there and uses it; tap a customer to serve them. The wok
says **ting!** when the tempe is ready. Sound starts with the first tap; the corner button mutes it.

## Settings, tutorial, friends

The gear button opens settings (music and effects volume, graphics quality, screen shake, step hints,
replay the how-to-play card). The first shift opens a short how-to-play card, and a hint line plus a
pulsing marker in the world always point at the next step. In the waiting room and on the result screen
each Plupin player has a **+ TEMAN** button that opens the platform's friends page with their username
filled in (`/friends?add=<username>`).
