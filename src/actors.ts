import { createPlup, type PlupHandle, type PlupSkin } from "@plupin/character/three"
import type { CustomClip, NamedFace } from "@plupin/character"
import {
	BoxGeometry,
	ConeGeometry,
	CylinderGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	SphereGeometry,
	TorusGeometry,
	Vector3,
} from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { emote as findEmote, lengthOf, WADDLE } from "./emotes"
import { ease, tween } from "./fx"
import type { Item, Target } from "./game"
import { COLUMN_X, COOK_Y, COOK_Z, CUSTOMER_Z, PLATE_Z } from "./scene"
import { outlined, toon } from "./toon"

const PLUP_SCALE = 1.55

/** Arm clips, written as keyframes the way a creator would ship an animated emote. */
const BONES = ["armL", "armR", "legL", "legR", "torso"] as CustomClip["bones"]
function clip(frames: number, fps: number, at: (t: number) => { l?: [number, number, number]; r?: [number, number, number]; lean?: number; lift?: number }): CustomClip {
	return {
		fps,
		loop: false,
		bones: BONES,
		frames: Array.from({ length: frames }, (_, index) => {
			const t = index / (frames - 1)
			const { l = [0, 0, 0], r = [0, 0, 0], lean = 0, lift = 0 } = at(t)
			return [...l, ...r, 0, 0, 0, 0, 0, 0, lean, 0, 0, lift].map((value) => Math.round(value * 1000) / 1000)
		}),
	}
}
const swell = (t: number) => Math.sin(t * Math.PI)
/** Reach out with the right arm, grab, bring it back. */
export const GRAB = clip(12, 24, (t) => ({ r: [-1.5 * swell(t), 0, -0.2 * swell(t)], l: [0.2 * swell(t), 0, 0.1], lean: 0.3 * swell(t), lift: 0.14 * swell(t) }))
/** Both arms forward over the wok, circling. */
export const STIR = clip(20, 24, (t) => ({ r: [-1.2 + Math.sin(t * Math.PI * 4) * 0.25, 0, Math.cos(t * Math.PI * 4) * 0.35], l: [-0.5, 0, 0.2], lean: 0.25, lift: 0.04 * Math.abs(Math.sin(t * Math.PI * 4)) }))
/** Hand a plate over: both arms out, a little hop. */
export const HAND = clip(16, 24, (t) => ({ r: [-1.6 * swell(t), 0, -0.15], l: [-1.6 * swell(t), 0, 0.15], lean: 0.2 * swell(t), lift: 0.22 * swell(t) }))

export const PALETTE = ["#3d7bff", "#ff8a4c", "#4cc98a", "#c39bff", "#ffd24d", "#ff6f91"]

// ---- food ----

/** A piece of food as a 3D object, about 0.4 m across. */
export function food(item: Item, fried = true): Group {
	const group = new Group()
	if (item === "nasi") {
		const mound = outlined(new Mesh(new SphereGeometry(0.24, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon("#fffaf0")), 0.015)
		mound.scale.set(1, 0.7, 1)
		group.add(mound)
		for (let i = 0; i < 7; i += 1) {
			const grain = new Mesh(new SphereGeometry(0.012, 4, 4), toon("#e8dfc8"))
			const a = i * 2.4
			grain.position.set(Math.cos(a) * 0.12, 0.13 + (i % 3) * 0.02, Math.sin(a) * 0.12)
			group.add(grain)
		}
	} else if (item === "tempe") {
		const slab = outlined(new Mesh(new RoundedBoxGeometry(0.42, 0.1, 0.28, 2, 0.04), toon(fried ? "#e2a03a" : "#e8d3a0")), 0.012)
		slab.position.y = 0.05
		group.add(slab)
		for (let i = 0; i < 6; i += 1) {
			const bean = new Mesh(new SphereGeometry(0.02, 5, 4), toon(fried ? "#a6651c" : "#c9b27a"))
			bean.position.set(-0.14 + (i % 3) * 0.14, 0.1, i < 3 ? -0.06 : 0.06)
			group.add(bean)
		}
	} else if (item === "kerupuk") {
		for (let i = 0; i < 3; i += 1) {
			const disc = outlined(new Mesh(new CylinderGeometry(0.2, 0.2, 0.025, 14), toon(i === 1 ? "#f2c35a" : "#f9e3a8")), 0.01)
			disc.position.set((i - 1) * 0.1, 0.03 + i * 0.045, (i % 2 - 0.5) * 0.06)
			disc.rotation.set(0.12 * (i - 1), i, 0.1)
			group.add(disc)
		}
	} else {
		const leaf = outlined(new Mesh(new CylinderGeometry(0.22, 0.22, 0.02, 12), toon("#3fae74")), 0.012)
		leaf.scale.set(1, 1, 0.7)
		leaf.position.y = 0.01
		const dollop = outlined(new Mesh(new SphereGeometry(0.16, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon("#d8301f")), 0.012)
		dollop.scale.set(1, 0.8, 1)
		dollop.position.y = 0.02
		group.add(leaf, dollop)
	}
	for (const child of group.children) child.traverse((object) => void (object.castShadow = true))
	return group
}

/** A plate on the table that shows what a seat is carrying. */
export class Plate {
	readonly group = new Group()
	private readonly shown: Group[] = []
	items: Item[] = []

	constructor() {
		const dish = outlined(new Mesh(new CylinderGeometry(0.5, 0.42, 0.06, 24), toon("#ffffff")), 0.02)
		dish.position.y = 0.03
		const rim = new Mesh(new TorusGeometry(0.46, 0.02, 6, 28), toon("#4c8cff"))
		rim.rotation.x = Math.PI / 2
		rim.position.y = 0.065
		dish.receiveShadow = true
		this.group.add(dish, rim)
	}

	setItems(items: readonly Item[]) {
		const same = items.length === this.items.length && items.every((item, index) => item === this.items[index])
		if (same) return
		const added = items.slice(this.items.length)
		this.items = [...items]
		if (items.length < this.shown.length || added.length === 0) {
			for (const piece of this.shown) this.group.remove(piece)
			this.shown.length = 0
			items.forEach((item, index) => this.place(item, index, false))
			return
		}
		added.forEach((item, offset) => this.place(item, this.shown.length + offset, true))
	}

	private place(item: Item, index: number, pop: boolean) {
		const piece = food(item)
		const slots: [number, number][] = [[-0.22, 0.1], [0.22, 0.1], [0, -0.22]]
		const [x, z] = slots[index] ?? [0, 0]
		piece.position.set(x, 0.06, z)
		piece.scale.setScalar(0.95)
		this.group.add(piece)
		this.shown.push(piece)
		if (pop) {
			piece.scale.setScalar(0.01)
			tween(0.45, (p) => piece.scale.setScalar(Math.max(0.01, 0.95 * p)), { easing: ease.outElastic })
		}
	}
}

// ---- hats ----

type Hat = "peci" | "caping" | "flower" | "glasses" | "leaf" | "none"
const HATS: Hat[] = ["peci", "caping", "flower", "glasses", "leaf", "none"]

function hatFor(kind: Hat): Group | null {
	const group = new Group()
	if (kind === "peci") {
		const cap = outlined(new Mesh(new CylinderGeometry(0.27, 0.3, 0.26, 16), toon("#1c1b24")), 0.015)
		cap.position.y = 0.13
		const band = new Mesh(new CylinderGeometry(0.305, 0.305, 0.05, 16), toon("#d4af37"))
		band.position.y = 0.03
		group.add(cap, band)
		group.position.y = 1.08
	} else if (kind === "caping") {
		const brim = outlined(new Mesh(new ConeGeometry(0.78, 0.26, 18), toon("#e6c470")), 0.015)
		brim.position.y = 0.13
		const top = new Mesh(new CylinderGeometry(0.08, 0.14, 0.12, 10), toon("#c99b3c"))
		top.position.y = 0.3
		group.add(brim, top)
		group.position.y = 1.0
	} else if (kind === "flower") {
		for (let i = 0; i < 5; i += 1) {
			const petal = outlined(new Mesh(new SphereGeometry(0.075, 8, 6), toon("#ff7fb0")), 0.01)
			const a = (i / 5) * Math.PI * 2
			petal.position.set(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1)
			group.add(petal)
		}
		const middle = new Mesh(new SphereGeometry(0.06, 8, 6), toon("#ffd24d"))
		group.add(middle)
		group.position.set(0.3, 1.0, 0.18)
	} else if (kind === "glasses") {
		for (const side of [-1, 1]) {
			const lens = outlined(new Mesh(new TorusGeometry(0.11, 0.025, 8, 16), toon("#1c1b24")), 0.008)
			lens.position.set(side * 0.2, 0.68, 0.5)
			group.add(lens)
		}
		const bridge = new Mesh(new BoxGeometry(0.12, 0.03, 0.03), toon("#1c1b24"))
		bridge.position.set(0, 0.68, 0.5)
		group.add(bridge)
	} else if (kind === "leaf") {
		const leaf = outlined(new Mesh(new ConeGeometry(0.1, 0.34, 6), toon("#3fae74")), 0.01)
		leaf.position.y = 0.15
		leaf.rotation.z = 0.35
		group.add(leaf)
		group.position.y = 1.1
	} else return null
	return group
}

// ---- cooks ----

export interface CookLook {
	color: string
	shape: string
	skin: PlupSkin | undefined
}

export class Cook {
	readonly group = new Group()
	plup: PlupHandle
	readonly plate = new Plate()
	x: number
	target: number
	private phase = 0
	private emoteLeft = 0
	private actLeft = 0
	private landed = 0
	private apronMesh: Group | null = null
	private yaw = 0
	/** Where this cook faces: 0 towards the camera and the stalls, PI towards the customers. */
	private turn = 0
	private turnUntil = 0
	private clock = 0
	/** How far the cook is off the duckboard: hops while walking. */
	private hop = 0
	readonly local: boolean
	private readonly hit: Mesh
	/** The look this cook is drawn with: when it changes, the body is rebuilt. */
	private key = ""

	constructor(
		readonly seat: string,
		public name: string,
		look: CookLook,
		x: number,
		local: boolean,
	) {
		this.local = local
		this.plup = this.build(look)
		this.group.add(this.plup.object)
		this.x = x
		this.target = x
		this.group.position.set(x, COOK_Y, COOK_Z)
		this.plate.group.position.set(x, 0, 0)
		// A cook can be tapped, to pass a plate to them.
		this.hit = new Mesh(new BoxGeometry(1.5, 2.3, 1.4), new MeshBasicMaterial({ visible: false }))
		this.hit.position.y = 1.2
		this.hit.userData = { target: { cook: seat } satisfies Target }
		this.group.add(this.hit)
	}

	private build(look: CookLook): PlupHandle {
		this.key = JSON.stringify(look)
		const plup = createPlup({ color: look.color, face: "smug", shape: look.shape as never, ...(look.skin ? { skin: look.skin } : {}) })
		plup.object.scale.setScalar(PLUP_SCALE)
		return plup
	}

	/** The thing a ray should hit to mean "this cook". */
	get hitbox(): Mesh {
		return this.hit
	}

	/** Same player, new look (they changed it on the platform): rebuild the body. */
	setLook(look: CookLook) {
		if (JSON.stringify(look) === this.key) return
		const apron = this.apronMesh !== null
		this.wearApron(false)
		this.group.remove(this.plup.object)
		this.plup.dispose()
		this.plup = this.build(look)
		this.group.add(this.plup.object)
		if (apron) this.wearApron(true)
	}

	/** The gold apron: a rounded gold plate on the belly with a neck strap. */
	wearApron(on: boolean) {
		if (on === (this.apronMesh !== null)) return
		if (!on && this.apronMesh) {
			this.plup.bone("body")?.remove(this.apronMesh)
			this.apronMesh = null
			return
		}
		const apron = new Group()
		const front = outlined(new Mesh(new RoundedBoxGeometry(0.7, 0.55, 0.08, 2, 0.05), toon("#e0b43a")), 0.015)
		front.position.set(0, 0.42, 0.5)
		front.rotation.x = -0.12
		const strap = outlined(new Mesh(new TorusGeometry(0.34, 0.03, 6, 20, Math.PI), toon("#b88a1e")), 0.01)
		strap.position.set(0, 0.55, 0.42)
		strap.rotation.z = Math.PI
		strap.rotation.x = 0.4
		apron.add(front, strap)
		this.plup.bone("body")?.add(apron)
		this.apronMesh = apron
	}

	walkTo(x: number) {
		this.target = x
	}

	/** Turn to the customers for a moment (to hand a plate over), then back to the stalls. */
	faceCustomers(seconds = 0.9) {
		this.turn = Math.PI
		this.turnUntil = this.clock + seconds
	}

	/** Face another cook, to pass a plate: just a short lean towards them. */
	faceCook(towardsX: number, seconds = 0.6) {
		this.turn = Math.sign(towardsX - this.x) * 0.9
		this.turnUntil = this.clock + seconds
	}

	/** An arm clip for taking, stirring or handing over. */
	act(kind: "grab" | "stir" | "hand") {
		const clipOf = kind === "grab" ? GRAB : kind === "stir" ? STIR : HAND
		this.plup.play(clipOf)
		this.actLeft = lengthOf(clipOf) + 0.05
		this.emoteLeft = 0
	}

	/** Plays an emote on the mascot; returns its glyph for the screen. */
	emote(name: string): string | undefined {
		const found = findEmote(name)
		if (!found) return undefined
		this.plup.emote(found.id, found)
		this.emoteLeft = lengthOf(found.anim ?? found.clip) + 0.15
		this.actLeft = 0
		return found.glyph
	}

	face(face: NamedFace) {
		this.plup.setFace(face)
	}

	/** A small squash-and-stretch pop, for taking or tossing something. */
	pop() {
		const body = this.plup.object
		tween(0.32, (p) => {
			const k = Math.sin(p * Math.PI) * 0.16
			body.scale.set(PLUP_SCALE * (1 + k * 0.6), PLUP_SCALE * (1 - k), PLUP_SCALE * (1 + k * 0.6))
		}, { easing: ease.linear })
	}

	get moving(): boolean {
		return Math.abs(this.x - this.target) > 0.03
	}

	/** Where the hands are, in the world: the plate flies from here. */
	get hands(): Vector3 {
		return new Vector3(this.x, 2.1, COOK_Z + 0.6)
	}

	update(dt: number) {
		this.clock += dt
		if (this.clock > this.turnUntil) this.turn = 0
		const gap = this.target - this.x
		let lean = 0
		if (Math.abs(gap) > 0.03) {
			const step = Math.sign(gap) * Math.min(Math.abs(gap), 6.2 * dt)
			this.x += step
			this.phase += dt * 15
			this.hop = Math.abs(Math.sin(this.phase)) * 0.28
			// Lean into the walk but keep the face to the camera.
			lean = Math.sign(gap) * 0.4
			if (this.emoteLeft <= 0 && this.actLeft <= 0) this.plup.play(WADDLE)
			this.landed = 1
		} else {
			if (this.landed > 0) {
				this.landed = 0
				this.pop()
			}
			this.hop *= Math.max(0, 1 - dt * 18)
			if (this.emoteLeft <= 0 && this.actLeft <= 0) this.plup.play("idle")
		}
		const want = this.turn + lean
		this.yaw += (want - this.yaw) * Math.min(1, dt * 14)
		this.group.rotation.y = this.yaw
		if (this.emoteLeft > 0) {
			this.emoteLeft -= dt
			if (this.emoteLeft <= 0) {
				this.plup.setFace("smug")
				this.plup.play("idle")
			}
		}
		if (this.actLeft > 0) {
			this.actLeft -= dt
			if (this.actLeft <= 0) this.plup.play("idle")
		}
		this.group.position.x = this.x
		this.group.position.y = COOK_Y + this.hop
		this.plate.group.position.set(this.x, 0.98, PLATE_Z)
		this.plup.update(dt)
	}

	dispose() {
		this.plup.dispose()
	}
}

// ---- customers ----

export class Customer {
	readonly group = new Group()
	readonly plup: PlupHandle
	private mood: NamedFace = "smug"
	private leaving = 0
	private bornAt = 0
	private hop = 0
	slot: number
	id: number

	constructor(slot: number, id: number) {
		this.slot = slot
		this.id = id
		this.plup = createPlup({ color: PALETTE[id % PALETTE.length] ?? "#3d7bff", face: "smug" })
		this.plup.object.scale.setScalar(PLUP_SCALE * 1.1)
		// Customers stand on a step behind the counter, so their faces clear its top.
		this.plup.object.position.y = 0.45
		const hat = hatFor(HATS[(id * 5 + slot) % HATS.length] ?? "none")
		if (hat) this.plup.bone("body")?.add(hat)
		this.group.add(this.plup.object)
		const x = COLUMN_X[slot] ?? 0
		this.group.position.set(x + (slot === 1 ? 0 : slot === 0 ? -8 : 8), 0, CUSTOMER_Z)
		this.enter(x)
	}

	private enter(x: number) {
		const from = this.group.position.x
		tween(0.9, (p) => {
			this.group.position.x = from + (x - from) * p
			this.group.position.y = Math.abs(Math.sin(p * Math.PI * 5)) * 0.3 * (1 - p)
		}, { easing: ease.outQuad })
	}

	/** Patience from 1 down to 0 sets the face: calm, worried, furious. */
	setPatience(patience: number) {
		if (this.leaving > 0) return
		const face: NamedFace = patience > 0.55 ? "smug" : patience > 0.22 ? "serious" : "rage"
		if (face !== this.mood) {
			this.mood = face
			this.plup.setFace(face)
		}
		// Shaking when nearly out of patience.
		this.group.rotation.z = patience < 0.22 ? Math.sin(this.bornAt * 40) * 0.08 : 0
	}

	/** Served: a happy jump, a sorak-style cheer, then out the way they came. */
	celebrate(onGone: () => void) {
		this.leaving = 1
		this.group.rotation.z = 0
		this.plup.emote("emote-suka")
		const baseY = this.group.position.y
		tween(0.7, (p) => (this.group.position.y = baseY + Math.sin(p * Math.PI * 2) * 0.5 * (1 - p)), { easing: ease.linear })
		const from = this.group.position.x
		const dir = this.slot === 2 ? 1 : -1
		tween(0.8, (p) => (this.group.position.x = from + dir * 9 * p * p), { delay: 0.9, easing: ease.linear, done: onGone })
	}

	/** Ran out of patience: a stomp, then a huff out of the door. */
	storm(onGone: () => void) {
		this.leaving = 1
		this.plup.setFace("rage")
		this.group.rotation.z = 0
		const from = this.group.position.x
		const dir = this.slot === 0 ? -1 : 1
		tween(0.9, (p) => {
			this.group.position.x = from + dir * 9 * p * p
			this.group.position.y = Math.abs(Math.sin(p * Math.PI * 7)) * 0.25
		}, { delay: 0.25, easing: ease.linear, done: onGone })
	}

	/** A shake of the head for a wrong plate. */
	refuse() {
		const base = this.group.position.x
		tween(0.4, (p) => (this.group.position.x = base + Math.sin(p * Math.PI * 6) * 0.12 * (1 - p)), { easing: ease.linear })
	}

	update(dt: number) {
		this.bornAt += dt
		this.hop += dt
		this.plup.update(dt)
	}

	dispose() {
		this.plup.dispose()
	}
}

export const headOf = (group: Group, extra = 2.2) => new Vector3().setFromMatrixPosition(group.matrixWorld).add(new Vector3(0, extra, 0))
