import "./style.css"
import { topCoins } from "./board"
import { type Playing, play, WADDLE } from "./emotes"
import {
	create,
	type GameEvent,
	join,
	leave,
	ROUND_SECONDS,
	type Seat,
	type State,
	type Target,
	tap,
	tick,
} from "./game"
import { Net, POSE_HZ, WORLD_HZ } from "./net"
import { rollSpecial } from "./roll"
import { buyApron, ownsApron } from "./shop"
import { COLUMNS, draw, hit, OTHER_COLOURS, STAGE, STATION_AT } from "./stage"

/**
 * The shell: a canvas, a clock, and the screen's reaction to what the rules report.
 *
 * One seat is the authority. It runs the rules (game.ts) and publishes the world; every other seat
 * sends taps and draws what arrives. With no room at all, this page is its own authority: solo play
 * is the same code path with one seat. Nothing here decides whether a plate is right.
 */

const GAME_ID = "warung-desa"
const found = document.querySelector<HTMLCanvasElement>("#field")
const context = found?.getContext("2d")
if (!found || !context) throw new Error("index.html is missing #field")
const canvas = found
const ctx = context
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid=${id}]`)
const ui = {
	room: q("room"),
	players: q("players"),
	time: q("time"),
	coins: q("coins"),
	served: q("served"),
	field: q("field"),
	over: q("over"),
	stars: q("stars"),
	summary: q("summary"),
	board: q("board"),
	buy: q("buy"),
	again: q("again"),
}

const WALK_PX = 230
const view = { width: 0, height: 0 }

const myName = new URLSearchParams(location.search).get("name") ?? `tamu-${Math.floor(Math.random() * 900 + 100)}`
const net = new Net(GAME_ID, myName)
const seed = () => Math.floor(Math.random() * 2 ** 31)

let state: State = create(seed())
let startedAt = performance.now()
/** When the last world arrived, so a seat that is not the authority can carry the clock between frames. */
let receivedAt = performance.now()
let wasAuthority = true
let player = { x: COLUMNS[1] as number, moving: false, facing: 1 as 1 | -1 }
let goal: { x: number; target: Target } | null = null
let playing: Playing | null = null
let emoteCount = 0
let apron = false
const remotePlaying = new Map<Seat, Playing>()

/** This page runs the rules when it is alone or elected; otherwise it only sends taps. */
const authority = () => !net.joined || net.isHost
const me = () => net.seat

function startShift() {
	state = create(seed())
	join(state, me())
	startedAt = performance.now()
	receivedAt = startedAt
	goal = null
	playing = null
	if (ui.over) ui.over.hidden = true
	// Today's special arrives a moment later; the shift does not wait for it.
	void rollSpecial().then((special) => {
		if (special && authority()) state.special = special
	})
}

function emote(name: string, wall: number) {
	const next = play(name, wall)
	if (!next) return
	playing = next
	emoteCount += 1
}

/** What a rule outcome does to this screen: only my own seat's outcomes move my character. */
function react(events: GameEvent[], wall: number) {
	for (const event of events) {
		if (event.kind === "over") {
			emote(event.stars >= 3 ? "sorak" : event.stars >= 1 ? "ngakak" : "nangis", wall)
			void showResult(event.stars)
		} else if ("seat" in event && event.seat !== me()) continue
		else if (event.kind === "served") emote("suka", wall)
		else if (event.kind === "wrong") emote("kaget", wall)
	}
}

async function showResult(stars: number) {
	if (ui.over) ui.over.hidden = false
	if (ui.stars) ui.stars.textContent = "★".repeat(stars) + "☆".repeat(3 - stars)
	if (ui.summary)
		ui.summary.textContent = `${state.coins} koin, ${state.served} pelanggan dilayani, ${state.left} pergi`
	if (ui.buy) ui.buy.hidden = apron
	const rows = await topCoins(GAME_ID)
	if (ui.board) {
		ui.board.replaceChildren(
			...(rows.length > 0
				? rows.map((row, index) => {
						const item = document.createElement("li")
						item.textContent = `${index + 1}. ${row.name} · ${row.score}`
						if (row.you) item.className = "you"
						return item
					})
				: [Object.assign(document.createElement("li"), { textContent: "papan peringkat: belum ada skor" })]),
		)
	}
}

/** The one place a tap becomes a rule call: directly when I am the authority, as an intent when not. */
function doTap(target: Target, now: number, wall: number) {
	if (authority()) {
		const events = tap(state, me(), target, now)
		net.publishEvents(events)
		net.publishWorld(state)
		react(events, wall)
	} else net.sendTap(target)
}

net.onTap = (seat, target) => {
	if (!authority()) return
	const now = Math.min(ROUND_SECONDS, (performance.now() - startedAt) / 1000)
	const events = tap(state, seat, target, now)
	net.publishEvents(events)
	net.publishWorld(state)
	react(events, performance.now() / 1000)
}
net.onWorld = (world) => {
	if (authority()) return
	state = world
	receivedAt = performance.now()
	if (state.over && ui.over?.hidden) void showResult(state.coins >= 160 ? 3 : state.coins >= 110 ? 2 : state.coins >= 60 ? 1 : 0)
	if (!state.over && ui.over && !ui.over.hidden) ui.over.hidden = true
}
net.onEvents = (events) => {
	if (!authority()) react(events, performance.now() / 1000)
}
net.onRemoteEmote = (seat, name) => {
	const next = play(name, performance.now() / 1000)
	if (next) remotePlaying.set(seat, next)
}
net.onHost = (host) => {
	// Elected: carry on from the last world I saw, with the clock where it was.
	if (host && !wasAuthority) {
		startedAt = performance.now() - state.now * 1000
		join(state, me())
	}
	wasAuthority = host || !net.joined
}
net.onLeave = (seat) => {
	if (authority()) leave(state, seat)
}
net.room.on("seat", () => join(state, me()))
void net.connect()

const stationX = (target: Target) =>
	"customer" in target ? (COLUMNS[target.customer] as number) : STATION_AT[target.station]

ui.again?.addEventListener("click", () => {
	if (authority()) {
		startShift()
		net.publishWorld(state)
	}
})
ui.buy?.addEventListener("click", () => {
	void buyApron().then((result) => {
		if (result === "owned") {
			apron = true
			if (ui.buy) ui.buy.hidden = true
		}
	})
})
void ownsApron().then((owned) => {
	apron = owned
})

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
let lastPose = 0
let lastWorld = 0
join(state, me())
void rollSpecial().then((special) => {
	if (special && authority()) state.special = special
})

function frame(real: number) {
	const dt = Math.min(0.05, (real - last) / 1000)
	last = real
	const wall = real / 1000
	fit()

	// The authority advances the clock; everyone else carries the last world forward a little.
	let now: number
	if (authority()) {
		now = Math.min(ROUND_SECONDS, (real - startedAt) / 1000)
		const events = tick(state, now)
		net.publishEvents(events)
		react(events, wall)
		if (real - lastWorld > 1000 / WORLD_HZ) {
			lastWorld = real
			net.publishWorld(state)
		}
	} else now = Math.min(ROUND_SECONDS, state.now + (real - receivedAt) / 1000)

	if (goal && !state.over) {
		const step = WALK_PX * dt
		const gap = goal.x - player.x
		if (Math.abs(gap) <= step) {
			player.x = goal.x
			player.moving = false
			doTap(goal.target, now, wall)
			goal = null
		} else {
			player.x += Math.sign(gap) * step
			player.moving = true
			player.facing = gap > 0 ? 1 : -1
		}
	} else player.moving = false
	if (playing && wall - playing.startedAt > playing.seconds + 0.2) playing = null

	net.sample(real)
	if (real - lastPose > 1000 / POSE_HZ) {
		lastPose = real
		net.sendPose({ x: player.x, e: playing?.emote.id.replace("emote-", "") ?? null, n: emoteCount, name: myName })
	}
	const colours = [...net.remotes.keys()].sort()
	const others = [...net.remotes.values()].map((remote) => {
		const doing = remotePlaying.get(remote.seat)
		if (doing && wall - doing.startedAt > doing.seconds + 0.2) remotePlaying.delete(remote.seat)
		const live = remotePlaying.get(remote.seat)
		return {
			x: remote.x,
			clip: live?.clip ?? WADDLE,
			seconds: live ? Math.max(0, wall - live.startedAt) : wall,
			face: live?.emote.face ?? "smug",
			tag: remote.name,
			colour: OTHER_COLOURS[colours.indexOf(remote.seat) % OTHER_COLOURS.length] ?? "#6fa8ff",
		}
	})

	draw(ctx, { state, seat: me(), others, apron, player, playing, now, wall })

	const set = (element: HTMLElement | null, value: string) => {
		if (element && element.textContent !== value) element.textContent = value
	}
	set(ui.time, String(Math.max(0, Math.ceil(ROUND_SECONDS - now))))
	set(ui.coins, String(state.coins))
	set(ui.served, String(state.served))
	set(ui.room, net.joined ? (net.isHost ? "host" : "tamu") : "solo")
	set(ui.players, String(net.players))
	if (ui.field) {
		ui.field.dataset.orders = JSON.stringify(state.orders.map((order) => order?.recipe.items ?? null))
		ui.field.dataset.plate = (state.plates[me()] ?? []).join(",")
		ui.field.dataset.wajan = state.wajan.state
		ui.field.dataset.special = state.special ?? ""
	}
	requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
