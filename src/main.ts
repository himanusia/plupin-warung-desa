import { Vector3 } from "three"
import "./style.css"
import { Cook, Customer, PALETTE } from "./actors"
import { topCoins } from "./board"
import { lengthOf } from "./emotes"
import { ease, hitStop, shake, tween, updateTweens, consumeFreeze } from "./fx"
import {
	begin,
	create,
	type GameEvent,
	join,
	leave,
	PATIENCE_SECONDS,
	PLATE_MAX,
	RECIPES,
	type Seat,
	type State,
	STAR_COINS,
	type Target,
	tap,
	tick,
} from "./game"
import { Net, POSE_HZ, WORLD_HZ } from "./net"
import { rollSpecial } from "./roll"
import { COLUMN_X, COOK_Z, CUSTOMER_Z, STATION_X, TABLE_Z, World } from "./scene"
import { buyApron, ownsApron } from "./shop"
import { sound } from "./audio"
import { food } from "./actors"
import { $, Bubbles, bump, countUp, floater, flyCoins, logo, q } from "./ui"

/**
 * The shell: a three.js scene, a clock, a screen flow (title, waiting room, countdown, play, result)
 * and the reaction to what the rules report. One seat is the authority and runs game.ts; the others
 * send taps and are drawn from what arrives. With no room, this page is its own authority: solo is the
 * same code path with one seat. Nothing here decides whether a plate is right.
 */

const GAME_ID = "warung-desa"
const params = new URLSearchParams(location.search)
const party = params.get("p") ?? undefined

const canvas = $<HTMLCanvasElement>("game")
const stage = $("game").parentElement as HTMLElement
const world = new World(canvas)
const bubbles = new Bubbles()

// ---- who I am ----
const store = {
	get(key: string, fallback: string) {
		try {
			return localStorage.getItem(`warung-desa:${key}`) ?? fallback
		} catch {
			return fallback
		}
	},
	set(key: string, value: string) {
		try {
			localStorage.setItem(`warung-desa:${key}`, value)
		} catch {
			// no storage: the choice lasts for this visit
		}
	},
}
let myName = params.get("name") ?? store.get("name", `tamu-${Math.floor(Math.random() * 900 + 100)}`)
const hash = [...myName].reduce((sum, letter) => sum + letter.charCodeAt(0), 0)
let myColor = store.get("color", PALETTE[hash % PALETTE.length] ?? "#3d7bff")
let apron = false

// ---- state ----
type Phase = "title" | "lobby" | "countdown" | "play" | "over"
let phase: Phase = "title"
let net: Net | null = null
const seed = () => Math.floor(Math.random() * 2 ** 31)
/** A practice link (`?round=20`) shortens the shift; everything else is the same. */
const roundLength = Math.min(300, Math.max(10, Number(params.get("round")) || 90))
let state: State = create(seed(), null, roundLength)
let startedAt = 0
let receivedAt = performance.now()
let wasAuthority = true
let goal: { target: Target; x: number } | null = null
let emoteCount = 0
let shownCoins = 0
let countdownShown = -1
let countdownStart = performance.now()
let lastSecond = -1
let resultShown = false
let wall = 0

const authority = () => !net || !net.joined || net.isHost
const me = (): Seat => net?.seat ?? "you"

const cooks = new Map<Seat, Cook>()
const tags = new Map<Seat, HTMLElement>()
const customers: (Customer | null)[] = [null, null, null]

function nowSeconds(real: number): number {
	if (authority()) return Math.min(state.duration, (real - startedAt) / 1000)
	return Math.min(state.duration, state.now + (real - receivedAt) / 1000)
}

// ---- cooks ----
function cookFor(seat: Seat, name: string, color: string, local: boolean): Cook {
	let cook = cooks.get(seat)
	if (!cook) {
		cook = new Cook(seat, name, color, 0, local)
		cook.wearApron(local && apron)
		world.scene.add(cook.group, cook.plate.group)
		cook.plate.group.position.set(0, 0.98, 0)
		cooks.set(seat, cook)
		const tag = document.createElement("div")
		tag.className = `nametag${local ? " me" : ""}`
		$("floaters").append(tag)
		tags.set(seat, tag)
		layoutCooks()
	}
	return cook
}

function layoutCooks() {
	const list = [...cooks.values()].sort((a, b) => Number(b.local) - Number(a.local) || a.seat.localeCompare(b.seat))
	list.forEach((cook, index) => {
		const spot = (index - (list.length - 1) / 2) * 1.5
		cook.x = cook.target = spot
	})
}

function dropCook(seat: Seat) {
	const cook = cooks.get(seat)
	if (!cook) return
	world.scene.remove(cook.group, cook.plate.group)
	cook.dispose()
	cooks.delete(seat)
	tags.get(seat)?.remove()
	tags.delete(seat)
	layoutCooks()
}

// ---- effects ----
const headAt = (x: number, y: number, z: number) => new Vector3(x, y, z)
const px = (point: Vector3) => world.project(point, { width: stage.clientWidth, height: stage.clientHeight })

function flyItem(item: "nasi" | "tempe" | "sambal", seat: Seat) {
	const cook = cooks.get(seat)
	if (!cook) return
	const station = item === "nasi" ? "nasi" : item === "tempe" ? "wajan" : "sambal"
	const from = new Vector3(STATION_X[station], 1.9, TABLE_Z)
	const to = world.plateAt(cook.x).add(new Vector3(0, 0.25, 0))
	const mesh = food(item)
	mesh.position.copy(from)
	world.scene.add(mesh)
	sound.toss()
	tween(0.42, (p) => {
		mesh.position.lerpVectors(from, to, p)
		mesh.position.y += Math.sin(p * Math.PI) * 1.1
		mesh.rotation.y = p * 9
		const s = 1 + Math.sin(p * Math.PI) * 0.35
		mesh.scale.set(s, 1 / s + 0.1, s)
	}, { easing: ease.linear, done: () => world.scene.remove(mesh) })
}

function glyphOver(cook: Cook, glyph: string | undefined) {
	if (!glyph) return
	const at = px(headAt(cook.x, 2.9, COOK_Z))
	if (at) floater(glyph, at.x, at.y, "glyph")
}

function react(events: GameEvent[]) {
	for (const event of events) {
		if (event.kind === "took") {
			const cook = cooks.get(event.seat)
			sound.pick(event.item === "nasi" ? 0 : event.item === "tempe" ? 1 : 2)
			cook?.pop()
			flyItem(event.item, event.seat)
			if (event.item === "tempe") world.puff(new Vector3(STATION_X.wajan, 1.8, TABLE_Z), 8)
		} else if (event.kind === "frying") {
			sound.sizzleStart()
			world.puff(new Vector3(STATION_X.wajan, 1.9, TABLE_Z), 12)
			shake(0.08)
		} else if (event.kind === "ready") {
			sound.ready()
			world.sparkle(new Vector3(STATION_X.wajan, 2.1, TABLE_Z), 18)
			const at = px(headAt(STATION_X.wajan, 2.6, TABLE_Z))
			if (at) floater("ting!", at.x, at.y)
		} else if (event.kind === "have" || event.kind === "full") {
			if (event.seat === me()) {
				sound.wrong()
				const cook = cooks.get(event.seat)
				const at = cook ? px(headAt(cook.x, 2.9, COOK_Z)) : null
				if (at) floater(event.kind === "full" ? "penuh!" : "sudah ada", at.x, at.y)
			}
		} else if (event.kind === "served") {
			const customer = customers[event.slot]
			const x = COLUMN_X[event.slot] ?? 0
			sound.serve()
			world.sparkle(headAt(x, 1.8, CUSTOMER_Z + 0.4), 24)
			hitStop(0.06)
			shake(0.18)
			const at = px(headAt(x, 2.5, CUSTOMER_Z))
			if (at) {
				floater(`+${event.coins}`, at.x, at.y)
				if (event.seat === me()) flyCoins(at, Math.min(8, 3 + Math.floor(event.coins / 6)), () => bump($("coins-chip")))
			}
			if (state.special && customer && RECIPES.find((r) => r.id === state.special)) world.burst(headAt(x, 2.2, CUSTOMER_Z + 0.5))
			if (customer) {
				customers[event.slot] = null
				customer.celebrate(() => {
					world.scene.remove(customer.group)
					customer.dispose()
				})
			}
			const cook = cooks.get(event.seat)
			if (cook) {
				cook.pop()
				glyphOver(cook, cook.emote("suka"))
			}
		} else if (event.kind === "wrong") {
			sound.wrong()
			shake(0.3)
			customers[event.slot]?.refuse()
			const x = COLUMN_X[event.slot] ?? 0
			const at = px(headAt(x, 2.5, CUSTOMER_Z))
			if (at) floater("bukan itu!", at.x, at.y)
			const cook = cooks.get(event.seat)
			if (cook) glyphOver(cook, cook.emote("kaget"))
		} else if (event.kind === "left") {
			sound.left()
			shake(0.12)
			const customer = customers[event.slot]
			if (customer) {
				customers[event.slot] = null
				customer.storm(() => {
					world.scene.remove(customer.group)
					customer.dispose()
				})
			}
		} else if (event.kind === "over") {
			void showResult(event.stars)
		}
	}
}

// ---- screens ----
const show = (id: string, on: boolean) => void ($(id).hidden = !on)

function setPhase(next: Phase) {
	phase = next
	show("title", next === "title")
	show("lobby", next === "lobby")
	show("over", next === "over")
	const playing = next === "play" || next === "countdown"
	show("hud", playing)
	show("hint", next === "play")
	world.drift = next === "title" || next === "lobby" ? 1 : 0
}

function titleSetup() {
	logo()
	const name = $<HTMLInputElement>("name")
	name.value = myName
	name.addEventListener("input", () => {
		myName = name.value.trim().slice(0, 12) || "tamu"
		store.set("name", myName)
	})
	const holder = $("swatches")
	for (const color of PALETTE) {
		const button = document.createElement("button")
		button.type = "button"
		button.style.background = color
		button.setAttribute("role", "radio")
		button.setAttribute("aria-label", `Warna ${color}`)
		button.setAttribute("aria-checked", String(color === myColor))
		button.addEventListener("click", () => {
			sound.unlock()
			sound.pop()
			myColor = color
			store.set("color", color)
			for (const other of holder.children) other.setAttribute("aria-checked", String(other === button))
			cooks.get(me())?.setColor(color)
			cooks.get(me())?.pop()
		})
		holder.append(button)
	}
}

function muteSetup() {
	const button = $("mute")
	const sync = () => {
		button.classList.toggle("off", sound.muted)
		$("mute-icon").textContent = sound.muted ? "♪" : "♫"
	}
	sync()
	button.addEventListener("click", () => {
		sound.unlock()
		sound.setMuted(!sound.muted)
		sound.click()
		sync()
	})
}

function lobbyLink(): string {
	const here = new URL(location.href)
	if (here.hostname.startsWith(`${GAME_ID}.`)) return `${here.protocol}//${here.hostname.slice(GAME_ID.length + 1)}/lobby`
	return `${here.origin}/lobby`
}

function renderSeats() {
	const list = $("seats")
	const rows: { name: string; color: string; host: boolean; you: boolean }[] = [
		{ name: myName, color: myColor, host: net?.isHost ?? true, you: true },
		...[...(net?.remotes.values() ?? [])].map((remote) => ({
			name: remote.name,
			color: remote.color,
			host: net?.hostSeat === remote.seat,
			you: false,
		})),
	]
	const signature = JSON.stringify(rows)
	if (list.dataset.sig === signature) return
	list.dataset.sig = signature
	const items = rows.map((row) => {
		const li = document.createElement("li")
		li.innerHTML = `<span class="face" style="background:${row.color}"></span><span>${row.name}${row.you ? " (kamu)" : ""}</span>${row.host ? '<span class="badge">HOST</span>' : ""}`
		return li
	})
	for (let i = rows.length; i < 4; i += 1) {
		const empty = document.createElement("li")
		empty.className = "empty"
		empty.innerHTML = '<span class="face" style="background:#3b2c78"></span><span>menunggu…</span>'
		items.push(empty)
	}
	list.replaceChildren(...items)
	$("lobby-sub").textContent = !net?.joined ? "Menyambung ke ruangan…" : rows.length > 1 ? `${rows.length} pemain di ruangan` : "Baru kamu di sini. Undang temanmu!"
	const host = authority()
	$<HTMLButtonElement>("lobby-start").disabled = !host || !net?.joined
	$("lobby-start").textContent = host ? "MULAI" : "MENUNGGU HOST…"
}

async function showResult(stars: number) {
	if (resultShown) return
	resultShown = true
	sound.stopMusic()
	setPhase("over")
	const row = $("stars-row")
	for (const star of row.children) star.classList.remove("on")
	$("final-coins").textContent = "0"
	$("summary").textContent = `${state.served} pelanggan dilayani, ${state.left} pergi`
	$<HTMLButtonElement>("again").disabled = !authority()
	$("again").textContent = authority() ? "MAIN LAGI" : "MENUNGGU HOST…"
	$("buy").hidden = apron
	setTimeout(() => countUp($("final-coins"), state.coins, 900), 350)
	for (let index = 0; index < stars; index += 1) {
		setTimeout(() => {
			row.children[index]?.classList.add("on")
			sound.star(index)
			shake(0.15)
			world.burst(headAt(0, 3, 1.5))
		}, 900 + index * 520)
	}
	if (stars === 0) sound.left()
	else setTimeout(() => sound.fanfare(), 700)
	const rows = await topCoins(GAME_ID)
	$("board").replaceChildren(
		...(rows.length > 0
			? rows.map((entry, index) => {
					const item = document.createElement("li")
					item.textContent = `${index + 1}. ${entry.name} · ${entry.score}`
					if (entry.you) item.className = "you"
					return item
				})
			: [Object.assign(document.createElement("li"), { textContent: "Papan peringkat: belum ada skor" })]),
	)
}

// ---- starting a shift ----
function newShift() {
	state = create(seed(), null, roundLength)
	join(state, me())
	for (const seat of net?.remotes.keys() ?? []) join(state, seat)
	resultShown = false
	goal = null
	bubbles.clear()
	for (const [slot, customer] of customers.entries()) {
		if (customer) {
			world.scene.remove(customer.group)
			customer.dispose()
			customers[slot] = null
		}
	}
	void rollSpecial().then((special) => {
		if (special && authority() && !state.started) state.special = special
	})
}

/** Authority only: three, two, one, go; then the clock starts from zero. */
function runCountdown() {
	state.starting = true
	net?.publishWorld(state)
	enterCountdown()
	setTimeout(() => {
		if (!authority()) return
		begin(state)
		startedAt = performance.now()
		net?.publishWorld(state)
		enterPlay()
	}, 3300)
}

function enterCountdown() {
	if (phase === "countdown" || phase === "play") return
	setPhase("countdown")
	countdownShown = -1
	countdownStart = performance.now()
	sound.unlock()
}

function enterPlay() {
	if (phase === "play") return
	setPhase("play")
	sound.start()
	sound.startMusic(104)
	shake(0.1)
	showCountdown("GO!")
	$("hint").textContent = "Ketuk bahan, wajan, lalu pelanggan yang cocok"
	setTimeout(() => ($("hint").textContent = ""), 9000)
}

function showCountdown(text: string) {
	const holder = $("countdown")
	holder.hidden = false
	holder.innerHTML = `<b>${text}</b>`
	setTimeout(() => (holder.hidden = true), 900)
}

function startSolo() {
	sound.unlock()
	sound.click()
	net = null
	newShift()
	runCountdown()
}

function startParty() {
	sound.unlock()
	sound.click()
	net = new Net(GAME_ID, myName, party)
	wire(net)
	void net.connect().then(() => {
		cooks.get("you")?.group && dropCook("you")
		newShift()
	})
	setPhase("lobby")
}

function wire(net: Net) {
	net.onTap = (seat, target) => {
		if (!authority()) return
		const events = tap(state, seat, target, nowSeconds(performance.now()))
		net.publishEvents(events)
		net.publishWorld(state)
		react(events)
	}
	net.onWorld = (incoming) => {
		if (authority()) return
		state = incoming
		receivedAt = performance.now()
	}
	net.onEvents = (events) => {
		if (!authority()) react(events)
	}
	net.onRemoteEmote = (seat, name) => {
		const cook = cooks.get(seat)
		if (cook) glyphOver(cook, cook.emote(name))
	}
	net.onLeave = (seat) => {
		if (authority()) leave(state, seat)
		dropCook(seat)
	}
	net.onHost = (host) => {
		if (host && !wasAuthority) {
			startedAt = performance.now() - state.now * 1000
			join(state, me())
		}
		wasAuthority = host || !net.joined
	}
	net.room.on("seat", () => join(state, me()))
}

// ---- input ----
canvas.addEventListener("pointerdown", (event) => {
	sound.unlock()
	if (phase !== "play" || state.over) return
	const target = world.pick(event.clientX, event.clientY, canvas.getBoundingClientRect())
	if (!target) return
	const x = "customer" in target ? (COLUMN_X[target.customer] ?? 0) : STATION_X[target.station]
	goal = { target, x }
	cooks.get(me())?.walkTo(x)
	sound.pop()
})

function bindButtons() {
	$("play-solo").addEventListener("click", startSolo)
	$("play-party").addEventListener("click", startParty)
	$("open-help").addEventListener("click", () => {
		sound.unlock()
		sound.click()
		show("help", true)
	})
	$("close-help").addEventListener("click", () => {
		sound.click()
		show("help", false)
	})
	$("lobby-start").addEventListener("click", () => {
		if (!authority()) return
		sound.click()
		resultShown = false
		runCountdown()
	})
	$("lobby-back").addEventListener("click", () => {
		sound.click()
		net?.room.close()
		net = null
		for (const seat of [...cooks.keys()].filter((s) => s !== me())) dropCook(seat)
		setPhase("title")
	})
	$("invite").addEventListener("click", async () => {
		sound.click()
		const url = new URL(location.href)
		url.searchParams.delete("p")
		try {
			if (navigator.share) await navigator.share({ title: "Warung Desa", text: "Masak bareng aku di Warung Desa!", url: url.toString() })
			else {
				await navigator.clipboard.writeText(url.toString())
				const at = { x: stage.clientWidth / 2, y: stage.clientHeight * 0.7 }
				floater("link disalin!", at.x, at.y)
			}
		} catch {
			// the share sheet was dismissed
		}
	})
	$<HTMLAnchorElement>("open-lobby").href = lobbyLink()
	$("again").addEventListener("click", () => {
		if (!authority()) return
		sound.click()
		newShift()
		runCountdown()
	})
	$("to-title").addEventListener("click", () => {
		sound.click()
		sound.stopMusic()
		net?.room.close()
		net = null
		for (const seat of [...cooks.keys()].filter((s) => s !== me())) dropCook(seat)
		newShift()
		setPhase("title")
	})
	$("buy").addEventListener("click", () => {
		void buyApron().then((result) => {
			if (result === "owned") {
				apron = true
				$("buy").hidden = true
				for (const cook of cooks.values()) if (cook.local) cook.wearApron(true)
				sound.fanfare()
			}
		})
	})
}

// ---- frame loop ----
let last = performance.now()
let lastPose = 0
let lastWorld = 0

function resize() {
	world.resize(stage.clientWidth, stage.clientHeight)
}
new ResizeObserver(resize).observe(stage)
resize()

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

function frame(real: number) {
	requestAnimationFrame(frame)
	const rawDt = Math.min(0.05, (real - last) / 1000)
	last = real
	wall += rawDt
	const dt = consumeFreeze(rawDt) ? 0 : rawDt

	// Seats at the stall: me, then everyone the room shows.
	const mine = cookFor(me(), myName, myColor, true)
	if (me() !== "you" && cooks.has("you")) dropCook("you")
	for (const remote of net?.remotes.values() ?? []) {
		const cook = cookFor(remote.seat, remote.name, remote.color, false)
		cook.setColor(remote.color)
		if (authority()) join(state, remote.seat)
	}
	net?.sample(real)

	// Authority: advance the clock and publish.
	let now = 0
	if (state.started) now = nowSeconds(real)
	if (authority()) {
		if (state.started) {
			const events = tick(state, now)
			net?.publishEvents(events)
			react(events)
		}
		if (real - lastWorld > 1000 / WORLD_HZ && net?.joined) {
			lastWorld = real
			net.publishWorld(state)
		}
	} else {
		// A guest follows the host's phases.
		if (state.starting && phase === "lobby") enterCountdown()
		if (state.started && !state.over && phase !== "play") enterPlay()
		if (!state.started && !state.starting && (phase === "play" || phase === "over")) {
			resultShown = false
			setPhase("lobby")
		}
		if (state.over && phase !== "over") void showResult(state.coins >= STAR_COINS[2] ? 3 : state.coins >= STAR_COINS[1] ? 2 : state.coins >= STAR_COINS[0] ? 1 : 0)
	}

	// The local cook walks, then acts.
	if (goal && phase === "play" && !state.over) {
		if (!mine.moving && Math.abs(mine.x - goal.x) < 0.1) {
			const done = goal
			goal = null
			if (authority()) {
				const events = tap(state, me(), done.target, now)
				net?.publishEvents(events)
				net?.publishWorld(state)
				react(events)
			} else net?.sendTap(done.target)
		}
	}
	for (const cook of cooks.values()) cook.update(dt)

	// Plates, the wok, customers.
	for (const [seat, cook] of cooks) cook.plate.setItems(state.plates[seat] ?? [])
	world.setFrying(state.wajan.state === "idle" ? null : state.wajan.state === "frying" ? (now - state.wajan.since) / 3 : 1, state.wajan.state === "ready")
	syncCustomers(now)

	// Camera, scene, particles.
	updateTweens(dt)
	world.update(dt)
	world.render()

	// Network pose.
	if (net?.joined && real - lastPose > 1000 / POSE_HZ) {
		lastPose = real
		net.sendPose({ x: mine.x, e: null, n: emoteCount, name: myName, color: myColor })
	}

	hud(now)
	tagsAndBubbles(now)
	if (phase === "lobby") renderSeats()
	field()
}

function syncCustomers(now: number) {
	for (let slot = 0; slot < 3; slot += 1) {
		const order = state.orders[slot]
		const current = customers[slot]
		if (order) {
			if (!current || current.id !== order.id) {
				if (current) {
					world.scene.remove(current.group)
					current.dispose()
				}
				const next = new Customer(slot, order.id)
				world.scene.add(next.group)
				customers[slot] = next
				sound.pop()
			}
			customers[slot]?.setPatience(Math.max(0, 1 - (now - order.arrivedAt) / PATIENCE_SECONDS))
		} else if (current) {
			// No order and no event told us why: it is gone (a new shift), so remove it quietly.
			world.scene.remove(current.group)
			current.dispose()
			customers[slot] = null
		}
		customers[slot]?.update(0.016)
	}
}

function hud(now: number) {
	const remaining = Math.max(0, state.duration - now)
	const whole = Math.ceil(remaining)
	if (phase === "play") {
		$("timer-bar").style.strokeDashoffset = String(119.4 * (1 - remaining / state.duration))
		const label = document.querySelector<HTMLElement>('[data-testid="time"]')
		if (label && label.textContent !== String(whole)) label.textContent = String(whole)
		$("timer").classList.toggle("urgent", remaining <= 10)
		if (whole !== lastSecond) {
			lastSecond = whole
			if (remaining <= 10 && remaining > 0) sound.tick(remaining <= 3)
			if (remaining <= 15) sound.setTempo(126)
		}
	}
	shownCoins += (state.coins - shownCoins) * 0.2
	if (Math.abs(state.coins - shownCoins) < 0.5) shownCoins = state.coins
	const coins = q("coins")
	if (coins && coins.textContent !== String(Math.round(shownCoins))) coins.textContent = String(Math.round(shownCoins))
	const served = q("served")
	if (served) served.textContent = String(state.served)
	const room = q("room")
	if (room) room.textContent = net?.joined ? (net.isHost ? "host" : "tamu") : "solo"
	const players = q("players")
	if (players) players.textContent = String(net?.players ?? 1)

	const special = state.special ? RECIPES.find((recipe) => recipe.id === state.special) : null
	$("special").hidden = !special || phase !== "play"
	if (special) $("special-text").textContent = `${special.name} bayar +50%`

	// The countdown digits, from the authority's clock (or the guest's own once it sees "starting").
	if (phase === "countdown" && !state.started) {
		const elapsed = (performance.now() - countdownStart) / 1000
		const digit = 3 - Math.floor(elapsed)
		if (digit !== countdownShown && digit >= 1) {
			countdownShown = digit
			showCountdown(String(digit))
			sound.tick(true)
		}
	}

	if (phase === "play") {
		const plate = state.plates[me()] ?? []
		const hint = $("hint")
		const ready = state.orders.some((order) => order && same(plate, order.recipe.items))
		const text = ready ? "Piring cocok! Ketuk pelanggannya" : plate.length >= PLATE_MAX ? "Piring penuh: layani atau mulai lagi" : plate.length > 0 ? "Cocokkan dengan pesanan di atas kepala pelanggan" : ""
		if (hint.textContent && hint.textContent.startsWith("Ketuk bahan") && now < 9) return
		hint.textContent = text
		hint.hidden = text === ""
	}
}

function tagsAndBubbles(now: number) {
	for (const [seat, cook] of cooks) {
		const tag = tags.get(seat)
		if (!tag) continue
		tag.hidden = phase === "title" && !cook.local ? true : false
		tag.textContent = cook.local ? myName : (net?.remotes.get(seat)?.name ?? seat.slice(-4))
		const at = px(headAt(cook.x, -0.12, COOK_Z + 0.55))
		if (at) tag.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)`
	}
	const specs = []
	if (phase === "play") {
		for (let slot = 0; slot < 3; slot += 1) {
			const order = state.orders[slot]
			const customer = customers[slot]
			if (!order || !customer) continue
			const at = px(headAt(customer.group.position.x, 2.55 + Math.max(0, customer.group.position.y), CUSTOMER_Z))
			if (!at) continue
			specs.push({
				id: order.id,
				name: order.recipe.name,
				items: order.recipe.items,
				patience: Math.max(0, 1 - (now - order.arrivedAt) / PATIENCE_SECONDS),
				special: state.special === order.recipe.id,
				x: at.x,
				y: at.y,
				scale: Math.min(1.15, Math.max(0.8, stage.clientWidth / 900)),
			})
		}
	}
	bubbles.update(specs)
}

function field() {
	const element = q("field")
	if (!element) return
	element.dataset.orders = JSON.stringify(state.orders.map((order) => order?.recipe.items ?? null))
	element.dataset.plate = (state.plates[me()] ?? []).join(",")
	element.dataset.wajan = state.wajan.state
	element.dataset.special = state.special ?? ""
	element.dataset.phase = phase
	// Pixel positions of what can be tapped, so a test taps what a player would see.
	const spot = (x: number, y: number, z: number) => {
		const at = px(headAt(x, y, z))
		return at ? [Math.round(at.x), Math.round(at.y)] : null
	}
	element.dataset.hits = JSON.stringify({
		nasi: spot(STATION_X.nasi, 1.3, TABLE_Z),
		wajan: spot(STATION_X.wajan, 1.3, TABLE_Z),
		sambal: spot(STATION_X.sambal, 1.3, TABLE_Z),
		customers: COLUMN_X.map((x) => spot(x, 1.8, CUSTOMER_Z)),
	})
}

// ---- go ----
titleSetup()
muteSetup()
bindButtons()
setPhase("title")
cookFor("you", myName, myColor, true)
join(state, "you")
void ownsApron().then((owned) => {
	apron = owned
	for (const cook of cooks.values()) if (cook.local) cook.wearApron(owned)
})
// The title's Plup waves hello now and then.
setInterval(() => {
	if (phase === "title") cooks.get(me())?.emote("wave")
}, 4200)
if (party) {
	// A link from the Plupin lobby: straight into the waiting room, seated in the party's room.
	startParty()
}
requestAnimationFrame(frame)
void lengthOf
void tween
