import "./style.css"
import { create, type GameEvent, ROUND_SECONDS, type State, tap, tick, type Target } from "./game"
import { type Playing, play } from "./emotes"
import { COLUMNS, draw, hit, STAGE, STATION_AT } from "./stage"

/**
 * The shell: a canvas, a clock and the screen's reaction to what the rules report. All the rules are
 * in game.ts (pure, tested); all the pixels are in stage.ts; the emotes are in emotes.ts. Nothing
 * here decides whether a plate is right.
 */

const found = document.querySelector<HTMLCanvasElement>("#field")
const context = found?.getContext("2d")
if (!found || !context) throw new Error("index.html is missing #field")
const canvas = found
const ctx = context
const ui = {
	time: document.querySelector<HTMLElement>("[data-testid=time]"),
	coins: document.querySelector<HTMLElement>("[data-testid=coins]"),
	served: document.querySelector<HTMLElement>("[data-testid=served]"),
	hint: document.querySelector<HTMLElement>("[data-testid=hint]"),
	field: document.querySelector<HTMLElement>("[data-testid=field]"),
	over: document.querySelector<HTMLElement>("[data-testid=over]"),
	stars: document.querySelector<HTMLElement>("[data-testid=stars]"),
	summary: document.querySelector<HTMLElement>("[data-testid=summary]"),
	again: document.querySelector<HTMLElement>("[data-testid=again]"),
}

const WALK_PX = 230
const view = { width: 0, height: 0 }

let state: State = create(Math.floor(Math.random() * 2 ** 31))
let startedAt = performance.now()
let player = { x: COLUMNS[1] as number, moving: false, facing: 1 as 1 | -1 }
let goal: { x: number; target: Target } | null = null
let playing: Playing | null = null

const stationX = (target: Target) =>
	"customer" in target ? (COLUMNS[target.customer] as number) : STATION_AT[target.station]

/** The screen's reaction to a rule outcome: which emote the character plays. */
function react(events: GameEvent[], wall: number) {
	for (const event of events) {
		if (event.kind === "served") playing = play("suka", wall) ?? playing
		else if (event.kind === "wrong") playing = play("kaget", wall) ?? playing
		else if (event.kind === "left") playing = play("nangis", wall) ?? playing
		else if (event.kind === "over") {
			playing = play(event.stars >= 3 ? "sorak" : event.stars >= 1 ? "ngakak" : "nangis", wall) ?? playing
			showResult(event.stars)
		}
	}
}

function showResult(stars: number) {
	if (ui.over) ui.over.hidden = false
	if (ui.stars) ui.stars.textContent = stars > 0 ? "★".repeat(stars) : "—"
	if (ui.summary)
		ui.summary.textContent = `${state.coins} koin, ${state.served} pelanggan dilayani, ${state.left} pergi`
}

function restart(now: number) {
	state = create(Math.floor(Math.random() * 2 ** 31))
	startedAt = now
	goal = null
	playing = null
	player = { x: COLUMNS[1] as number, moving: false, facing: 1 }
	if (ui.over) ui.over.hidden = true
}
ui.again?.addEventListener("click", () => restart(performance.now()))

canvas.addEventListener("pointerdown", (event) => {
	if (state.over) return
	const rect = canvas.getBoundingClientRect()
	const scale = Math.min(rect.width / STAGE.width, rect.height / STAGE.height)
	const x = (event.clientX - rect.left - (rect.width - STAGE.width * scale) / 2) / scale
	const y = (event.clientY - rect.top - (rect.height - STAGE.height * scale)) / scale
	const target = hit(x, y)
	if (target) goal = { x: stationX(target), target }
})

function fit() {
	const dpr = window.devicePixelRatio || 1
	if (canvas.clientWidth !== view.width || canvas.clientHeight !== view.height) {
		view.width = canvas.clientWidth
		view.height = canvas.clientHeight
		canvas.width = Math.round(view.width * dpr)
		canvas.height = Math.round(view.height * dpr)
	}
	const scale = Math.min(view.width / STAGE.width, view.height / STAGE.height) * dpr
	const left = (view.width * dpr - STAGE.width * scale) / 2
	// The stage is pinned to the bottom edge: a tall phone gets more wall above the awning.
	const top = view.height * dpr - STAGE.height * scale
	ctx.setTransform(scale, 0, 0, scale, left, top)
}

let last = performance.now()

function frame(real: number) {
	const dt = Math.min(0.05, (real - last) / 1000)
	last = real
	const wall = real / 1000
	const now = Math.min(ROUND_SECONDS, (real - startedAt) / 1000)
	fit()

	react(tick(state, now), wall)
	if (goal && !state.over) {
		const step = WALK_PX * dt
		const gap = goal.x - player.x
		if (Math.abs(gap) <= step) {
			player.x = goal.x
			player.moving = false
			react(tap(state, goal.target, now), wall)
			goal = null
		} else {
			player.x += Math.sign(gap) * step
			player.moving = true
			player.facing = gap > 0 ? 1 : -1
		}
	} else player.moving = false
	if (playing && wall - playing.startedAt > playing.seconds + 0.2) playing = null

	draw(ctx, { state, player, playing, now, wall })

	const set = (element: HTMLElement | null, value: string) => {
		if (element && element.textContent !== value) element.textContent = value
	}
	set(ui.time, String(Math.max(0, Math.ceil(ROUND_SECONDS - now))))
	set(ui.coins, String(state.coins))
	set(ui.served, String(state.served))
	// What a test harness reads: the orders on the counter and the plate, never the canvas pixels.
	if (ui.field) {
		ui.field.dataset.orders = JSON.stringify(state.orders.map((order) => order?.recipe.items ?? null))
		ui.field.dataset.plate = state.plate.join(",")
		ui.field.dataset.wajan = state.wajan.state
	}
	requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
