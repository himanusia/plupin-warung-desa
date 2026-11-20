import { type Item, type Seat, type State } from "./game"

/**
 * The next sensible thing to do, as one sentence and one thing to point at. Pure: the same state gives
 * the same answer, so the tutorial and the hint line cannot disagree with the rules, and a test can
 * check them. The pointer (`mark`) is a station, a customer slot, a cook or nothing.
 */

export type Mark = { station: "nasi" | "kerupuk" | "wajan" | "sambal" } | { customer: number } | { cook: Seat } | null
export interface Hint {
	text: string
	mark: Mark
	/** A short tag for the kind of help, so the screen can colour it. */
	kind: "take" | "fry" | "serve" | "team" | "wait"
}

const sameItems = (a: readonly Item[], b: readonly Item[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()
const STATION_OF: Record<Item, "nasi" | "kerupuk" | "wajan" | "sambal"> = { nasi: "nasi", kerupuk: "kerupuk", tempe: "wajan", sambal: "sambal" }

export function nextHint(state: State, seat: Seat): Hint | null {
	if (!state.started || state.over) return null
	const plate = state.plates[seat] ?? []
	const orders = state.orders.map((order, slot) => ({ order, slot })).filter((entry) => entry.order !== null)

	// A plate that matches an order: serve it (a pesta part must go to a customer it still fills).
	for (const { order, slot } of orders) {
		if (!order) continue
		const part = order.recipe.parts.findIndex((items, index) => !order.got.includes(index) && sameItems(plate, items))
		if (part >= 0 && !(order.got.length > 0 && order.by.includes(seat)))
			return { text: order.recipe.parts.length > 1 ? "Piring cocok! Bawa ke pelanggan pesta, temanmu harus bawa piring satunya" : "Piring cocok! Ketuk pelanggannya", mark: { customer: slot }, kind: "serve" }
	}

	// The wok: another cook's tempe is frying and not yet stirred: help.
	if (state.wajan.state === "frying" && state.wajan.by !== seat && !state.wajan.stirred)
		return { text: "Bantu aduk wajan: tempe jadi lebih cepat matang!", mark: { station: "wajan" }, kind: "team" }
	if (state.wajan.state === "ready" && !plate.includes("tempe") && plate.length < 3)
		return { text: "Ting! Ketuk wajan untuk ambil tempe", mark: { station: "wajan" }, kind: "fry" }

	// Work toward the oldest order: what is it still missing?
	const target = orders.sort((a, b) => (a.order?.arrivedAt ?? 0) - (b.order?.arrivedAt ?? 0))[0]
	if (!target?.order) return { text: "Tunggu pelanggan datang…", mark: null, kind: "wait" }
	const order = target.order
	const part = order.recipe.parts.find((_, index) => !order.got.includes(index)) ?? order.recipe.parts[0] ?? []
	// A plate with the wrong things in it: serve it away or start over.
	const stray = plate.filter((item) => !part.includes(item))
	if (stray.length > 0) return { text: "Ada yang salah di piring. Ketuk pelanggan untuk membuangnya", mark: { customer: target.slot }, kind: "serve" }
	const missing = part.filter((item) => !plate.includes(item))
	const next = missing[0]
	if (!next) return { text: "Ketuk pelanggannya", mark: { customer: target.slot }, kind: "serve" }
	if (next === "tempe") {
		if (state.wajan.state === "idle") return { text: "Ketuk wajan untuk goreng tempe", mark: { station: "wajan" }, kind: "fry" }
		if (state.wajan.state === "frying") return { text: "Tempe sedang digoreng… tunggu ting!", mark: { station: "wajan" }, kind: "wait" }
		return { text: "Ketuk wajan untuk ambil tempe", mark: { station: "wajan" }, kind: "fry" }
	}
	const label: Record<Item, string> = { nasi: "nasi", sambal: "sambal", kerupuk: "kerupuk", tempe: "tempe" }
	return { text: `Ambil ${label[next]} untuk ${order.recipe.name}`, mark: { station: STATION_OF[next] }, kind: "take" }
}
