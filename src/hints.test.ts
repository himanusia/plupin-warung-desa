import { describe, expect, test } from "bun:test"
import { begin, create, type Item, join, tick, type State } from "./game"
import { nextHint } from "./hints"

const shift = (seats: string[] = ["you"]) => {
	const state = create(3)
	for (const seat of seats) join(state, seat)
	begin(state)
	tick(state, 1)
	return state
}
const first = (state: State) => state.orders.findIndex(Boolean)

describe("the next hint", () => {
	test("nothing before the shift or after it", () => {
		const state = create(1)
		join(state, "you")
		expect(nextHint(state, "you")).toBeNull()
		begin(state)
		state.over = true
		expect(nextHint(state, "you")).toBeNull()
	})

	test("an empty plate points at the first thing the oldest order needs", () => {
		const state = shift()
		const slot = first(state)
		const needs = state.orders[slot]?.recipe.parts[0] as Item[]
		const hint = nextHint(state, "you")
		expect(hint?.kind === "take" || hint?.kind === "fry").toBe(true)
		expect(hint?.mark).not.toBeNull()
		expect(needs.length).toBeGreaterThan(0)
	})

	test("a matching plate points at the customer to serve", () => {
		const state = shift()
		const slot = first(state)
		state.plates.you = [...((state.orders[slot]?.recipe.parts[0] ?? []) as Item[])]
		expect(nextHint(state, "you")).toMatchObject({ kind: "serve", mark: { customer: slot } })
	})

	test("a wrong plate says to throw it away at a customer", () => {
		const state = shift()
		state.plates.you = ["kerupuk", "nasi", "sambal"]
		state.orders = state.orders.map((order) => (order ? { ...order, recipe: { ...order.recipe, parts: [["tempe", "sambal"]] } } : order))
		expect(nextHint(state, "you")?.text).toContain("salah")
	})

	test("a teammate's frying tempe asks for help at the wok, once stirred it does not", () => {
		const state = shift(["ana", "budi"])
		state.wajan = { state: "frying", since: 1, by: "ana", stirred: false }
		expect(nextHint(state, "budi")).toMatchObject({ kind: "team", mark: { station: "wajan" } })
		expect(nextHint(state, "ana")?.kind).not.toBe("team")
		state.wajan = { state: "frying", since: 1, by: "ana", stirred: true }
		expect(nextHint(state, "budi")?.kind).not.toBe("team")
	})

	test("ready tempe says to take it", () => {
		const state = shift()
		state.wajan = { state: "ready", stirred: false }
		expect(nextHint(state, "you")).toMatchObject({ kind: "fry", mark: { station: "wajan" } })
	})
})
