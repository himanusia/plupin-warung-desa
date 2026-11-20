import { describe, expect, test } from "bun:test"
import {
	begin,
	COMBO_WINDOW,
	create,
	FRY_SECONDS,
	give,
	type GameEvent,
	type Item,
	join,
	leave,
	PATIENCE_SECONDS,
	PESTA,
	PESTA_WINDOW,
	playersOf,
	RECIPES,
	RUSH_SECONDS,
	STIR_SECONDS,
	type State,
	starCoins,
	starsFor,
	tap,
	tick,
} from "./game"

const ME = "you"
const started = (seed: number, seats: string[] = [ME], special: string | null = null, duration = 90) => {
	const state = create(seed, special, duration)
	for (const seat of seats) join(state, seat)
	begin(state)
	return state
}
/** Tick until a customer of the wanted kind is at the counter; returns its slot. */
function arrive(state: State, want: (state: State, slot: number) => boolean, from = 1): { slot: number; at: number } {
	for (let t = from; t < from + 400; t += 0.5) {
		tick(state, t)
		const slot = state.orders.findIndex((order, index) => order && want(state, index))
		if (slot >= 0) return { slot, at: t }
	}
	throw new Error("no matching customer arrived")
}
const any = (state: State, slot: number) => state.orders[slot] !== null
const kinds = (events: GameEvent[]) => events.map((event) => event.kind)

describe("the stall", () => {
	test("nothing runs in the waiting room: no customers, no taps, no clock", () => {
		const state = create(4)
		join(state, ME)
		expect(tick(state, 50)).toEqual([])
		expect(tap(state, ME, { station: "nasi" }, 51)).toEqual([])
		expect(state.over).toBe(false)
		begin(state)
		tick(state, 1)
		expect(state.orders.some(Boolean)).toBe(true)
	})

	test("the same seed gives the same shift", () => {
		const a = started(7)
		const b = started(7)
		for (let t = 1; t <= 60; t += 1) {
			tick(a, t)
			tick(b, t)
		}
		expect(a.orders.map((o) => o?.recipe.id)).toEqual(b.orders.map((o) => o?.recipe.id))
	})

	test("a plate holds three different things, and says so", () => {
		const state = started(1)
		tap(state, ME, { station: "nasi" }, 1)
		expect(tap(state, ME, { station: "nasi" }, 1.1)).toEqual([{ kind: "have", seat: ME, item: "nasi" }])
		tap(state, ME, { station: "kerupuk" }, 1.2)
		tap(state, ME, { station: "sambal" }, 1.3)
		expect(state.plates[ME]).toEqual(["nasi", "kerupuk", "sambal"])
		expect(tap(state, ME, { station: "wajan" }, 1.4)).toEqual([{ kind: "frying", seat: ME }])
	})

	test("the right plate pays with a tip, the wrong plate is thrown away", () => {
		const state = started(3)
		const { slot, at } = arrive(state, any)
		const order = state.orders[slot]
		if (!order) throw new Error("no order")
		state.plates[ME] = [...(order.recipe.parts[0] as Item[])]
		const [served] = tap(state, ME, { customer: slot }, at)
		expect(served?.kind).toBe("served")
		expect(state.coins).toBeGreaterThan(order.recipe.coins)
		expect(state.plates[ME]).toEqual([])

		const next = arrive(state, any, at + 1)
		state.plates[ME] = ["kerupuk", "sambal", "nasi"]
		const [wrong] = tap(state, ME, { customer: next.slot }, next.at)
		expect(wrong).toEqual({ kind: "wrong", seat: ME, slot: next.slot })
		expect(state.plates[ME]).toEqual([])
	})

	test("a customer who waits too long leaves", () => {
		const state = started(5)
		const { at } = arrive(state, any)
		expect(kinds(tick(state, at + PATIENCE_SECONDS))).toContain("left")
		expect(state.left).toBeGreaterThanOrEqual(1)
	})

	test("today's special pays half again", () => {
		const probe = started(3)
		const first = arrive(probe, any)
		const id = probe.orders[first.slot]?.recipe.id ?? null
		const plain = started(3)
		const special = started(3, [ME], id)
		for (const state of [plain, special]) {
			const { slot, at } = arrive(state, any)
			state.plates[ME] = [...((state.orders[slot]?.recipe.parts[0] ?? []) as Item[])]
			tap(state, ME, { customer: slot }, at)
		}
		expect(special.coins).toBeGreaterThan(plain.coins)
	})
})

describe("cooking together", () => {
	test("one wok: the second cook stirs and the tempe is ready sooner, once", () => {
		const state = started(1, ["ana", "budi"])
		expect(tap(state, "ana", { station: "wajan" }, 1)).toEqual([{ kind: "frying", seat: "ana" }])
		// The cook who started it cannot stir her own wok.
		expect(tap(state, "ana", { station: "wajan" }, 1.5)).toEqual([])
		expect(tap(state, "budi", { station: "wajan" }, 2)).toEqual([{ kind: "stirred", seat: "budi" }])
		// A second stir does nothing more.
		expect(tap(state, "budi", { station: "wajan" }, 2.2)).toEqual([])
		const ready = 1 + FRY_SECONDS - STIR_SECONDS
		expect(kinds(tick(state, ready - 0.05))).not.toContain("ready")
		expect(tick(state, ready + 0.01)).toContainEqual({ kind: "ready", stirred: true })
		expect(tap(state, "ana", { station: "wajan" }, ready + 0.5)).toEqual([{ kind: "took", seat: "ana", item: "tempe" }])
	})

	test("alone, the wok takes its full time", () => {
		const state = started(1)
		tap(state, ME, { station: "wajan" }, 1)
		expect(kinds(tick(state, 1 + FRY_SECONDS - 0.05))).not.toContain("ready")
		expect(kinds(tick(state, 1 + FRY_SECONDS + 0.05))).toContain("ready")
	})

	test("a plate can be passed to a cook, as much as fits and without repeats", () => {
		const state = started(1, ["ana", "budi"])
		state.plates.ana = ["nasi", "tempe"]
		state.plates.budi = ["tempe", "sambal"]
		const gave = give(state, "ana", "budi")
		// Budi already has tempe and a full plate would not fit a third item.
		expect(gave).toEqual([{ kind: "gave", from: "ana", to: "budi", items: ["nasi"] }])
		expect(state.plates.ana).toEqual(["tempe"])
		expect(state.plates.budi).toEqual(["tempe", "sambal", "nasi"])
		expect(give(state, "ana", "ana")).toEqual([])
		state.plates.ana = []
		expect(give(state, "ana", "budi")).toEqual([])
		expect(tap(state, "budi", { cook: "ana" }, 2)).toEqual([{ kind: "gave", from: "budi", to: "ana", items: ["tempe", "sambal", "nasi"] }])
	})

	test("pesta orders never come to a cook who works alone", () => {
		const solo = started(9)
		for (let t = 1; t < 600; t += 0.5) {
			solo.orders = solo.orders.map(() => null)
			tick(solo, t)
			expect(solo.orders.some((order) => order && PESTA.includes(order.recipe))).toBe(false)
		}
	})

	test("a pesta order needs two plates from two different cooks", () => {
		const state = started(11, ["ana", "budi"])
		const { slot, at } = arrive(state, (s, i) => (s.orders[i]?.recipe.parts.length ?? 0) === 2)
		const order = state.orders[slot]
		if (!order) throw new Error("no order")
		const [first, second] = order.recipe.parts as [Item[], Item[]]
		state.plates.ana = [...first]
		expect(tap(state, "ana", { customer: slot }, at)).toEqual([{ kind: "half", seat: "ana", slot }])
		expect(state.coins).toBe(0)
		// The same cook cannot also bring the second plate.
		state.plates.ana = [...second]
		expect(tap(state, "ana", { customer: slot }, at + 1)).toEqual([{ kind: "need-partner", seat: "ana", slot }])
		state.plates.budi = [...second]
		const done = tap(state, "budi", { customer: slot }, at + 2)
		expect(done[0]).toMatchObject({ kind: "served", seat: "budi", team: true })
		expect(state.coins).toBeGreaterThan(order.recipe.coins)
		expect(state.orders[slot]).toBeNull()
	})

	test("a pesta order's first plate is lost if nobody brings the other in time", () => {
		const state = started(11, ["ana", "budi"])
		const { slot, at } = arrive(state, (s, i) => (s.orders[i]?.recipe.parts.length ?? 0) === 2)
		state.plates.ana = [...((state.orders[slot]?.recipe.parts[0] ?? []) as Item[])]
		tap(state, "ana", { customer: slot }, at)
		expect(kinds(tick(state, at + PESTA_WINDOW + 0.1))).toContain("half-lost")
		expect(state.orders[slot]?.got ?? []).toEqual([])
	})

	test("serves close together build a combo that pays more; a pause breaks it", () => {
		const state = started(2, ["ana", "budi"])
		const serve = (seat: string, from: number) => {
			const found = arrive(state, any, from)
			const order = state.orders[found.slot]
			state.plates[seat] = [...((order?.recipe.parts[0] ?? []) as Item[])]
			const events = tap(state, seat, { customer: found.slot }, found.at)
			return { served: events.find((event) => event.kind === "served"), at: found.at }
		}
		const a = serve("ana", 1)
		const b = serve("budi", a.at + 0.5)
		expect(a.served).toMatchObject({ combo: 1 })
		expect(b.served).toMatchObject({ combo: 2 })
		const late = serve("ana", b.at + COMBO_WINDOW + 1)
		expect(late.served).toMatchObject({ combo: 1 })
	})

	test("more cooks mean more customers and a higher bar for the stars", () => {
		const count = (seats: string[]) => {
			const state = started(8, seats)
			let arrivals = 0
			let last = 0
			for (let t = 1; t < 80; t += 0.25) {
				tick(state, t)
				if (state.seq !== last) {
					arrivals += state.seq - last
					last = state.seq
				}
				state.orders = state.orders.map(() => null)
			}
			return arrivals
		}
		expect(count(["a", "b", "c"])).toBeGreaterThan(count(["a"]))
		expect(starCoins(1)).toEqual([60, 110, 160])
		expect(starCoins(3)[0]).toBeGreaterThan(starCoins(2)[0])
		expect(starsFor(110, 1)).toBe(2)
		expect(starsFor(110, 3)).toBe(0)
		expect(playersOf(started(1, ["a", "b", "c"]))).toBe(3)
	})

	test("the last stretch is a rush: announced once, and it pays more", () => {
		const state = started(2, [ME], null, 90)
		const events: GameEvent[] = []
		for (let t = 1; t < 90 - RUSH_SECONDS + 1; t += 1) events.push(...tick(state, t))
		expect(events.filter((event) => event.kind === "rush")).toHaveLength(1)
		expect(state.rush).toBe(true)
		const { slot, at } = arrive(state, any, 90 - RUSH_SECONDS + 1)
		const order = state.orders[slot]
		state.plates[ME] = [...((order?.recipe.parts[0] ?? []) as Item[])]
		const [served] = tap(state, ME, { customer: slot }, at)
		expect(served).toMatchObject({ kind: "served" })
		const calm = started(2, [ME], null, 90)
		const a = arrive(calm, any, 1)
		const co = calm.orders[a.slot]
		calm.plates[ME] = [...((co?.recipe.parts[0] ?? []) as Item[])]
		tap(calm, ME, { customer: a.slot }, a.at)
		expect(state.coins / (order?.recipe.coins ?? 1)).toBeGreaterThan(calm.coins / (co?.recipe.coins ?? 1))
	})

	test("the shift ends at its length with stars from the coins, and nothing counts afterwards", () => {
		const state = started(2)
		state.coins = 112
		expect(tick(state, 90)).toContainEqual({ kind: "over", stars: 2 })
		expect(tap(state, ME, { station: "nasi" }, 91)).toEqual([])
		leave(state, ME)
		expect(state.plates[ME]).toBeUndefined()
	})

	test("every recipe is made of things the stalls give", () => {
		const made = new Set<string>(["nasi", "tempe", "sambal", "kerupuk"])
		for (const recipe of [...RECIPES, ...PESTA]) for (const part of recipe.parts) for (const item of part) expect(made.has(item)).toBe(true)
	})
})
