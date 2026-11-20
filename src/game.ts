/**
 * The rules of Warung Desa, and nothing else. No canvas, no DOM, no socket, no clock: time comes in
 * as `now` (seconds since the shift began) and chance from a seeded generator. That is what lets a
 * room referee the same round later and lets the tests run a whole shift in microseconds.
 *
 * What makes playing together worth it (and not just louder):
 *  - one wok, and a second cook who stirs it cuts the wait nearly in half;
 *  - plates can be passed, so one cook can do the rice and another the tempe;
 *  - with two or more cooks, "pesta" orders appear that need TWO plates from two different cooks;
 *  - serves close together build a team combo that pays everyone more;
 *  - more cooks bring more customers, and the stars scale with the team, so solo stays fair.
 */

export type Item = "nasi" | "tempe" | "sambal" | "kerupuk"
export type StationId = "nasi" | "kerupuk" | "wajan" | "sambal"
export type Target = { station: StationId } | { customer: number } | { cook: Seat }

/** A seat is one player at the stall. Solo play is one seat called `you`. */
export type Seat = string

export interface Recipe {
	id: string
	name: string
	/** One plate for a normal order; two plates, from two different cooks, for a pesta order. */
	parts: readonly (readonly Item[])[]
	coins: number
}

export const RECIPES: readonly Recipe[] = [
	{ id: "nasi-sambal", name: "Nasi Sambal", parts: [["nasi", "sambal"]], coins: 8 },
	{ id: "nasi-tempe", name: "Nasi Tempe", parts: [["nasi", "tempe"]], coins: 10 },
	{ id: "tempe-sambal", name: "Tempe Sambal", parts: [["tempe", "sambal"]], coins: 10 },
	{ id: "nasi-kerupuk", name: "Nasi Kerupuk", parts: [["nasi", "kerupuk"]], coins: 8 },
	{ id: "komplit", name: "Komplit", parts: [["nasi", "tempe", "sambal"]], coins: 16 },
	{ id: "tempe-kerupuk", name: "Tempe Kerupuk", parts: [["tempe", "kerupuk", "sambal"]], coins: 14 },
]

/** Orders for two plates: only when there are two cooks to make them. */
export const PESTA: readonly Recipe[] = [
	{ id: "pesta-ayam", name: "Pesta Kampung", parts: [["nasi", "tempe", "sambal"], ["nasi", "kerupuk"]], coins: 34 },
	{ id: "pesta-keluarga", name: "Pesta Keluarga", parts: [["tempe", "kerupuk", "sambal"], ["nasi", "tempe"]], coins: 36 },
]

export const ROUND_SECONDS = 90
export const FRY_SECONDS = 3.5
export const STIR_SECONDS = 1.5
export const PATIENCE_SECONDS = 28
export const PESTA_WINDOW = 8
export const COMBO_WINDOW = 6
export const RUSH_SECONDS = 30
export const SLOTS = 3
export const PLATE_MAX = 3
/** Coins for one, two and three stars, for one cook. A team's grow with its size. */
export const STAR_COINS = [60, 110, 160] as const

export const starCoins = (players: number): [number, number, number] => {
	const scale = 1 + 0.55 * (Math.max(1, players) - 1)
	return STAR_COINS.map((need) => Math.round(need * scale)) as [number, number, number]
}

export interface Order {
	id: number
	recipe: Recipe
	arrivedAt: number
	/** Which parts are already served (pesta only). */
	got: number[]
	/** The seats that served them: the second part must come from someone else. */
	by: Seat[]
	/** A pesta order's first plate is held until this time; then it is lost. */
	holdUntil: number | null
}

export type Wajan =
	| { state: "idle" }
	| { state: "frying"; since: number; by: Seat; stirred: boolean }
	| { state: "ready"; stirred: boolean }

export interface State {
	/** False in the waiting room: nothing runs, nothing pays, until the host starts the shift. */
	started: boolean
	/** The countdown is running: the host has pressed start but the shift has not begun. */
	starting: boolean
	/** Seconds the shift lasts. 90 unless a practice link shortens it. */
	duration: number
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
	/** Serves close together: the team's combo, and when the last one was. */
	combo: number
	lastServeAt: number
	/** The last stretch: customers come faster and pay more. */
	rush: boolean
	/** Plates each seat served, for the end screen. */
	byseat: Record<Seat, { served: number; coins: number }>
	/** Mulberry32 state: advancing it is the only way chance enters the game. */
	seed: number
}

/** What happened, for the screen to react to (a sound, an emote). The rules never read it back. */
export type GameEvent =
	| { kind: "took"; seat: Seat; item: Item }
	| { kind: "frying"; seat: Seat }
	| { kind: "stirred"; seat: Seat }
	| { kind: "ready"; stirred: boolean }
	| { kind: "have"; seat: Seat; item: Item }
	| { kind: "full"; seat: Seat }
	| { kind: "gave"; from: Seat; to: Seat; items: Item[] }
	| { kind: "served"; seat: Seat; slot: number; coins: number; combo: number; tip: number; team: boolean }
	| { kind: "half"; seat: Seat; slot: number }
	| { kind: "need-partner"; seat: Seat; slot: number }
	| { kind: "half-lost"; slot: number }
	| { kind: "wrong"; seat: Seat; slot: number }
	| { kind: "left"; slot: number }
	| { kind: "rush" }
	| { kind: "over"; stars: 0 | 1 | 2 | 3 }

export function create(seed: number, special: string | null = null, duration = ROUND_SECONDS): State {
	return {
		started: false,
		starting: false,
		duration,
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
		combo: 0,
		lastServeAt: -100,
		rush: false,
		byseat: {},
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

export const playersOf = (state: State): number => Math.max(1, Object.keys(state.plates).length)

export function starsFor(coins: number, players = 1): 0 | 1 | 2 | 3 {
	return starCoins(players).filter((need) => coins >= need).length as 0 | 1 | 2 | 3
}

const sameItems = (a: readonly Item[], b: readonly Item[]) =>
	a.length === b.length && [...a].sort().join() === [...b].sort().join()

/** The shift begins: the clock starts from zero. */
export function begin(state: State) {
	state.started = true
	state.starting = false
	state.now = 0
	state.nextOrderAt = 1
}

/** A seat sits down at the stall with an empty plate. Idempotent. */
export function join(state: State, seat: Seat) {
	state.plates[seat] ??= []
	state.byseat[seat] ??= { served: 0, coins: 0 }
}

/** A seat leaves; what was on its plate goes with it. */
export function leave(state: State, seat: Seat) {
	delete state.plates[seat]
}

function pay(state: State, seat: Seat, order: Order, slot: number, now: number): GameEvent {
	const base = order.recipe.coins
	const patience = Math.max(0, 1 - (now - order.arrivedAt) / PATIENCE_SECONDS)
	const tip = Math.ceil(base * 0.5 * patience)
	const special = state.special === order.recipe.id ? Math.ceil(base * 0.5) : 0
	// Serves close together build the team's combo: up to +50%.
	state.combo = now - state.lastServeAt <= COMBO_WINDOW ? state.combo + 1 : 1
	state.lastServeAt = now
	const comboBonus = 1 + 0.1 * Math.min(state.combo - 1, 5)
	const rush = state.rush ? 1.25 : 1
	const coins = Math.round((base + tip + special) * comboBonus * rush)
	state.coins += coins
	state.served += 1
	const mine = (state.byseat[seat] ??= { served: 0, coins: 0 })
	mine.served += 1
	mine.coins += coins
	state.orders[slot] = null
	state.nextOrderAt = Math.max(state.nextOrderAt, now + 1.2)
	return { kind: "served", seat, slot, coins, combo: state.combo, tip, team: order.recipe.parts.length > 1 }
}

/** One tap on a station, a customer or another cook. Returns what happened; an impossible tap returns nothing. */
export function tap(state: State, seat: Seat, target: Target, now: number): GameEvent[] {
	const events = tick(state, now)
	if (state.over || !state.started) return events
	join(state, seat)
	const plate = state.plates[seat] as Item[]

	if ("cook" in target) return [...events, ...give(state, seat, target.cook)]

	if ("customer" in target) {
		const slot = target.customer
		const order = state.orders[slot]
		if (!order) return events
		// Which unserved part does this plate fill?
		const part = order.recipe.parts.findIndex((items, index) => !order.got.includes(index) && sameItems(plate, items))
		if (part < 0) {
			plate.length = 0
			return [...events, { kind: "wrong", seat, slot }]
		}
		if (order.recipe.parts.length === 1) {
			plate.length = 0
			return [...events, pay(state, seat, order, slot, now)]
		}
		// A pesta order: the second plate must come from a different cook.
		if (order.got.length > 0 && order.by.includes(seat)) return [...events, { kind: "need-partner", seat, slot }]
		order.got.push(part)
		order.by.push(seat)
		plate.length = 0
		if (order.got.length < order.recipe.parts.length) {
			order.holdUntil = now + PESTA_WINDOW
			return [...events, { kind: "half", seat, slot }]
		}
		return [...events, pay(state, seat, order, slot, now)]
	}

	const { station } = target
	if (station === "wajan") {
		if (state.wajan.state === "idle") {
			state.wajan = { state: "frying", since: now, by: seat, stirred: false }
			return [...events, { kind: "frying", seat }]
		}
		if (state.wajan.state === "frying") {
			// Another cook stirs: the tempe is done sooner, once.
			if (state.wajan.by === seat || state.wajan.stirred) return events
			state.wajan = { ...state.wajan, since: state.wajan.since - STIR_SECONDS, stirred: true }
			return [...events, { kind: "stirred", seat }]
		}
		if (plate.includes("tempe")) return [...events, { kind: "have", seat, item: "tempe" }]
		if (plate.length >= PLATE_MAX) return [...events, { kind: "full", seat }]
		state.wajan = { state: "idle" }
		plate.push("tempe")
		return [...events, { kind: "took", seat, item: "tempe" }]
	}
	if (plate.includes(station)) return [...events, { kind: "have", seat, item: station }]
	if (plate.length >= PLATE_MAX) return [...events, { kind: "full", seat }]
	plate.push(station)
	return [...events, { kind: "took", seat, item: station }]
}

/** Pass what is on your plate to another cook, as much as fits. */
export function give(state: State, from: Seat, to: Seat): GameEvent[] {
	const mine = state.plates[from]
	const theirs = state.plates[to]
	if (!mine || !theirs || from === to || mine.length === 0) return []
	const moved: Item[] = []
	for (const item of [...mine]) {
		if (theirs.length >= PLATE_MAX || theirs.includes(item)) continue
		theirs.push(item)
		mine.splice(mine.indexOf(item), 1)
		moved.push(item)
	}
	return moved.length > 0 ? [{ kind: "gave", from, to, items: moved }] : []
}

/** Advance the clock: the wok finishes, patience runs out, customers arrive, the shift ends. */
export function tick(state: State, now: number): GameEvent[] {
	const events: GameEvent[] = []
	if (!state.started || state.over || now <= state.now) return events
	state.now = now
	if (state.wajan.state === "frying" && now - state.wajan.since >= FRY_SECONDS) {
		state.wajan = { state: "ready", stirred: state.wajan.stirred }
		events.push({ kind: "ready", stirred: state.wajan.stirred })
	}
	if (!state.rush && now >= state.duration - RUSH_SECONDS && state.duration > RUSH_SECONDS * 1.5) {
		state.rush = true
		events.push({ kind: "rush" })
	}
	state.orders.forEach((order, slot) => {
		if (!order) return
		if (order.holdUntil !== null && now >= order.holdUntil) {
			order.got = []
			order.by = []
			order.holdUntil = null
			events.push({ kind: "half-lost", slot })
		}
		if (now - order.arrivedAt >= PATIENCE_SECONDS) {
			state.orders[slot] = null
			state.left += 1
			events.push({ kind: "left", slot })
		}
	})
	if (now >= state.duration) {
		state.over = true
		events.push({ kind: "over", stars: starsFor(state.coins, playersOf(state)) })
		return events
	}
	const free = state.orders.findIndex((order) => order === null)
	if (free >= 0 && now >= state.nextOrderAt) {
		const players = playersOf(state)
		// With two or more cooks, one order in four needs both of them.
		const pool = players >= 2 && random(state) < 0.28 ? PESTA : RECIPES
		const recipe = pool[Math.floor(random(state) * pool.length)] ?? RECIPES[0]
		if (recipe) {
			state.seq += 1
			state.orders[free] = { id: state.seq, recipe, arrivedAt: now, got: [], by: [], holdUntil: null }
			// More cooks, more customers; the last stretch is busier still.
			const pace = (1 + 0.4 * (players - 1)) * (state.rush ? 1.5 : 1)
			state.nextOrderAt = now + (3 + random(state) * 3) / pace
		}
	}
	return events
}
