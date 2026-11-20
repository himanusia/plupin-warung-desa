/**
 * The rules of Warung Desa, and nothing else. No canvas, no DOM, no socket, no clock: time comes in
 * as `now` (seconds since the round began) and chance comes from a seeded generator. That is what
 * lets a room referee the same round later (the referee replays these functions) and what lets the
 * tests below run a whole shift in microseconds.
 */

export type Item = "nasi" | "tempe" | "sambal"
export type StationId = "nasi" | "sambal" | "wajan"
export type Target = { station: StationId } | { customer: number }

export interface Recipe {
	id: string
	name: string
	items: readonly Item[]
	coins: number
}

export const RECIPES: readonly Recipe[] = [
	{ id: "nasi-sambal", name: "Nasi Sambal", items: ["nasi", "sambal"], coins: 8 },
	{ id: "nasi-tempe", name: "Nasi Tempe", items: ["nasi", "tempe"], coins: 10 },
	{ id: "tempe-sambal", name: "Tempe Sambal", items: ["tempe", "sambal"], coins: 10 },
	{ id: "komplit", name: "Komplit", items: ["nasi", "tempe", "sambal"], coins: 16 },
]

export const ROUND_SECONDS = 90
export const FRY_SECONDS = 3
export const PATIENCE_SECONDS = 28
export const SLOTS = 3
export const PLATE_MAX = 3
/** Coins for one, two and three stars. */
export const STAR_COINS = [60, 110, 160] as const

export interface Order {
	id: number
	recipe: Recipe
	arrivedAt: number
}

export type Wajan = { state: "idle" } | { state: "frying"; since: number } | { state: "ready" }

export interface State {
	now: number
	coins: number
	served: number
	left: number
	plate: Item[]
	wajan: Wajan
	orders: (Order | null)[]
	nextOrderAt: number
	seq: number
	over: boolean
	/** Mulberry32 state: advancing it is the only way chance enters the game. */
	seed: number
}

/** What happened, for the screen to react to (a sound, an emote). The rules never read it back. */
export type GameEvent =
	| { kind: "took"; item: Item }
	| { kind: "frying" }
	| { kind: "ready" }
	| { kind: "have"; item: Item }
	| { kind: "full" }
	| { kind: "served"; slot: number; coins: number }
	| { kind: "wrong"; slot: number }
	| { kind: "left"; slot: number }
	| { kind: "over"; stars: 0 | 1 | 2 | 3 }

export function create(seed: number): State {
	return {
		now: 0,
		coins: 0,
		served: 0,
		left: 0,
		plate: [],
		wajan: { state: "idle" },
		orders: Array.from({ length: SLOTS }, () => null),
		nextOrderAt: 1,
		seq: 0,
		over: false,
		seed: seed >>> 0,
	}
}

function random(state: State): number {
	state.seed = (state.seed + 0x6d2b79f5) >>> 0
	let t = state.seed
	t = Math.imul(t ^ (t >>> 15), t | 1)
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function starsFor(coins: number): 0 | 1 | 2 | 3 {
	return STAR_COINS.filter((need) => coins >= need).length as 0 | 1 | 2 | 3
}

const sameItems = (a: readonly Item[], b: readonly Item[]) =>
	a.length === b.length && [...a].sort().join() === [...b].sort().join()

/** One tap on a station or a customer. Returns what happened; an impossible tap returns nothing. */
export function tap(state: State, target: Target, now: number): GameEvent[] {
	tick(state, now)
	if (state.over) return []
	if ("customer" in target) {
		const order = state.orders[target.customer]
		if (!order) return []
		const slot = target.customer
		if (!sameItems(state.plate, order.recipe.items)) {
			state.plate = []
			return [{ kind: "wrong", slot }]
		}
		// Patience left is the tip: a fast plate is worth up to half again.
		const patience = Math.max(0, 1 - (now - order.arrivedAt) / PATIENCE_SECONDS)
		const coins = order.recipe.coins + Math.ceil(order.recipe.coins * 0.5 * patience)
		state.coins += coins
		state.served += 1
		state.plate = []
		state.orders[slot] = null
		state.nextOrderAt = Math.max(state.nextOrderAt, now + 1.5)
		return [{ kind: "served", slot, coins }]
	}
	const { station } = target
	if (station === "wajan") {
		if (state.wajan.state === "idle") {
			state.wajan = { state: "frying", since: now }
			return [{ kind: "frying" }]
		}
		if (state.wajan.state === "frying") return []
		if (state.plate.includes("tempe")) return [{ kind: "have", item: "tempe" }]
		if (state.plate.length >= PLATE_MAX) return [{ kind: "full" }]
		state.wajan = { state: "idle" }
		state.plate.push("tempe")
		return [{ kind: "took", item: "tempe" }]
	}
	if (state.plate.includes(station)) return [{ kind: "have", item: station }]
	if (state.plate.length >= PLATE_MAX) return [{ kind: "full" }]
	state.plate.push(station)
	return [{ kind: "took", item: station }]
}

/** Advance the clock: the wok finishes, patience runs out, customers arrive, the shift ends. */
export function tick(state: State, now: number): GameEvent[] {
	const events: GameEvent[] = []
	if (state.over || now <= state.now) return events
	state.now = now
	if (state.wajan.state === "frying" && now - state.wajan.since >= FRY_SECONDS) {
		state.wajan = { state: "ready" }
		events.push({ kind: "ready" })
	}
	state.orders.forEach((order, slot) => {
		if (order && now - order.arrivedAt >= PATIENCE_SECONDS) {
			state.orders[slot] = null
			state.left += 1
			events.push({ kind: "left", slot })
		}
	})
	if (now >= ROUND_SECONDS) {
		state.over = true
		events.push({ kind: "over", stars: starsFor(state.coins) })
		return events
	}
	const free = state.orders.findIndex((order) => order === null)
	if (free >= 0 && now >= state.nextOrderAt) {
		const recipe = RECIPES[Math.floor(random(state) * RECIPES.length)] ?? RECIPES[0]
		if (recipe) {
			state.seq += 1
			state.orders[free] = { id: state.seq, recipe, arrivedAt: now }
			state.nextOrderAt = now + 3 + random(state) * 3
		}
	}
	return events
}
