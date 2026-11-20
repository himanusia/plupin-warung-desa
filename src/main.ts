import { Vector3 } from "three"
import "./style.css"
import { type Account, friendLink, guest, loadAccount, type Me, platformOrigin, signIn } from "./account"
import { Cook, type CookLook, Customer, food, Plate } from "./actors"
import { sound } from "./audio"
import { topCoins } from "./board"
import { emote as findEmote } from "./emotes"
import { consumeFreeze, ease, hitStop, shake, tween, updateTweens } from "./fx"
import {
	begin,
	COMBO_WINDOW,
	create,
	FRY_SECONDS,
	type GameEvent,
	type Item,
	join,
	leave,
	PATIENCE_SECONDS,
	playersOf,
	RECIPES,
	type Seat,
	type State,
	starCoins,
	starsFor,
	type Target,
	tap,
	tick,
} from "./game"
import { nextHint } from "./hints"
import { type Look, Net, POSE_HZ, WORLD_HZ } from "./net"
import { rollSpecial } from "./roll"
import { COLUMN_X, COOK_Z, CUSTOMER_Z, STATION_X, TABLE_Z, World } from "./scene"
import { onSettings, QUALITY, settings, update as updateSettings } from "./settings"
import { buyApron, ownsApron } from "./shop"
import { $, Bubbles, bump, countUp, floater, flyCoins, icon, logo, miniPlate, q } from "./ui"

/**
 * The shell: a three.js scene, a clock, a screen flow (sign-in, title, waiting room, countdown, play,
 * result) and the reaction to what the rules report. One seat is the authority and runs game.ts; the
 * others send taps and are drawn from what arrives. With no room, this page is its own authority: solo
 * is the same code path with one seat. Nothing here decides whether a plate is right.
 *
 * Who you are is your Plupin account (see account.ts): name, look, emotes and badge come from the
 * platform, and a signed-out player is sent to sign in first.
 */

const GAME_ID = "warung-desa"
const params = new URLSearchParams(location.search)
const party = params.get("p") ?? undefined

const canvas = $<HTMLCanvasElement>("game")
const stage = $("game").parentElement as HTMLElement
const world = new World(canvas)
const bubbles = new Bubbles()

// ---- who I am ----
let me_: Me = guest("tamu")
let apron = false
const myName = () => me_.name

// ---- state ----
type Phase = "boot" | "gate" | "title" | "lobby" | "countdown" | "play" | "over"
let phase: Phase = "boot"
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
let myEmote: string | null = null
let shownCoins = 0
let countdownShown = -1
let countdownStart = performance.now()
let lastSecond = -1
let resultShown = false
let afterHelp: (() => void) | null = null

const authority = () => !net || !net.joined || net.isHost
const me = (): Seat => net?.seat ?? "you"

const cooks = new Map<Seat, Cook>()
const tags = new Map<Seat, HTMLElement>()
const looksSeen = new Map<Seat, number>()
const customers: (Customer | null)[] = [null, null, null]

const jolt = (amount: number) => settings().shake && shake(amount)
const freeze = (seconds: number) => settings().shake && hitStop(seconds)

function nowSeconds(real: number): number {
	if (authority()) return Math.min(state.duration, (real - startedAt) / 1000)
	return Math.min(state.duration, state.now + (real - receivedAt) / 1000)
}

const el = (tag: string, className = "", text = "") => {
	const node = document.createElement(tag)
	if (className) node.className = className
	if (text) node.textContent = text
	return node
}
const badgeMark = (badge: Me["badge"]) => (badge ? el("span", `badge-mark ${badge}`, badge === "official" ? "★" : "✔") : null)

// ---- cooks ----
const lookOf = (): CookLook => ({ color: me_.color, shape: me_.shape, skin: me_.skin })

function homeSpot(): number {
	for (const spot of [0, -1.7, 1.7, -3.4, 3.4]) if ([...cooks.values()].every((cook) => Math.abs(cook.x - spot) > 1.1)) return spot
	return 0
}

function cookFor(seat: Seat, name: string, look: CookLook, local: boolean): Cook {
	let cook = cooks.get(seat)
	if (!cook) {
		cook = new Cook(seat, name, look, homeSpot(), local)
		cook.wearApron(local && apron)
		world.scene.add(cook.group, cook.plate.group)
		cooks.set(seat, cook)
		const tag = el("div", `nametag${local ? " me" : ""}`)
		$("floaters").append(tag)
		tags.set(seat, tag)
	}
	return cook
}

function dropCook(seat: Seat) {
	const cook = cooks.get(seat)
	if (!cook) return
	world.scene.remove(cook.group, cook.plate.group)
	cook.dispose()
	cooks.delete(seat)
	tags.get(seat)?.remove()
	tags.delete(seat)
	looksSeen.delete(seat)
}

// ---- effects ----
const at3 = (x: number, y: number, z: number) => new Vector3(x, y, z)
const px = (point: Vector3) => world.project(point, { width: stage.clientWidth, height: stage.clientHeight })
const STATION_OF: Record<Item, keyof typeof STATION_X> = { nasi: "nasi", kerupuk: "kerupuk", tempe: "wajan", sambal: "sambal" }

function flyItem(item: Item, seat: Seat) {
	const cook = cooks.get(seat)
	if (!cook) return
	const from = at3(STATION_X[STATION_OF[item]], 1.9, TABLE_Z)
	const to = world.plateAt(cook.x).add(at3(0, 0.25, 0))
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

/** A whole plate in the air: from a cook's hands to a customer's counter spot (or to another cook). */
function flyPlate(items: readonly Item[], from: Vector3, to: Vector3, linger = 0.7) {
	if (items.length === 0) return
	const plate = new Plate()
	plate.setItems(items)
	plate.group.position.copy(from)
	world.scene.add(plate.group)
	tween(0.5, (p) => {
		plate.group.position.lerpVectors(from, to, p)
		plate.group.position.y += Math.sin(p * Math.PI) * 0.9
		plate.group.rotation.y = p * 5
	}, {
		easing: ease.outQuad,
		done: () => {
			plate.group.rotation.y = 0
			tween(0.2, (p) => plate.group.scale.setScalar(1 - p), { delay: linger, easing: ease.linear, done: () => world.scene.remove(plate.group) })
		},
	})
}

function glyphOver(cook: Cook, glyph: string | undefined) {
	if (!glyph) return
	const at = px(at3(cook.x, 3.2, COOK_Z))
	if (at) floater(glyph, at.x, at.y, "glyph")
}

function say(cook: Cook | undefined, text: string) {
	const at = cook ? px(at3(cook.x, 3.2, COOK_Z)) : null
	if (at) floater(text, at.x, at.y)
}

function banner(text: string) {
	const node = el("div", "banner", text)
	stage.append(node)
	node.addEventListener("animationend", () => node.remove())
}

function react(events: GameEvent[]) {
	const mine = me()
	for (const event of events) {
		if (event.kind === "took") {
			const cook = cooks.get(event.seat)
			sound.pick(event.item === "nasi" ? 0 : event.item === "tempe" ? 1 : event.item === "kerupuk" ? 3 : 2)
			// The local cook already reached out when the tap went; others reach out when the news arrives.
			if (event.seat !== mine) cook?.act("grab")
			cook?.pop()
			flyItem(event.item, event.seat)
			if (event.item === "tempe") world.puff(at3(STATION_X.wajan, 1.8, TABLE_Z), 8)
		} else if (event.kind === "frying") {
			sound.sizzleStart()
			if (event.seat !== mine) cooks.get(event.seat)?.act("grab")
			world.puff(at3(STATION_X.wajan, 1.9, TABLE_Z), 12)
			jolt(0.08)
		} else if (event.kind === "stirred") {
			sound.team()
			if (event.seat !== mine) cooks.get(event.seat)?.act("stir")
			world.sparkle(at3(STATION_X.wajan, 1.8, TABLE_Z), 16)
			world.puff(at3(STATION_X.wajan, 1.9, TABLE_Z), 10)
			tween(0.9, (p) => (world.wokFood.rotation.y = p * Math.PI * 6), { easing: ease.outQuad })
			const at = px(at3(STATION_X.wajan, 2.8, TABLE_Z))
			if (at) floater("dibantu aduk!", at.x, at.y)
			jolt(0.1)
		} else if (event.kind === "ready") {
			sound.ready()
			world.sparkle(at3(STATION_X.wajan, 2.1, TABLE_Z), event.stirred ? 26 : 18)
			const at = px(at3(STATION_X.wajan, 2.6, TABLE_Z))
			if (at) floater(event.stirred ? "ting! cepat!" : "ting!", at.x, at.y)
		} else if (event.kind === "have" || event.kind === "full") {
			if (event.seat === mine) {
				sound.wrong()
				say(cooks.get(event.seat), event.kind === "full" ? "penuh!" : "sudah ada")
			}
		} else if (event.kind === "gave") {
			const giver = cooks.get(event.from)
			const taker = cooks.get(event.to)
			sound.team(1)
			if (event.from !== mine) {
				giver?.faceCook(taker?.x ?? 0)
				giver?.act("hand")
			}
			if (giver && taker) flyPlate(event.items, giver.hands, taker.hands, 0.1)
			say(taker, "oper!")
		} else if (event.kind === "half") {
			const cook = cooks.get(event.seat)
			const x = COLUMN_X[event.slot] ?? 0
			sound.coin(2)
			if (event.seat !== mine) {
				cook?.faceCustomers()
				cook?.act("hand")
			}
			world.sparkle(at3(x, 1.8, CUSTOMER_Z + 0.4), 12)
			const at = px(at3(x, 2.5, CUSTOMER_Z))
			if (at) floater("piring 1/2! temanmu?", at.x, at.y)
		} else if (event.kind === "need-partner") {
			if (event.seat === mine) {
				sound.wrong()
				say(cooks.get(event.seat), "harus koki lain!")
			}
		} else if (event.kind === "half-lost") {
			sound.left()
			const x = COLUMN_X[event.slot] ?? 0
			const at = px(at3(x, 2.5, CUSTOMER_Z))
			if (at) floater("piring pesta dingin", at.x, at.y)
		} else if (event.kind === "served") {
			const customer = customers[event.slot]
			const cook = cooks.get(event.seat)
			const x = COLUMN_X[event.slot] ?? 0
			sound.serve()
			if (event.combo >= 2) sound.coin(event.combo)
			if (event.team) sound.team(2)
			world.sparkle(at3(x, 1.8, CUSTOMER_Z + 0.4), event.team ? 36 : 24)
			if (event.team) world.burst(at3(x, 2.2, CUSTOMER_Z + 0.5))
			freeze(0.06)
			jolt(event.team ? 0.28 : 0.18)
			if (event.seat !== mine) {
				cook?.faceCustomers()
				cook?.act("hand")
			}
			if (cook) flyPlate(cook.plate.items, cook.hands, world.counterSpot(event.slot), 0.5)
			const at = px(at3(x, 2.5, CUSTOMER_Z))
			if (at) {
				floater(`+${event.coins}`, at.x, at.y)
				if (event.combo >= 2) floater(`KOMBO x${event.combo}`, at.x, at.y - 44)
				if (event.team) floater("PESTA!", at.x, at.y - 84)
				if (event.seat === mine) flyCoins(at, Math.min(9, 3 + Math.floor(event.coins / 6)), () => bump($("coins-chip")))
			}
			if (event.combo >= 2) bump($("combo"))
			if (state.special && customer && RECIPES.find((r) => r.id === state.special)) world.burst(at3(x, 2.2, CUSTOMER_Z + 0.5))
			if (customer) {
				customers[event.slot] = null
				customer.celebrate(() => {
					world.scene.remove(customer.group)
					customer.dispose()
				})
			}
			if (cook) {
				cook.pop()
				glyphOver(cook, cook.emote("suka"))
			}
		} else if (event.kind === "wrong") {
			sound.wrong()
			jolt(0.3)
			customers[event.slot]?.refuse()
			const x = COLUMN_X[event.slot] ?? 0
			const at = px(at3(x, 2.5, CUSTOMER_Z))
			if (at) floater("bukan itu!", at.x, at.y)
			const cook = cooks.get(event.seat)
			if (cook) glyphOver(cook, cook.emote("kaget"))
		} else if (event.kind === "left") {
			sound.left()
			jolt(0.12)
			const customer = customers[event.slot]
			if (customer) {
				customers[event.slot] = null
				customer.storm(() => {
					world.scene.remove(customer.group)
					customer.dispose()
				})
			}
		} else if (event.kind === "rush") {
			sound.rush()
			sound.setTempo(120)
			banner("JAM SIBUK!")
			jolt(0.2)
		} else if (event.kind === "over") {
			void showResult(event.stars)
		}
	}
}

// ---- screens ----
const show = (id: string, on: boolean) => void ($(id).hidden = !on)

function setPhase(next: Phase) {
	phase = next
	show("gate", next === "gate")
	show("title", next === "title")
	show("lobby", next === "lobby")
	show("over", next === "over")
	const playing = next === "play" || next === "countdown"
	show("hud", playing)
	show("chips", next === "play")
	show("dock", next === "play")
	world.drift = next === "title" || next === "lobby" || next === "gate" ? 1 : 0
	if (next !== "play") world.mark(null)
	syncMusic()
}

/** The calm tune for every screen but the shift, the full one for the shift. */
function syncMusic() {
	if (!sound.unlocked) return
	const mode = phase === "play" ? "play" : "menu"
	sound.startMusic(mode)
	sound.setMode(mode)
	$("music-pill").hidden = true
}

function accountSetup() {
	logo()
	$("gate-signin").addEventListener("click", async () => {
		sound.unlock()
		sound.click()
		$("gate-note").textContent = "Menunggu jendela Plupin…"
		const next = await signIn()
		useAccount(next)
		if (next.status === "signin_required") $("gate-note").textContent = "Belum masuk. Selesaikan masuk di jendela Plupin, lalu tekan lagi."
	})
	$<HTMLAnchorElement>("gate-signup").href = `${platformOrigin(GAME_ID)}/sign-in`
	$<HTMLAnchorElement>("account-edit").href = `${platformOrigin(GAME_ID)}/avatar`
}

function useAccount(account: Account) {
	if (account.status === "signin_required") {
		setPhase("gate")
		return
	}
	me_ = params.get("name") ? { ...account.me, name: params.get("name") ?? account.me.name } : account.me
	const face = $("account-face")
	face.style.background = me_.color
	$("account-name").textContent = me_.name
	$("account-sub").textContent = me_.guest ? "Tamu: masuk ke Plupin untuk memakai skin-mu" : `@${me_.username ?? "plupin"}${me_.badge === "official" ? " · akun resmi" : me_.badge === "verified" ? " · kreator terverifikasi" : ""}`
	const holder = cookFor("you", myName(), lookOf(), true)
	holder.setLook(lookOf())
	emoteBarSetup()
	if (phase === "gate" || phase === "boot") {
		setPhase("title")
		if (party) startParty()
	}
}

function emoteBarSetup() {
	const bar = $("emotes")
	const known = me_.emotes.map((id) => findEmote(id)).filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
	const unique = [...new Map(known.map((entry) => [entry.id, entry])).values()].slice(0, 6)
	bar.replaceChildren(
		...unique.map((entry) => {
			const button = el("button", "", entry.glyph) as HTMLButtonElement
			button.type = "button"
			button.title = entry.label
			button.addEventListener("click", () => {
				sound.pop()
				myEmote = entry.id
				emoteCount += 1
				glyphOver(cooks.get(me()) as Cook, cooks.get(me())?.emote(entry.id))
			})
			return button
		}),
	)
	bar.hidden = unique.length === 0
}

function settingsSetup() {
	const music = $<HTMLInputElement>("set-music")
	const sfx = $<HTMLInputElement>("set-sfx")
	const shakeBox = $<HTMLInputElement>("set-shake")
	const hintsBox = $<HTMLInputElement>("set-hints")
	const seg = $("set-quality")
	onSettings((value) => {
		music.value = String(Math.round(value.music * 100))
		sfx.value = String(Math.round(value.sfx * 100))
		shakeBox.checked = value.shake
		hintsBox.checked = value.hints
		for (const button of seg.children) button.setAttribute("aria-checked", String((button as HTMLElement).dataset.q === value.quality))
		sound.setVolumes(value.music, value.sfx)
		world.setQuality(value.quality)
	})
	music.addEventListener("input", () => updateSettings({ music: Number(music.value) / 100 }))
	sfx.addEventListener("input", () => updateSettings({ sfx: Number(sfx.value) / 100 }))
	sfx.addEventListener("change", () => sound.pop())
	shakeBox.addEventListener("change", () => updateSettings({ shake: shakeBox.checked }))
	hintsBox.addEventListener("change", () => updateSettings({ hints: hintsBox.checked }))
	for (const button of seg.children) {
		button.addEventListener("click", () => {
			const level = (button as HTMLElement).dataset.q as keyof typeof QUALITY
			updateSettings({ quality: level })
			sound.click()
		})
	}
	$("open-settings").addEventListener("click", () => {
		sound.unlock()
		sound.click()
		show("settings", true)
	})
	$("close-settings").addEventListener("click", () => {
		sound.click()
		show("settings", false)
	})
	$("set-replay").addEventListener("click", () => {
		show("settings", false)
		show("help", true)
	})
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
	// Browsers only let sound start after a tap or key press: the first one, anywhere, starts the tune.
	const wake = () => {
		sound.unlock()
		syncMusic()
	}
	window.addEventListener("pointerdown", wake, { passive: true })
	window.addEventListener("keydown", wake)
	sound.onUnlock = syncMusic
	$("music-pill").addEventListener("click", wake)
	setTimeout(() => {
		if (!sound.unlocked && phase !== "play") $("music-pill").hidden = false
	}, 600)
}

function lobbyLink(): string {
	return `${platformOrigin(GAME_ID)}/lobby`
}

function friendButton(username: string | null): HTMLElement | null {
	if (!username) return null
	const link = el("a", "friend", "+ TEMAN")
	link.setAttribute("href", friendLink(GAME_ID, username))
	link.setAttribute("target", "_blank")
	link.setAttribute("rel", "noopener")
	link.title = `Tambah @${username} sebagai teman di Plupin`
	return link
}

function renderSeats() {
	const list = $("seats")
	const rows = [
		{ name: myName(), color: me_.color, badge: me_.badge, username: null as string | null, host: net?.isHost ?? true, you: true },
		...[...(net?.remotes.values() ?? [])].map((remote) => ({
			name: remote.name,
			color: remote.color,
			badge: remote.badge,
			username: remote.username,
			host: net?.hostSeat === remote.seat,
			you: false,
		})),
	]
	const signature = JSON.stringify(rows)
	if (list.dataset.sig === signature) return
	list.dataset.sig = signature
	const items = rows.map((row) => {
		const li = el("li")
		const face = el("span", "face")
		face.style.background = row.color
		const who = el("span", "who-name")
		who.append(el("span", "", `${row.name}${row.you ? " (kamu)" : ""}`))
		const mark = badgeMark(row.badge)
		if (mark) who.append(mark)
		li.append(face, who)
		if (row.host) li.append(el("span", "badge", "HOST"))
		const friend = friendButton(row.username)
		if (friend) li.append(friend)
		return li
	})
	for (let i = rows.length; i < 4; i += 1) {
		const empty = el("li", "empty")
		const face = el("span", "face")
		face.style.background = "#3b2c78"
		empty.append(face, el("span", "", "menunggu…"))
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
	setPhase("over")
	const row = $("stars-row")
	for (const star of row.children) star.classList.remove("on")
	$("final-coins").textContent = "0"
	$("summary").textContent = `${state.served} pelanggan dilayani, ${state.left} pergi${playersOf(state) > 1 ? `, ${playersOf(state)} koki` : ""}`
	$<HTMLButtonElement>("again").disabled = !authority()
	$("again").textContent = authority() ? "MAIN LAGI" : "MENUNGGU HOST…"
	$("buy").hidden = apron
	const players = Object.entries(state.byseat).sort((a, b) => b[1].coins - a[1].coins)
	$("team").replaceChildren(
		...(players.length > 1
			? players.map(([seat, score], index) => {
					const li = el("li")
					const remote = net?.remotes.get(seat)
					const name = seat === me() ? myName() : (remote?.name ?? seat.slice(-4))
					li.append(el("span", index === 0 ? "mvp" : "", index === 0 ? "★" : `${index + 1}.`), el("span", "grow", seat === me() ? `${name} (kamu)` : name), el("span", "", `${score.served} piring · ${score.coins}`))
					const friend = seat === me() ? null : friendButton(remote?.username ?? null)
					if (friend) li.append(friend)
					return li
				})
			: []),
	)
	setTimeout(() => countUp($("final-coins"), state.coins, 900), 350)
	for (let index = 0; index < stars; index += 1) {
		setTimeout(() => {
			row.children[index]?.classList.add("on")
			sound.star(index)
			jolt(0.15)
			world.burst(at3(0, 3, 1.5))
		}, 900 + index * 520)
	}
	if (stars === 0) sound.left()
	else setTimeout(() => sound.fanfare(), 700)
	const rows = await topCoins(GAME_ID)
	$("board").replaceChildren(
		...(rows.length > 0
			? rows.map((entry, index) => {
					const item = el("li", entry.you ? "you" : "", `${index + 1}. ${entry.name} · ${entry.score}`)
					return item
				})
			: [el("li", "", "Papan peringkat: belum ada skor")]),
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
	sound.setTempo(104)
	jolt(0.1)
	showCountdown("GO!")
}

function showCountdown(text: string) {
	const holder = $("countdown")
	holder.hidden = false
	holder.innerHTML = ""
	holder.append(el("b", "", text))
	setTimeout(() => (holder.hidden = true), 900)
}

/** The first time, the how-to-play card comes before the shift. */
function withHelp(go: () => void) {
	if (settings().tutorialDone) return go()
	afterHelp = go
	show("help", true)
}

function startSolo() {
	sound.unlock()
	sound.click()
	withHelp(() => {
		net = null
		newShift()
		runCountdown()
	})
}

function startParty() {
	sound.unlock()
	sound.click()
	net = new Net(GAME_ID, myName(), party)
	wire(net)
	void net.connect().then(() => {
		if (me() !== "you") dropCook("you")
		newShift()
		sendLook()
	})
	setPhase("lobby")
}

function sendLook() {
	const look: Look = { name: myName(), username: me_.username, badge: me_.badge, color: me_.color, shape: me_.shape as string, skin: me_.skin, emotes: me_.emotes }
	net?.sendLook(look)
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
	net.onHello = () => sendLook()
	net.onHost = (host) => {
		if (host && !wasAuthority) {
			startedAt = performance.now() - state.now * 1000
			join(state, me())
		}
		wasAuthority = host || !net.joined
	}
	net.room.on("seat", () => {
		join(state, me())
		sendLook()
	})
}

// ---- input ----
canvas.addEventListener("pointerdown", (event) => {
	sound.unlock()
	if (phase !== "play" || state.over) return
	const others = [...cooks.values()].filter((cook) => cook.seat !== me()).map((cook) => cook.hitbox)
	const target = world.pick(event.clientX, event.clientY, canvas.getBoundingClientRect(), others)
	if (!target) return
	const mine = cooks.get(me())
	let x = 0
	if ("customer" in target) x = COLUMN_X[target.customer] ?? 0
	else if ("station" in target) x = STATION_X[target.station]
	else {
		const other = cooks.get(target.cook)
		if (!other || !mine) return
		x = other.x + (mine.x < other.x ? -0.95 : 0.95)
	}
	goal = { target, x }
	mine?.walkTo(x)
	sound.pop()
})

function bindButtons() {
	$("play-solo").addEventListener("click", startSolo)
	$("play-party").addEventListener("click", () => withHelp(startParty))
	$("open-help").addEventListener("click", () => {
		sound.unlock()
		sound.click()
		show("help", true)
	})
	$("close-help").addEventListener("click", () => {
		sound.click()
		show("help", false)
		updateSettings({ tutorialDone: true })
		const next = afterHelp
		afterHelp = null
		next?.()
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
				floater("link disalin!", stage.clientWidth / 2, stage.clientHeight * 0.7)
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
let lastLook = 0

function resize() {
	world.resize(stage.clientWidth, stage.clientHeight)
}
new ResizeObserver(resize).observe(stage)
resize()

/** What the local cook does with its hands the moment the tap goes out. */
function actFor(cook: Cook, target: Target) {
	if ("customer" in target) {
		cook.faceCustomers()
		cook.act("hand")
	} else if ("cook" in target) {
		cook.faceCook(cooks.get(target.cook)?.x ?? cook.x)
		cook.act("hand")
	} else if (target.station === "wajan" && state.wajan.state === "frying" && state.wajan.by !== me()) cook.act("stir")
	else cook.act("grab")
}

function frame(real: number) {
	requestAnimationFrame(frame)
	const rawDt = Math.min(0.05, (real - last) / 1000)
	last = real
	const dt = consumeFreeze(rawDt) ? 0 : rawDt
	if (phase === "boot" || phase === "gate") {
		updateTweens(dt)
		world.update(dt, settings().shake)
		world.render()
		return
	}

	// Seats at the stall: me, then everyone the room shows.
	const mine = cookFor(me(), myName(), lookOf(), true)
	if (me() !== "you" && cooks.has("you")) dropCook("you")
	for (const remote of net?.remotes.values() ?? []) {
		const cook = cookFor(remote.seat, remote.name, { color: remote.color, shape: remote.shape, skin: remote.skin }, false)
		if (looksSeen.get(remote.seat) !== remote.looks) {
			looksSeen.set(remote.seat, remote.looks)
			cook.setLook({ color: remote.color, shape: remote.shape, skin: remote.skin })
		}
		cook.walkTo(remote.x)
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
		if (state.over && phase !== "over") void showResult(starsFor(state.coins, playersOf(state)))
	}

	// The local cook walks, then acts.
	if (goal && phase === "play" && !state.over) {
		if (!mine.moving && Math.abs(mine.x - goal.x) < 0.1) {
			const done = goal
			goal = null
			actFor(mine, done.target)
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
	world.setFrying(state.wajan.state === "idle" ? null : state.wajan.state === "frying" ? (now - state.wajan.since) / FRY_SECONDS : 1, state.wajan.state === "ready")
	syncCustomers(now)

	// Camera, scene, particles.
	updateTweens(dt)
	world.update(dt, settings().shake)
	world.render()

	// Network: who I am (rarely), where I stand and what I play (often).
	if (net?.joined && real - lastLook > 4000) {
		lastLook = real
		sendLook()
	}
	if (net?.joined && real - lastPose > 1000 / POSE_HZ) {
		lastPose = real
		net.sendPose({ x: mine.x, e: myEmote, n: emoteCount, name: myName(), color: me_.color })
	}

	hud(now)
	dock(now)
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
		const label = q("time")
		if (label && label.textContent !== String(whole)) label.textContent = String(whole)
		$("timer").classList.toggle("urgent", remaining <= 10)
		if (whole !== lastSecond) {
			lastSecond = whole
			if (remaining <= 10 && remaining > 0) sound.tick(remaining <= 3)
			if (remaining <= 15) sound.setTempo(132)
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
	if (players) players.textContent = String(playersOf(state))

	// The team's bar towards three stars: the bar grows with the number of cooks.
	const need = starCoins(playersOf(state))
	$("goal-fill").style.width = `${Math.min(100, (state.coins / need[2]) * 100)}%`
	const marks = $("goal").querySelectorAll<HTMLElement>("s")
	need.forEach((value, index) => {
		const mark = marks[index]
		if (mark) mark.style.left = `calc(${(value / need[2]) * 100}% - 3px)`
	})
	$("goal-text").textContent = `${state.coins} / ${need[2]} koin${playersOf(state) > 1 ? ` · tim ${playersOf(state)}` : ""}`

	const special = state.special ? RECIPES.find((recipe) => recipe.id === state.special) : null
	$("special").hidden = !special || phase !== "play"
	if (special) $("special-text").textContent = `${special.name} bayar +50%`
	$("rush").hidden = !(state.rush && phase === "play")
	const comboLeft = 1 - (now - state.lastServeAt) / COMBO_WINDOW
	const comboOn = phase === "play" && state.combo >= 2 && comboLeft > 0
	$("combo").hidden = !comboOn
	if (comboOn) {
		$("combo-n").textContent = `x${state.combo}`
		$("combo-bar").style.transform = `scaleX(${Math.max(0, comboLeft)})`
	}

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
}

let trayKey = "init"
/** The plate tray, the next-step hint and the pointer on what to tap. */
function dock(now: number) {
	if (phase !== "play") return
	void now
	const plate = state.plates[me()] ?? []
	const key = plate.join(",")
	if (key !== trayKey) {
		const grew = plate.length > trayKey.split(",").filter(Boolean).length
		trayKey = key
		const slots = $("tray-slots")
		slots.replaceChildren(
			...Array.from({ length: 3 }, (_, index) => {
				const item = plate[index]
				const slot = el("span", `slot${item ? " full" : ""}${grew && index === plate.length - 1 ? " new" : ""}`)
				if (item) slot.innerHTML = icon(item)
				return slot
			}),
		)
	}
	const match = state.orders.find((order) => order && order.recipe.parts.some((items, index) => !order.got.includes(index) && items.length === plate.length && items.every((item) => plate.includes(item))))
	const recipe = $("tray-recipe")
	recipe.textContent = match ? `= ${match.recipe.name}` : plate.length === 0 ? "kosong" : "belum cocok"
	recipe.classList.toggle("ok", match !== undefined && match !== null)

	const hint = $("hint")
	const next = settings().hints ? nextHint(state, me()) : null
	hint.hidden = next === null
	if (next) {
		if (hint.textContent !== next.text) hint.textContent = next.text
		hint.className = `hint ${next.kind}`
	}
	world.mark(next?.mark && !("cook" in next.mark) ? next.mark : null)
}

function tagsAndBubbles(now: number) {
	for (const [seat, cook] of cooks) {
		const tag = tags.get(seat)
		if (!tag) continue
		tag.hidden = phase === "title" && !cook.local ? true : false
		const remote = net?.remotes.get(seat)
		const name = cook.local ? myName() : (remote?.name ?? seat.slice(-4))
		const badge = cook.local ? me_.badge : (remote?.badge ?? null)
		const carry = phase === "play" ? (state.plates[seat] ?? []) : []
		const signature = `${name}|${badge}|${carry.join()}`
		if (tag.dataset.sig !== signature) {
			tag.dataset.sig = signature
			tag.replaceChildren(el("span", "", name))
			const mark = badgeMark(badge)
			if (mark) tag.append(mark)
			if (carry.length > 0 && !cook.local) {
				const holder = el("span", "carry")
				holder.innerHTML = miniPlate(carry)
				tag.append(holder)
			}
		}
		const at = px(at3(cook.x, 3.05, COOK_Z))
		if (at) tag.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)`
	}
	const specs = []
	if (phase === "play") {
		const have = state.plates[me()] ?? []
		for (let slot = 0; slot < 3; slot += 1) {
			const order = state.orders[slot]
			const customer = customers[slot]
			if (!order || !customer) continue
			const at = px(at3(customer.group.position.x, 2.55 + Math.max(0, customer.group.position.y), CUSTOMER_Z))
			if (!at) continue
			specs.push({
				id: order.id,
				name: order.recipe.name,
				parts: order.recipe.parts,
				got: order.got,
				have,
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
	element.dataset.orders = JSON.stringify(state.orders.map((order) => order?.recipe.parts ?? null))
	element.dataset.plate = (state.plates[me()] ?? []).join(",")
	element.dataset.wajan = state.wajan.state
	element.dataset.special = state.special ?? ""
	element.dataset.phase = phase
	element.dataset.account = me_.guest ? "guest" : (me_.username ?? me_.name)
	// Pixel positions of what can be tapped, so a test taps what a player would see.
	const spot = (x: number, y: number, z: number) => {
		const at = px(at3(x, y, z))
		return at ? [Math.round(at.x), Math.round(at.y)] : null
	}
	element.dataset.hits = JSON.stringify({
		nasi: spot(STATION_X.nasi, 1.3, TABLE_Z),
		kerupuk: spot(STATION_X.kerupuk, 1.3, TABLE_Z),
		wajan: spot(STATION_X.wajan, 1.3, TABLE_Z),
		sambal: spot(STATION_X.sambal, 1.3, TABLE_Z),
		customers: COLUMN_X.map((x) => spot(x, 1.8, CUSTOMER_Z)),
		cooks: Object.fromEntries([...cooks].map(([seat, cook]) => [seat, spot(cook.x, 1.4, COOK_Z)])),
	})
}

// ---- go ----
accountSetup()
muteSetup()
settingsSetup()
bindButtons()
setPhase("boot")
cookFor("you", myName(), lookOf(), true)
join(state, "you")
void loadAccount().then(useAccount)
void ownsApron().then((owned) => {
	apron = owned
	for (const cook of cooks.values()) if (cook.local) cook.wearApron(owned)
})
// The title's Plup waves hello now and then.
setInterval(() => {
	if (phase === "title") cooks.get(me())?.emote("wave")
}, 4200)
requestAnimationFrame(frame)
