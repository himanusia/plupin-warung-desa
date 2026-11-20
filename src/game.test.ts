import { describe, expect, test } from "bun:test"
import {
	create,
	leave,
	FRY_SECONDS,
	PATIENCE_SECONDS,
	RECIPES,
	ROUND_SECONDS,
	starsFor,
	tap,
	tick,
} from "./game"

const ME = "you"
const first = (state: ReturnType<typeof create>) => {
	tick(state, 1)
	const order = state.orders.find((entry) => entry !== null)
	if (!order) throw new Error("no customer arrived")
	return { order, slot: state.orders.indexOf(order) }
}

/** Collect and cook exactly what a recipe needs, one tap at a time. */
function plate(state: ReturnType<typeof create>, items: readonly string[], at: number) {
	let now = at
	for (const item of items) {
		if (item === "tempe") {
			tap(state, ME, { station: "wajan" }, now)
			now += FRY_SECONDS + 0.1
			tick(state, now)
			tap(state, ME, { station: "wajan" }, now)
		} else tap(state, ME, { station: item as "nasi" | "sambal" }, now)
	}
	return now
}

describe("warung desa rules", () => {
	test("a customer arrives at one second and the same seed gives the same shift", () => {
		const a = create(7)
		const b = create(7)
		for (let t = 1; t <= 60; t += 1) {
			tick(a, t)
			tick(b, t)
		}
		expect(a.orders.map((o) => o?.recipe.id)).toEqual(b.orders.map((o) => o?.recipe.id))
		expect(first(create(7)).order.recipe.id).toBe(first(create(7)).order.recipe.id)
	})

	test("the wok takes three seconds and tempe cannot be taken early", () => {
		const state = create(1)
		expect(tap(state, ME, { station: "wajan" }, 1)).toEqual([{ kind: "frying" }])
		expect(tap(state, ME, { station: "wajan" }, 2)).toEqual([])
		expect(state.plates[ME]).toEqual([])
		expect(tick(state, 1 + FRY_SECONDS)).toEqual([{ kind: "ready" }])
		expect(tap(state, ME, { station: "wajan" }, 5)).toEqual([{ kind: "took", seat: ME, item: "tempe" }])
		expect(state.plates[ME]).toEqual(["tempe"])
		expect(state.wajan.state).toBe("idle")
	})

	test("the right plate is paid with a tip for speed, the wrong plate is thrown away", () => {
		const fast = create(3)
		const { order, slot } = first(fast)
		const done = plate(fast, order.recipe.items, 1.2)
		const [served] = tap(fast, ME, { customer: slot }, done)
		expect(served?.kind).toBe("served")
		expect(fast.coins).toBeGreaterThan(order.recipe.coins)
		expect(fast.coins).toBeLessThanOrEqual(Math.ceil(order.recipe.coins * 1.5))

		const wrong = create(3)
		const next = first(wrong)
		const other = RECIPES.find((recipe) => recipe.id !== next.order.recipe.id)
		plate(wrong, other?.items ?? [], 1.2)
		expect(tap(wrong, ME, { customer: next.slot }, 9)).toEqual([{ kind: "wrong", seat: ME, slot: next.slot }])
		expect(wrong.plates[ME]).toEqual([])
		expect(wrong.coins).toBe(0)
	})

	test("a plate holds three different things, and says so", () => {
		const state = create(1)
		tap(state, ME, { station: "nasi" }, 1)
		expect(tap(state, ME, { station: "nasi" }, 1.1)).toEqual([{ kind: "have", seat: ME, item: "nasi" }])
		tap(state, ME, { station: "sambal" }, 1.2)
		expect(state.plates[ME]).toEqual(["nasi", "sambal"])
	})

	test("two seats keep their own plates but share the wok and the counter", () => {
		const state = create(3)
		const { order, slot } = first(state)
		tap(state, "ana", { station: "nasi" }, 1.1)
		tap(state, "budi", { station: "sambal" }, 1.2)
		expect(state.plates.ana).toEqual(["nasi"])
		expect(state.plates.budi).toEqual(["sambal"])
		// One wok: Ana starts it, Budi cannot start a second batch while it is frying.
		expect(tap(state, "ana", { station: "wajan" }, 2)).toEqual([{ kind: "frying" }])
		expect(tap(state, "budi", { station: "wajan" }, 2.5)).toEqual([])
		// Whoever serves first is paid; the order is gone for the other seat.
		state.plates.ana = [...order.recipe.items]
		expect(tap(state, "ana", { customer: slot }, 3)[0]?.kind).toBe("served")
		expect(tap(state, "budi", { customer: slot }, 3.1)).toEqual([])
		leave(state, "budi")
		expect(state.plates.budi).toBeUndefined()
	})

	test("today's special pays half again on top of the tip", () => {
		const plain = create(3)
		const special = create(3, first(create(3)).order.recipe.id)
		const a = first(plain)
		const b = first(special)
		plate(plain, a.order.recipe.items, 1.2)
		plate(special, b.order.recipe.items, 1.2)
		tap(plain, ME, { customer: a.slot }, 9)
		tap(special, ME, { customer: b.slot }, 9)
		expect(special.coins).toBeGreaterThan(plain.coins)
	})

	test("a customer who waits too long leaves", () => {
		const state = create(5)
		first(state)
		const events = tick(state, 1 + PATIENCE_SECONDS)
		expect(events.some((event) => event.kind === "left")).toBe(true)
		expect(state.left).toBe(1)
	})

	test("the shift ends at ninety seconds with stars from the coins, and nothing counts afterwards", () => {
		const state = create(2)
		state.coins = 112
		const events = tick(state, ROUND_SECONDS)
		expect(events).toContainEqual({ kind: "over", stars: 2 })
		expect(tap(state, ME, { station: "nasi" }, ROUND_SECONDS + 1)).toEqual([])
		expect([0, 59, 60, 110, 160].map(starsFor)).toEqual([0, 0, 1, 2, 3])
	})
})
