# Warung Desa

The official Plupin example game: a village food stall. Customers walk up with an order, you take
rice and sambal from the shelves, fry tempe in the wok (three seconds), put what they asked for on the
plate and tap the customer. A right plate pays, a fast one pays more, a wrong one is thrown away,
and a customer who waits too long leaves. A shift is 90 seconds; 60, 110 and 160 coins are one, two and
three stars.

It is an example first. Every Plupin feature a game can use is used **once, in one named place**, so a
creator can read that file and copy it. Official games are published from the official Plupin account
with the same `plupin up` a stranger uses; this repository is pinned at `example/warung-desa` of the
platform and carries no platform code.

## What it shows

| Where | What it shows | Status |
| --- | --- | --- |
| `src/game.ts` | the rules as pure functions: time comes in as `now`, chance from a seeded generator, no I/O. A room can referee the same round later, and a whole shift is tested in milliseconds | shipped, 6 tests |
| `src/stage.ts` | `drawCharacter2D` from `@plupin/character`: one rig, one colour per body, a face from `faceCanvas`, clips by name or as keyframes | shipped |
| `src/emotes.ts` | emotes as data: the free ones from `EMOTES`, and the official animated `emote-sorak` as the plain keyframes the shop stores in `assetConfig.anim` | shipped |
| `src/emotes.ts` `WADDLE` | a clip the game authors itself: a clip is only keyframes (`bones`, `frames`, `fps`, `loop`) | shipped |
| `plupin.json` | `engine: "2d"`, `authority: "host"`, one declared leaderboard; the build copies it into `dist/` | shipped |
| `vite.config.ts` | `base: "./"` and a printed bundle size (about 9 KiB gzip) | shipped |
| `Room`, `Peers`, `Interpolator` | up to four players in one warung, teammates interpolated | next |
| `Leaderboard` | the shift's coins, written by the room that refereed it, never by the client | next |
| free roll (`randomness`) | the "pelanggan spesial" of the day, from the platform's source of chance | next |
| in-app purchase | a Σ apron: the game never spends Sigma, the platform charges and tells the game what the player owns | next |

## Play and test

```bash
bun install
bun test src          # the rules
bun run typecheck
bun run build         # prints the bundle size
bun run dev           # http://127.0.0.1:5173
```

`@plupin/character` is not on npm yet. Inside a platform checkout (this repo is pinned at
`example/warung-desa`) `vite.config.ts` and `tsconfig.json` resolve it to `../../packages/character`; set
`PLUPIN_CHARACTER` to point somewhere else. When it is published, `bun add @plupin/character` and delete
the alias.

The field exposes `data-orders`, `data-plate` and `data-wajan` so a test reads the game, not canvas pixels.

## Controls

Tap a shelf or the wok to walk there and use it, tap a customer to serve them. The wok says
"matang!" when the tempe is ready.
