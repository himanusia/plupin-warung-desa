# Warung Desa

The official Plupin example game: a village food stall in 3D, up to four players. Customers walk up
with an order, you take rice and sambal, fry tempe in the wok (three seconds), put what they asked for
on the plate and tap the customer. A right plate pays, a fast one pays more, today's special pays half
again, a wrong one is thrown away, and a customer who waits too long storms out. A shift is 90 seconds;
60, 110 and 160 coins are one, two and three stars.

It is an example first. Every Plupin feature a game can use is used **once, in one named place**, so a
creator can read that file and copy it. Official games are published from the official Plupin account
with the same `plupin up` a stranger uses; this repository is pinned at `example/warung-desa` of the
platform and carries no platform code.

The cast is **Plup**, the mascot, in three.js (`createPlup`): the same character as the lobby, moved
by the same clips as every emote. No Roblox rig is used anywhere.

## What it shows

| Where | What it shows |
| --- | --- |
| `src/game.ts` | the rules as pure functions: time comes in as `now`, chance from a seeded generator, a waiting room before the shift. A room can referee the same round later; 9 tests |
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

`@plupin/character` and the current SDK are not on npm yet. Inside a platform checkout (this repo is
pinned at `example/warung-desa`) `vite.config.ts` and `tsconfig.json` resolve them to
`../../packages/*`; set `PLUPIN_CHARACTER` or `PLUPIN_GAME_SDK` to point somewhere else. When they are
published, `bun add` them and delete the aliases. `three` is resolved to this repo's copy so the
character package and the game share one scene graph.

The field exposes `data-orders`, `data-plate`, `data-wajan`, `data-phase` and `data-hits` (pixel
positions of what can be tapped) so a test plays the game the way a person would.

## Controls

Tap a shelf or the wok and your Plup hops there and uses it; tap a customer to serve them. The wok
says **ting!** when the tempe is ready. Sound starts with the first tap; the corner button mutes it.
