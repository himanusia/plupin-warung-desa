import type { ClipRef } from "@plupin/character"
import { drawCharacter2D, faceCanvas } from "@plupin/character/canvas"
import { PATIENCE_SECONDS, PLATE_MAX, type StationId, type State } from "./game"
import { type Playing, WADDLE } from "./emotes"

/** The warung is drawn on a 390 x 700 stage and scaled to fit, so every number below is in stage px. */
export const STAGE = { width: 390, height: 700 }
export const COLUMNS = [65, 195, 325] as const
export const STATION_AT: Record<StationId, number> = { nasi: COLUMNS[0], wajan: COLUMNS[1], sambal: COLUMNS[2] }
export const FLOOR_Y = 540
const COUNTER_Y = 262
const STATION_TOP = 372

const ITEM_STYLE = {
	nasi: { label: "Nasi", color: "#f5f0e1", ink: "#5a4029" },
	tempe: { label: "Tempe", color: "#d9a441", ink: "#4a2f0b" },
	sambal: { label: "Sambal", color: "#d8432f", ink: "#fff3dc" },
} as const

/** Where a tap landed, in stage px: a column of customers above the counter, a station below. */
export function hit(x: number, y: number): { customer: number } | { station: StationId } | null {
	const column = COLUMNS.findIndex((center) => Math.abs(x - center) < 52)
	if (column < 0) return null
	if (y > 90 && y < COUNTER_Y + 24) return { customer: column }
	if (y >= STATION_TOP - 10 && y < FLOOR_Y + 20) {
		const station = (Object.keys(STATION_AT) as StationId[]).find((id) => STATION_AT[id] === COLUMNS[column])
		return station ? { station } : null
	}
	return null
}

export interface Scene {
	state: State
	player: { x: number; moving: boolean; facing: 1 | -1 }
	playing: Playing | null
	now: number
	/** Real seconds since the page loaded, for idle motion that must not depend on the round. */
	wall: number
}

const faces = new Map<string, HTMLCanvasElement>()
const face = (name: string) => {
	let canvas = faces.get(name)
	if (!canvas) {
		canvas = faceCanvas(name as never)
		faces.set(name, canvas)
	}
	return canvas
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, edge = "#2b1d12") {
	ctx.fillStyle = edge
	ctx.fillRect(x - 2, y - 2, w + 4, h + 4)
	ctx.fillStyle = fill
	ctx.fillRect(x, y, w, h)
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "center") {
	ctx.font = `bold ${size}px ui-monospace, Menlo, monospace`
	ctx.textAlign = align
	ctx.fillStyle = color
	ctx.fillText(value, x, y)
}

/** Customers are told apart by body colour: the character package paints one colour per body. */
const CUSTOMER_COLOURS = ["#6fa8ff", "#ff8a65", "#7bd389", "#c39bff", "#ffd966", "#ff9ecb"]
const PLAYER_COLOUR = "#ffd24d"

export function draw(ctx: CanvasRenderingContext2D, scene: Scene) {
	const { state, player, playing, now, wall } = scene
	// Back wall, awning, floor. The wall and the floor run past the stage edges, so a tall phone
	// shows more warung instead of black bars.
	ctx.fillStyle = "#e8c98f"
	ctx.fillRect(-400, -600, STAGE.width + 800, STAGE.height + 1200)
	ctx.fillStyle = "#c9a064"
	ctx.fillRect(-400, -600, STAGE.width + 800, 670)
	for (let x = 0; x < STAGE.width; x += 52) {
		ctx.fillStyle = (x / 52) % 2 ? "#d8432f" : "#fff3dc"
		ctx.fillRect(x, 60, 52, 26)
	}
	ctx.fillStyle = "#8a6a3f"
	ctx.fillRect(-400, COUNTER_Y - 6, STAGE.width + 800, STAGE.height + 600)
	ctx.fillStyle = "#a07c4a"
	ctx.fillRect(-400, COUNTER_Y + 20, STAGE.width + 800, 8)

	// Customers and their orders.
	COLUMNS.forEach((x, slot) => {
		const order = state.orders[slot]
		if (!order) return
		const patience = Math.max(0, 1 - (now - order.arrivedAt) / PATIENCE_SECONDS)
		const mood = patience > 0.5 ? "smug" : patience > 0.2 ? "serious" : "rage"
		drawCharacter2D(ctx, {
			rig: "r6",
			look: { bodyColor: CUSTOMER_COLOURS[order.id % CUSTOMER_COLOURS.length] ?? "#6fa8ff", face: face(mood) },
			x,
			y: COUNTER_Y,
			scale: 11,
			view: "front",
			clip: "idle",
			seconds: wall + slot,
		})
		box(ctx, x - 50, 96, 100, 62 + order.recipe.items.length * 0, "#fff3dc")
		text(ctx, order.recipe.name, x, 114, 10, "#4a2f0b")
		order.recipe.items.forEach((item, index) => {
			const style = ITEM_STYLE[item]
			const left = x - (order.recipe.items.length * 30) / 2 + index * 30
			ctx.fillStyle = style.color
			ctx.fillRect(left + 2, 122, 26, 18)
			text(ctx, style.label[0] ?? "", left + 15, 136, 12, style.ink)
		})
		ctx.fillStyle = "#2b1d12"
		ctx.fillRect(x - 46, 146, 92, 8)
		ctx.fillStyle = patience > 0.5 ? "#3dab6b" : patience > 0.2 ? "#e8c23d" : "#d8432f"
		ctx.fillRect(x - 46, 146, 92 * patience, 8)
	})

	// Stations.
	const wajan = state.wajan
	const stations: [number, string, string, string][] = [
		[COLUMNS[0], "Nasi", ITEM_STYLE.nasi.color, ""],
		[COLUMNS[1], "Wajan", wajan.state === "ready" ? "#d9a441" : "#3a3a3a", wajan.state],
		[COLUMNS[2], "Sambal", ITEM_STYLE.sambal.color, ""],
	]
	for (const [x, label, color, sub] of stations) {
		box(ctx, x - 44, STATION_TOP, 88, 62, color)
		text(ctx, label, x, STATION_TOP + 26, 14, color === "#3a3a3a" ? "#fff3dc" : "#2b1d12")
		if (sub === "frying") {
			const done = Math.min(1, (now - (wajan.state === "frying" ? wajan.since : now)) / 3)
			ctx.fillStyle = "#ff9d3d"
			ctx.fillRect(x - 36, STATION_TOP + 44, 72 * done, 8)
		} else if (sub) text(ctx, sub === "ready" ? "matang!" : "ketuk", x, STATION_TOP + 52, 10, color === "#3a3a3a" ? "#ffc94d" : "#2b1d12")
		else text(ctx, "ketuk", x, STATION_TOP + 52, 10, "#2b1d12")
	}

	// The player: side view while walking, front view otherwise or while an emote plays.
	let clip: ClipRef = "idle"
	let seconds = wall
	const view = "front"
	let expression = "smug"
	if (playing) {
		clip = playing.clip
		seconds = Math.max(0, wall - playing.startedAt)
		expression = playing.emote.face
	} else if (player.moving) {
		clip = WADDLE
		seconds = wall
	}
	drawCharacter2D(ctx, {
		rig: "r6",
		look: { bodyColor: PLAYER_COLOUR, face: face(expression) },
		x: player.x,
		y: FLOOR_Y,
		scale: 15,
		view,
		clip,
		seconds,
	})
	if (playing) text(ctx, playing.emote.glyph, player.x, FLOOR_Y - 96 - Math.min(16, seconds * 20), 18, "#4a2f0b")

	// The plate.
	box(ctx, 95, 612, 200, 52, "#fff3dc")
	text(ctx, "piring", 195, 606, 10, "#4a2f0b")
	for (let slot = 0; slot < PLATE_MAX; slot += 1) {
		const item = state.plate[slot]
		const left = 108 + slot * 62
		ctx.fillStyle = "#e8d9b8"
		ctx.fillRect(left, 622, 56, 32)
		if (item) {
			ctx.fillStyle = ITEM_STYLE[item].color
			ctx.fillRect(left + 3, 625, 50, 26)
			text(ctx, ITEM_STYLE[item].label, left + 28, 643, 11, ITEM_STYLE[item].ink)
		}
	}
}
