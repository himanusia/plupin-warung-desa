/**
 * The rules of Warung Desa, and nothing else. No canvas, no DOM, no socket, no clock: time comes in
 * as `now` (seconds since the round began) and chance comes from a seeded generator. That is what
 * lets a room referee the same round later (the referee replays these functions) and what lets the
 * tests below run a whole shift in microseconds.
 */

export type Item = "nasi" | "tempe" | "sambal"
export type StationId = "nasi" | "sambal" | "wajan"
export type Target = { station: StationId } | { customer: number }

/** A seat is one player at the stall. Solo play is one seat called `you`. */
export type Seat = string

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
	/** Each seat carries its own plate; the wok, the counter and the coins are shared. */
	plates: Record<Seat, Item[]>
	/** The recipe id that pays half again today (the free roll), or null. */
	special: string | null
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
	| { kind: "took"; seat: Seat; item: Item }
	| { kind: "frying" }
	| { kind: "ready" }
	| { kind: "have"; seat: Seat; item: Item }
	| { kind: "full"; seat: Seat }
	| { kind: "served"; seat: Seat; slot: number; coins: number }
	| { kind: "wrong"; seat: Seat; slot: number }
	| { kind: "left"; slot: number }
	| { kind: "over"; stars: 0 | 1 | 2 | 3 }

export function create(seed: number, special: string | null = null): State {
	return {
		now: 0,
		coins: 0,
		served: 0,
		left: 0,
		plates: {},
		special,
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

/** A seat sits down at the stall with an empty plate. Idempotent. */
export function join(state: State, seat: Seat) {
	state.plates[seat] ??= []
}

/** A seat leaves; what was on its plate goes with it. */
export function leave(state: State, seat: Seat) {
	delete state.plates[seat]
}

/** One tap on a station or a customer. Returns what happened; an impossible tap returns nothing. */
export function tap(state: State, seat: Seat, target: Target, now: number): GameEvent[] {
	tick(state, now)
	if (state.over) return []
	join(state, seat)
	const plate = state.plates[seat] as Item[]
	if ("customer" in target) {
		const order = state.orders[target.customer]
		if (!order) return []
		const slot = target.customer
		if (!sameItems(plate, order.recipe.items)) {
			plate.length = 0
			return [{ kind: "wrong", seat, slot }]
		}
		// Patience left is the tip: a fast plate is worth up to half again.
		const patience = Math.max(0, 1 - (now - order.arrivedAt) / PATIENCE_SECONDS)
		const special = state.special === order.recipe.id ? Math.ceil(order.recipe.coins * 0.5) : 0
		const coins = order.recipe.coins + Math.ceil(order.recipe.coins * 0.5 * patience) + special
		state.coins += coins
		state.served += 1
		plate.length = 0
		state.orders[slot] = null
		state.nextOrderAt = Math.max(state.nextOrderAt, now + 1.5)
		return [{ kind: "served", seat, slot, coins }]
	}
	const { station } = target
	if (station === "wajan") {
		if (state.wajan.state === "idle") {
			state.wajan = { state: "frying", since: now }
			return [{ kind: "frying" }]
		}
		if (state.wajan.state === "frying") return []
		if (plate.includes("tempe")) return [{ kind: "have", seat, item: "tempe" }]
		if (plate.length >= PLATE_MAX) return [{ kind: "full", seat }]
		state.wajan = { state: "idle" }
		plate.push("tempe")
		return [{ kind: "took", seat, item: "tempe" }]
	}
	if (plate.includes(station)) return [{ kind: "have", seat, item: station }]
	if (plate.length >= PLATE_MAX) return [{ kind: "full", seat }]
	plate.push(station)
	return [{ kind: "took", seat, item: station }]
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
