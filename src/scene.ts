import {
	AmbientLight,
	BoxGeometry,
	type CanvasTexture,
	CircleGeometry,
	Color,
	ConeGeometry,
	CylinderGeometry,
	DirectionalLight,
	DoubleSide,
	Fog,
	Group,
	HemisphereLight,
	Mesh,
	MeshBasicMaterial,
	type Object3D,
	PCFSoftShadowMap,
	PerspectiveCamera,
	PlaneGeometry,
	PointLight,
	Raycaster,
	RingGeometry,
	Scene,
	SphereGeometry,
	SRGBColorSpace,
	TorusGeometry,
	Vector2,
	Vector3,
	WebGLRenderer,
} from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { Emitter, shakeOffset } from "./fx"
import type { StationId, Target } from "./game"
import { QUALITY, type Quality } from "./settings"
import { canvasTexture, outlined, toon } from "./toon"

/**
 * World layout, in metres. From the camera: the prep table (stations on its far half, plates on its
 * near edge), the cooks on a duckboard behind it facing the camera, the counter, the customers.
 * Cooks face the camera while they work the table in front of them and turn round to hand a plate to
 * a customer, so a cook's face is always readable.
 */
export const TABLE_Z = 1.55
export const STATION_Z = TABLE_Z - 0.2
export const COOK_Z = -0.2
export const COOK_Y = 0.78
export const COUNTER_Z = -1.9
export const CUSTOMER_Z = -3.05
export const PLATE_Z = TABLE_Z + 0.58
const WALL_Z = -5.1
const TABLE_TOP = 0.98
const COUNTER_TOP = 1.12

const BASE_STATIONS: Record<StationId, number> = { nasi: -3.7, kerupuk: -1.25, wajan: 1.25, sambal: 3.7 }
const BASE_COLUMNS = [-2.7, 0, 2.7]
/** Mutable on purpose: a narrow screen pulls the stalls and the customers closer together. */
export const STATION_X: Record<StationId, number> = { ...BASE_STATIONS }
export const COLUMN_X: number[] = [...BASE_COLUMNS]

const wood = (base: string, dark: string, light: string, repeat: [number, number]) =>
	canvasTexture(
		256,
		256,
		(ctx) => {
			ctx.fillStyle = base
			ctx.fillRect(0, 0, 256, 256)
			for (let row = 0; row < 4; row += 1) {
				const y = row * 64
				ctx.fillStyle = row % 2 ? light : base
				ctx.fillRect(0, y, 256, 64)
				ctx.fillStyle = dark
				ctx.fillRect(0, y, 256, 3)
				ctx.globalAlpha = 0.18
				for (let grain = 0; grain < 9; grain += 1) ctx.fillRect(Math.random() * 256, y + 6 + Math.random() * 50, 30 + Math.random() * 80, 2)
				ctx.globalAlpha = 1
				ctx.fillRect(((row * 97) % 200) + 20, y, 3, 64)
				// nail heads
				ctx.fillStyle = "#4a2f17"
				ctx.fillRect(((row * 97) % 200) + 24, y + 8, 3, 3)
				ctx.fillRect(((row * 97) % 200) + 24, y + 52, 3, 3)
			}
		},
		{ repeat, pixel: true },
	)

const bamboo = canvasTexture(
	128,
	128,
	(ctx) => {
		ctx.fillStyle = "#d9b25c"
		ctx.fillRect(0, 0, 128, 128)
		for (let column = 0; column < 8; column += 1) {
			ctx.fillStyle = column % 2 ? "#e3c06f" : "#caa24f"
			ctx.fillRect(column * 16, 0, 15, 128)
			ctx.fillStyle = "#a47f35"
			ctx.fillRect(column * 16 + 15, 0, 1, 128)
			for (let node = 0; node < 3; node += 1) ctx.fillRect(column * 16, ((node * 47 + column * 19) % 120) + 4, 15, 3)
		}
	},
	{ repeat: [4, 1.5], pixel: true },
)

const stripes = (a: string, b: string, count = 8) =>
	canvasTexture(
		256,
		64,
		(ctx) => {
			for (let i = 0; i < count; i += 1) {
				ctx.fillStyle = i % 2 ? b : a
				ctx.fillRect((i * 256) / count, 0, 256 / count + 1, 64)
			}
		},
		{ pixel: true },
	)

function sky(): CanvasTexture {
	return canvasTexture(512, 256, (ctx) => {
		const gradient = ctx.createLinearGradient(0, 0, 0, 256)
		gradient.addColorStop(0, "#5cb8ff")
		gradient.addColorStop(0.6, "#ffe2a6")
		gradient.addColorStop(1, "#ffc88a")
		ctx.fillStyle = gradient
		ctx.fillRect(0, 0, 512, 256)
		ctx.fillStyle = "rgba(255, 244, 200, 0.95)"
		ctx.beginPath()
		ctx.arc(380, 140, 30, 0, Math.PI * 2)
		ctx.fill()
		ctx.fillStyle = "rgba(255, 244, 200, 0.25)"
		ctx.beginPath()
		ctx.arc(380, 140, 58, 0, Math.PI * 2)
		ctx.fill()
		// A far mountain, then hills and terraced rice fields getting darker towards the front.
		ctx.fillStyle = "#8fb6d9"
		ctx.beginPath()
		ctx.moveTo(40, 190)
		ctx.lineTo(130, 120)
		ctx.lineTo(210, 190)
		ctx.fill()
		const layers: [string, number, number][] = [
			["#7fb98d", 180, 20],
			["#5da877", 198, 16],
			["#3f8f63", 220, 12],
		]
		for (const [color, base, amp] of layers) {
			ctx.fillStyle = color
			ctx.beginPath()
			ctx.moveTo(0, 256)
			for (let x = 0; x <= 512; x += 8) ctx.lineTo(x, base - Math.sin(x * 0.013 + base) * amp - Math.sin(x * 0.04) * 5)
			ctx.lineTo(512, 256)
			ctx.fill()
		}
		ctx.fillStyle = "rgba(255,255,255,0.18)"
		for (let i = 0; i < 6; i += 1) ctx.fillRect(40 + i * 80, 218 + (i % 2) * 8, 60, 3)
	})
}

function label(text: string, color: string, ink: string) {
	return canvasTexture(256, 96, (ctx) => {
		ctx.fillStyle = color
		ctx.fillRect(0, 0, 256, 96)
		ctx.fillStyle = ink
		ctx.fillRect(0, 0, 256, 8)
		ctx.fillRect(0, 88, 256, 8)
		ctx.font = "bold 52px ui-rounded, system-ui, sans-serif"
		ctx.textAlign = "center"
		ctx.textBaseline = "middle"
		ctx.fillText(text, 128, 50)
	})
}

function menuBoard() {
	return canvasTexture(256, 320, (ctx) => {
		ctx.fillStyle = "#2b3a34"
		ctx.fillRect(0, 0, 256, 320)
		ctx.strokeStyle = "#8a5a2e"
		ctx.lineWidth = 14
		ctx.strokeRect(7, 7, 242, 306)
		ctx.fillStyle = "#fff7e8"
		ctx.textAlign = "center"
		ctx.font = "bold 34px ui-rounded, system-ui, sans-serif"
		ctx.fillText("MENU", 128, 52)
		ctx.font = "bold 22px ui-rounded, system-ui, sans-serif"
		ctx.textAlign = "left"
		const lines: [string, string][] = [["Nasi Sambal", "8"], ["Nasi Tempe", "10"], ["Tempe Sambal", "10"], ["Nasi Kerupuk", "8"], ["Komplit", "16"], ["Pesta Kampung", "34"]]
		lines.forEach(([name, price], index) => {
			ctx.fillStyle = index % 2 ? "#ffd966" : "#fff7e8"
			ctx.fillText(name, 26, 98 + index * 34)
			ctx.textAlign = "right"
			ctx.fillText(price, 232, 98 + index * 34)
			ctx.textAlign = "left"
		})
	})
}

function clockFace() {
	return canvasTexture(128, 128, (ctx) => {
		ctx.fillStyle = "#fff8ea"
		ctx.beginPath()
		ctx.arc(64, 64, 60, 0, Math.PI * 2)
		ctx.fill()
		ctx.strokeStyle = "#1a1233"
		ctx.lineWidth = 6
		ctx.stroke()
		ctx.fillStyle = "#1a1233"
		for (let i = 0; i < 12; i += 1) {
			const a = (i / 12) * Math.PI * 2
			ctx.fillRect(64 + Math.sin(a) * 48 - 2, 64 - Math.cos(a) * 48 - 2, 4, 4)
		}
	})
}

export interface Station {
	group: Group
	top: Vector3
}

export class World {
	readonly scene = new Scene()
	readonly camera = new PerspectiveCamera(36, 1, 0.1, 90)
	readonly renderer: WebGLRenderer
	readonly stations = {} as Record<StationId, Station>
	readonly hits: Object3D[] = []
	private readonly raycaster = new Raycaster()
	private readonly look = new Vector3(0, 1.15, -0.5)
	private readonly steam: Emitter
	private readonly sparks: Emitter
	private readonly puffs: Emitter
	private readonly motes: Emitter
	private readonly confetti: Emitter[]
	private readonly fire: Mesh[] = []
	private readonly bubbles: Mesh[] = []
	private readonly lights: Mesh[] = []
	private readonly clouds: Object3D[] = []
	private readonly lamps: Group[] = []
	private readonly flags: Mesh[] = []
	private readonly clockHands: Mesh[] = []
	readonly wokFood: Group
	private readonly sun: DirectionalLight
	private readonly marker: Group
	private markerTarget: Vector3 | null = null
	private time = 0
	private zoom = 12
	private aspect = 1
	private quality: Quality = "tinggi"
	/** Things as wide as the room: they stretch with the spread. */
	private readonly wide: Object3D[] = []
	private readonly customerHits: Object3D[] = []
	/** Slow camera drift for the title screen; 0 while playing. */
	drift = 0

	constructor(canvas: HTMLCanvasElement) {
		this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" })
		this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
		this.renderer.shadowMap.enabled = true
		this.renderer.shadowMap.type = PCFSoftShadowMap
		this.renderer.outputColorSpace = SRGBColorSpace
		this.scene.background = new Color("#ffd9a0")
		this.scene.fog = new Fog("#ffd9a0", 28, 64)

		this.sun = this.addLights()
		this.addRoom()
		this.addCounter()
		this.addTable()
		this.stations.nasi = this.addRice()
		this.stations.kerupuk = this.addKerupuk()
		this.wokFood = new Group()
		this.stations.wajan = this.addWok()
		this.stations.sambal = this.addSambal()
		this.addCustomerHits()
		this.addScenery()
		this.addShelves()
		this.marker = this.addMarker()

		this.steam = new Emitter(this.scene, "dot", 0xffffff, 0.5, { capacity: 160 })
		this.sparks = new Emitter(this.scene, "star", 0xffe066, 0.38, { additive: true, capacity: 160 })
		this.puffs = new Emitter(this.scene, "dot", 0xffa24a, 0.55, { additive: true, capacity: 120 })
		this.motes = new Emitter(this.scene, "dot", 0xfff0b0, 0.16, { additive: true, capacity: 60 })
		this.confetti = ["#ff6f91", "#4cc9e2", "#ffd24d", "#7bd389", "#c39bff"].map(
			(color) => new Emitter(this.scene, "square", new Color(color).getHex(), 0.3, { capacity: 70 }),
		)
	}

	private addLights(): DirectionalLight {
		this.scene.add(new AmbientLight(0xfff2dc, 0.6))
		this.scene.add(new HemisphereLight(0xfff1d6, 0x7a5a9a, 0.9))
		const sun = new DirectionalLight(0xfff0cf, 2.2)
		sun.position.set(-6, 11, 7)
		sun.castShadow = true
		sun.shadow.mapSize.set(2048, 2048)
		sun.shadow.camera.left = -10
		sun.shadow.camera.right = 10
		sun.shadow.camera.top = 8
		sun.shadow.camera.bottom = -8
		sun.shadow.bias = -0.0004
		sun.shadow.radius = 4
		this.scene.add(sun)
		const rim = new DirectionalLight(0xb9a6ff, 0.7)
		rim.position.set(7, 4, -3)
		this.scene.add(rim)
		const glow = new PointLight(0xffb15c, 14, 10, 1.8)
		glow.position.set(0, 3.2, -1.8)
		this.scene.add(glow)
		const fill = new PointLight(0xffd9a0, 5, 9, 2)
		fill.position.set(0, 2.4, 2.6)
		this.scene.add(fill)
		return sun
	}

	private add<T extends Object3D>(object: T, shadow = true): T {
		object.traverse((child) => {
			if (child instanceof Mesh && child.castShadow !== false) {
				child.castShadow = shadow
				child.receiveShadow = true
			}
		})
		this.scene.add(object)
		return object
	}

	private addRoom() {
		const floor = new Mesh(new PlaneGeometry(44, 32), toon("#ffffff", { map: wood("#b9824a", "#7a4d27", "#c78f55", [11, 8]) }))
		floor.rotation.x = -Math.PI / 2
		floor.receiveShadow = true
		this.scene.add(floor)
		// A duckboard for the cooks, with a woven runner on it.
		const board = outlined(new Mesh(new RoundedBoxGeometry(11, COOK_Y, 2.2, 2, 0.04), toon("#ffffff", { map: wood("#d0975a", "#80502a", "#dca565", [4, 1]) })), 0.03)
		board.position.set(0, COOK_Y / 2, COOK_Z)
		this.add(board)
		const runner = new Mesh(new BoxGeometry(10.4, 0.02, 1.4), toon("#ffffff", { map: stripes("#e0603d", "#fff3dc", 26) }))
		runner.position.set(0, COOK_Y + 0.012, COOK_Z + 0.1)
		this.scene.add(runner)
		this.wide.push(board, runner)

		const wallMaterial = toon("#ffffff", { map: bamboo })
		const wall = (width: number, height: number, x: number, y: number) => {
			const piece = new Mesh(new BoxGeometry(width, height, 0.3), wallMaterial)
			piece.position.set(x, y, WALL_Z)
			piece.receiveShadow = true
			piece.castShadow = true
			this.scene.add(piece)
		}
		wall(5.6, 5.4, -5.5, 2.7)
		wall(5.6, 5.4, 5.5, 2.7)
		wall(5.4, 1.7, 0, 0.85)
		wall(5.4, 1.5, 0, 4.65)
		const bar = (w: number, h: number, x: number, y: number) => {
			const piece = outlined(new Mesh(new RoundedBoxGeometry(w, h, 0.22, 2, 0.04), toon("#8a5a2e")), 0.02)
			piece.position.set(x, y, WALL_Z + 0.2)
			this.scene.add(piece)
		}
		bar(5.7, 0.16, 0, 3.9)
		bar(5.7, 0.16, 0, 1.7)
		bar(0.16, 2.3, -2.8, 2.8)
		bar(0.16, 2.3, 2.8, 2.8)
		bar(0.1, 2.3, 0, 2.8)
		const backdrop = new Mesh(new PlaneGeometry(36, 14), new MeshBasicMaterial({ map: sky(), fog: false }))
		backdrop.position.set(0, 4.4, -14)
		this.scene.add(backdrop)
	}

	private addCounter() {
		const body = outlined(new Mesh(new RoundedBoxGeometry(9.6, 1.1, 1.3, 3, 0.08), toon("#ffffff", { map: wood("#a86b3a", "#6a3f1d", "#b87a45", [3, 1]) })), 0.03)
		body.position.set(0, 0.55, COUNTER_Z)
		const top = outlined(new Mesh(new RoundedBoxGeometry(10, 0.1, 1.5, 3, 0.04), toon("#c98c4f")), 0.03)
		top.position.set(0, COUNTER_TOP, COUNTER_Z)
		const trim = new Mesh(new BoxGeometry(9.7, 0.18, 0.04), toon("#ffffff", { map: stripes("#d8432f", "#fff3dc", 26) }))
		trim.position.set(0, 0.9, COUNTER_Z + 0.67)
		this.add(body)
		this.add(top)
		this.add(trim, false)
		this.wide.push(body, top, trim)

		// The till, a bell, the tip jar and a vase: things a real counter has.
		const till = outlined(new Mesh(new RoundedBoxGeometry(0.7, 0.34, 0.5, 2, 0.05), toon("#4a6a8a")), 0.02)
		till.position.set(4.2, COUNTER_TOP + 0.22, COUNTER_Z + 0.2)
		const screen = new Mesh(new BoxGeometry(0.4, 0.16, 0.02), new MeshBasicMaterial({ color: 0x9be8c0 }))
		screen.position.set(0, 0.12, 0.26)
		screen.rotation.x = -0.4
		till.add(screen)
		const bell = outlined(new Mesh(new SphereGeometry(0.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon("#e0b43a")), 0.015)
		bell.position.set(-4.2, COUNTER_TOP + 0.05, COUNTER_Z + 0.3)
		const jar = outlined(new Mesh(new CylinderGeometry(0.2, 0.2, 0.36, 14), toon("#bfe8ff", { transparent: true, opacity: 0.7 })), 0.012)
		jar.position.set(3.4, COUNTER_TOP + 0.23, COUNTER_Z + 0.35)
		for (let i = 0; i < 4; i += 1) {
			const coin = new Mesh(new CylinderGeometry(0.07, 0.07, 0.02, 10), toon("#ffc94d"))
			coin.position.set(3.4 + (i - 1.5) * 0.06, COUNTER_TOP + 0.08 + i * 0.03, COUNTER_Z + 0.35)
			this.scene.add(coin)
		}
		const vase = outlined(new Mesh(new CylinderGeometry(0.09, 0.14, 0.3, 10), toon("#e0603d")), 0.012)
		vase.position.set(-3.5, COUNTER_TOP + 0.2, COUNTER_Z + 0.4)
		this.add(till)
		this.add(bell)
		this.add(jar)
		this.add(vase)
		for (let i = 0; i < 5; i += 1) {
			const stem = new Mesh(new CylinderGeometry(0.01, 0.01, 0.3, 4), toon("#3fae74"))
			stem.position.set(-3.5 + (i - 2) * 0.04, COUNTER_TOP + 0.5, COUNTER_Z + 0.4)
			stem.rotation.z = (i - 2) * 0.12
			const bloom = outlined(new Mesh(new SphereGeometry(0.06, 8, 6), toon(["#ff7fb0", "#ffd24d", "#ff8a4c", "#c39bff", "#ff6f91"][i] ?? "#ff7fb0")), 0.01)
			bloom.position.set(-3.5 + (i - 2) * 0.08, COUNTER_TOP + 0.66, COUNTER_Z + 0.4)
			this.scene.add(stem, bloom)
		}
	}

	private addTable() {
		const top = outlined(new Mesh(new RoundedBoxGeometry(10.2, 0.2, 2, 3, 0.06), toon("#ffffff", { map: wood("#c98c4f", "#7a4d27", "#d99c5d", [3, 1]) })), 0.03)
		top.position.set(0, TABLE_TOP - 0.1, TABLE_Z)
		const cloth = new Mesh(new BoxGeometry(9.9, 0.025, 1.2), toon("#ffffff", { map: stripes("#ff8a4c", "#fff3dc", 30) }))
		cloth.position.set(0, TABLE_TOP + 0.005, TABLE_Z + 0.35)
		this.add(top)
		this.add(cloth, false)
		this.wide.push(top, cloth)
		for (const x of [-4.8, 4.8]) {
			const leg = outlined(new Mesh(new BoxGeometry(0.3, TABLE_TOP - 0.2, 0.3), toon("#8a5a2e")), 0.02)
			leg.position.set(x, (TABLE_TOP - 0.2) / 2, TABLE_Z + 0.7)
			this.add(leg)
		}
		// A soft contact shadow under each station.
		for (const x of Object.values(BASE_STATIONS)) {
			const blob = new Mesh(new CircleGeometry(0.85, 20), new MeshBasicMaterial({ color: 0x2b1d12, transparent: true, opacity: 0.22, depthWrite: false }))
			blob.rotation.x = -Math.PI / 2
			blob.position.set(x, TABLE_TOP + 0.012, STATION_Z)
			blob.userData.station = x
			this.scene.add(blob)
		}
	}

	private station(id: StationId, text: string, color: string): Station {
		const group = new Group()
		group.position.set(BASE_STATIONS[id], TABLE_TOP, STATION_Z)
		const card = outlined(new Mesh(new RoundedBoxGeometry(1.05, 0.34, 0.06, 2, 0.02), toon("#ffffff", { map: label(text, color, "#2b1d12") })), 0.02)
		card.position.set(0, 0.16, 0.95)
		card.rotation.x = -0.85
		group.add(card)
		const hit = new Mesh(new BoxGeometry(1.9, 1.1, 1.7), new MeshBasicMaterial({ visible: false }))
		hit.position.set(0, 0.55, 0.15)
		hit.userData = { target: { station: id } satisfies Target }
		group.add(hit)
		this.hits.push(hit)
		this.add(group)
		return { group, top: new Vector3(BASE_STATIONS[id], TABLE_TOP, STATION_Z) }
	}

	private addRice(): Station {
		const station = this.station("nasi", "NASI", "#fff3dc")
		const basket = outlined(
			new Mesh(
				new CylinderGeometry(0.64, 0.5, 0.55, 22),
				toon("#ffffff", {
					map: canvasTexture(128, 64, (ctx) => {
						ctx.fillStyle = "#c9944e"
						ctx.fillRect(0, 0, 128, 64)
						for (let i = 0; i < 16; i += 1) {
							ctx.fillStyle = i % 2 ? "#e0ad66" : "#a97633"
							ctx.fillRect(i * 8, 0, 4, 64)
						}
						for (let y = 0; y < 64; y += 10) {
							ctx.fillStyle = "#8a5a2e"
							ctx.fillRect(0, y, 128, 2)
						}
					}, { pixel: true }),
				}),
			),
			0.025,
		)
		basket.position.y = 0.28
		const rice = outlined(new Mesh(new SphereGeometry(0.6, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2), toon("#fffaf0")), 0.02)
		rice.scale.set(1, 0.55, 1)
		rice.position.y = 0.55
		const ladle = outlined(new Mesh(new CylinderGeometry(0.03, 0.03, 0.7, 6), toon("#a97633")), 0.01)
		ladle.position.set(0.5, 0.8, 0.05)
		ladle.rotation.z = -0.9
		station.group.add(basket, rice, ladle)
		for (let i = 0; i < 26; i += 1) {
			const grain = new Mesh(new SphereGeometry(0.02, 5, 4), toon("#e8dfc8"))
			const angle = Math.random() * Math.PI * 2
			const radius = Math.random() * 0.5
			grain.position.set(Math.cos(angle) * radius, 0.55 + Math.sqrt(Math.max(0, 0.36 - radius * radius)) * 0.55 * 0.9, Math.sin(angle) * radius)
			station.group.add(grain)
		}
		return station
	}

	private addKerupuk(): Station {
		const station = this.station("kerupuk", "KERUPUK", "#ffd24d")
		const jar = outlined(new Mesh(new CylinderGeometry(0.46, 0.46, 0.9, 20), toon("#bfe8ff", { transparent: true, opacity: 0.55 })), 0.02)
		jar.position.y = 0.45
		station.group.add(jar)
		// Crackers stacked inside: pale discs with a golden edge.
		for (let i = 0; i < 9; i += 1) {
			const cracker = new Mesh(new CylinderGeometry(0.34, 0.34, 0.03, 16), toon(i % 3 === 0 ? "#f2c35a" : "#f9e3a8"))
			cracker.position.set((i % 3 - 1) * 0.05, 0.1 + i * 0.085, (i % 2 - 0.5) * 0.06)
			cracker.rotation.set((i % 4) * 0.04, i, (i % 3) * 0.03)
			station.group.add(cracker)
		}
		const lid = outlined(new Mesh(new CylinderGeometry(0.5, 0.5, 0.1, 20), toon("#e0603d")), 0.02)
		lid.position.set(0.18, 1.02, 0.1)
		lid.rotation.z = 0.35
		const knob = new Mesh(new SphereGeometry(0.07, 8, 6), toon("#ffd24d"))
		knob.position.set(0.2, 1.1, 0.1)
		station.group.add(lid, knob)
		return station
	}

	private addWok(): Station {
		const station = this.station("wajan", "WAJAN", "#ffd24d")
		const stove = outlined(new Mesh(new CylinderGeometry(0.66, 0.74, 0.3, 20), toon("#9c3b2e")), 0.03)
		stove.position.y = 0.15
		const wok = outlined(new Mesh(new SphereGeometry(0.8, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon("#3a3a46", { side: DoubleSide })), 0.02)
		wok.scale.set(1, 0.42, 1)
		wok.position.y = 0.62
		const rim = outlined(new Mesh(new TorusGeometry(0.8, 0.035, 8, 28), toon("#555566")), 0.01)
		rim.rotation.x = Math.PI / 2
		rim.position.y = 0.62
		const oil = new Mesh(new CircleGeometry(0.66, 24), new MeshBasicMaterial({ color: 0xffc94d }))
		oil.rotation.x = -Math.PI / 2
		oil.position.y = 0.5
		for (const side of [-1, 1]) {
			const handle = outlined(new Mesh(new CylinderGeometry(0.04, 0.04, 0.55, 8), toon("#6a3f1d")), 0.015)
			handle.rotation.z = Math.PI / 2
			handle.position.set(side * 1.02, 0.66, 0)
			station.group.add(handle)
		}
		station.group.add(stove, wok, rim, oil)
		this.wokFood.position.set(0, 0.56, 0)
		station.group.add(this.wokFood)
		for (let i = 0; i < 7; i += 1) {
			const flame = new Mesh(new ConeGeometry(0.09, 0.3, 6), new MeshBasicMaterial({ color: i % 2 ? 0xff7a2a : 0xffc23a }))
			const angle = (i / 7) * Math.PI * 2
			flame.position.set(Math.cos(angle) * 0.5, 0.3, Math.sin(angle) * 0.5)
			station.group.add(flame)
			this.fire.push(flame)
		}
		// Oil bubbles that pop on the surface.
		for (let i = 0; i < 6; i += 1) {
			const bubble = new Mesh(new SphereGeometry(0.035, 8, 6), new MeshBasicMaterial({ color: 0xfff1b0 }))
			bubble.userData.seed = i * 1.7
			station.group.add(bubble)
			this.bubbles.push(bubble)
		}
		return station
	}

	private addSambal(): Station {
		const station = this.station("sambal", "SAMBAL", "#ff8a76")
		const bowl = outlined(new Mesh(new CylinderGeometry(0.66, 0.5, 0.34, 22), toon("#8a8f9c")), 0.025)
		bowl.position.y = 0.17
		const sambal = outlined(new Mesh(new SphereGeometry(0.52, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon("#d8301f")), 0.02)
		sambal.scale.set(1, 0.5, 1)
		sambal.position.y = 0.32
		const pestle = outlined(new Mesh(new CylinderGeometry(0.07, 0.11, 0.9, 10), toon("#6f7480")), 0.02)
		pestle.position.set(-0.2, 0.7, 0.1)
		pestle.rotation.z = 0.5
		station.group.add(bowl, sambal, pestle)
		for (const [x, z, rot] of [[0.85, 0.35, 0.3], [0.7, 0.55, -0.4], [-0.85, 0.4, 0.8]] as const) {
			const chili = outlined(new Mesh(new ConeGeometry(0.055, 0.3, 8), toon(x > 0 ? "#e83a1c" : "#3fae74")), 0.012)
			chili.position.set(x, 0.06, z)
			chili.rotation.z = Math.PI / 2 + rot
			station.group.add(chili)
		}
		return station
	}

	private addCustomerHits() {
		BASE_COLUMNS.forEach((x, index) => {
			const hit = new Mesh(new BoxGeometry(2.3, 3, 1.6), new MeshBasicMaterial({ visible: false }))
			hit.position.set(x, 1.7, CUSTOMER_Z)
			hit.userData = { target: { customer: index } satisfies Target }
			this.scene.add(hit)
			this.hits.push(hit)
			this.customerHits.push(hit)
		})
	}

	private addShelves() {
		// Two shelves on the back wall with jars, bowls and baskets, a chalk menu, a clock.
		for (const [y, items] of [[3.0, ["#e0603d", "#4cc9e2", "#ffd24d", "#7bd389", "#c39bff"]], [2.35, ["#ff8a4c", "#fff3dc", "#ff6f91", "#3d7bff"]]] as const) {
			const plank = outlined(new Mesh(new RoundedBoxGeometry(4.2, 0.1, 0.5, 2, 0.03), toon("#8a5a2e")), 0.02)
			plank.position.set(-6.4, y, WALL_Z + 0.4)
			this.add(plank)
			plank.position.x = -6.2
			items.forEach((color, index) => {
				const jar = outlined(new Mesh(new CylinderGeometry(0.17, 0.17, 0.34, 12), toon(color)), 0.015)
				jar.position.set(-7.8 + index * 0.75, y + 0.22, WALL_Z + 0.4)
				const lid = new Mesh(new CylinderGeometry(0.18, 0.18, 0.06, 12), toon("#fff3dc"))
				lid.position.set(-7.8 + index * 0.75, y + 0.42, WALL_Z + 0.4)
				this.add(jar)
				this.scene.add(lid)
			})
		}
		const board = outlined(new Mesh(new RoundedBoxGeometry(1.5, 1.9, 0.08, 2, 0.03), toon("#ffffff", { map: menuBoard() })), 0.02)
		board.position.set(6.3, 2.9, WALL_Z + 0.3)
		this.add(board)
		const clock = new Mesh(new CircleGeometry(0.5, 24), new MeshBasicMaterial({ map: clockFace() }))
		clock.position.set(0, 4.55, WALL_Z + 0.24)
		this.scene.add(clock)
		for (const [length, width] of [[0.3, 0.04], [0.4, 0.025]] as const) {
			const hand = new Mesh(new BoxGeometry(width, length, 0.01), new MeshBasicMaterial({ color: 0x1a1233 }))
			hand.geometry.translate(0, length / 2, 0)
			hand.position.set(0, 4.55, WALL_Z + 0.26)
			this.scene.add(hand)
			this.clockHands.push(hand)
		}
		// Strings of chilli and garlic hanging from the awning beam.
		for (const [x, color] of [[-4.5, 0xe83a1c], [4.6, 0xfff3dc], [-5.1, 0xe83a1c]] as const) {
			const cord = new Mesh(new CylinderGeometry(0.01, 0.01, 0.9, 4), toon("#6a3f1d"))
			cord.position.set(x, 3.4, WALL_Z + 0.6)
			this.scene.add(cord)
			for (let i = 0; i < 5; i += 1) {
				const bulb = new Mesh(color === 0xe83a1c ? new ConeGeometry(0.07, 0.22, 6) : new SphereGeometry(0.09, 8, 6), toon(color))
				bulb.position.set(x + (i % 2 ? 0.07 : -0.07), 3.75 - i * 0.18, WALL_Z + 0.6)
				bulb.rotation.z = Math.PI
				this.scene.add(bulb)
			}
		}
	}

	private addScenery() {
		// The awning over the counter: striped cloth, a scalloped edge, lamps, string lights, bunting.
		const cloth = new Mesh(new BoxGeometry(11.8, 0.1, 3.6), toon("#ffffff", { map: stripes("#e0402e", "#fff3dc", 14) }))
		cloth.position.set(0, 4.15, -3.4)
		cloth.rotation.x = 0.1
		this.add(cloth)
		this.wide.push(cloth)
		for (let i = 0; i < 15; i += 1) {
			const scallop = outlined(new Mesh(new CylinderGeometry(0.4, 0.4, 0.1, 14, 1, false, 0, Math.PI), toon(i % 2 ? "#fff3dc" : "#e0402e")), 0.015)
			scallop.rotation.set(Math.PI / 2, 0, Math.PI / 2)
			scallop.position.set(-5.6 + i * 0.8, 3.9, -1.7)
			this.scene.add(scallop)
		}
		for (const x of [-3.8, 0, 3.8]) {
			const lamp = new Group()
			const cord = new Mesh(new CylinderGeometry(0.012, 0.012, 0.6, 4), toon("#2b1d12"))
			cord.position.y = 0.3
			const bulb = outlined(new Mesh(new SphereGeometry(0.2, 14, 10), new MeshBasicMaterial({ color: 0xffb35c })), 0.025)
			lamp.add(cord, bulb)
			lamp.position.set(x, 3.2, -2.0)
			this.scene.add(lamp)
			this.lamps.push(lamp)
		}
		for (let i = 0; i < 14; i += 1) {
			const bulb = new Mesh(new SphereGeometry(0.06, 6, 5), new MeshBasicMaterial({ color: i % 2 ? 0xffe066 : 0xff8a76 }))
			bulb.position.set(-6 + i * 0.93, 3.78 - Math.sin(i * 0.5) * 0.07, -1.65)
			this.scene.add(bulb)
			this.lights.push(bulb)
		}
		// Bunting across the front of the table.
		for (let i = 0; i < 16; i += 1) {
			const flag = new Mesh(new ConeGeometry(0.17, 0.34, 3), toon(["#ff6f91", "#4cc9e2", "#ffd24d", "#7bd389", "#c39bff"][i % 5] ?? "#ff6f91"))
			flag.rotation.set(0, 0, Math.PI)
			flag.position.set(-6.2 + i * 0.83, 3.6 - Math.sin((i / 15) * Math.PI) * -0.15, 3.4)
			this.scene.add(flag)
			this.flags.push(flag)
		}
		for (const [x, z, h] of [[-9, -10, 5], [8, -9, 6.4], [-4.5, -11, 4.2], [12, -11, 4.8], [-13, -10, 5.6]] as const) {
			const trunk = outlined(new Mesh(new CylinderGeometry(0.14, 0.2, h, 8), toon("#9b6a3c")), 0.02)
			trunk.position.set(x, h / 2, z)
			trunk.rotation.z = x > 0 ? -0.1 : 0.1
			this.scene.add(trunk)
			for (let leaf = 0; leaf < 6; leaf += 1) {
				const blade = outlined(new Mesh(new ConeGeometry(0.28, 2.2, 5), toon(leaf % 2 ? "#3fae74" : "#2f9a64")), 0.02)
				const angle = (leaf / 6) * Math.PI * 2
				blade.position.set(x + Math.cos(angle) * 0.9, h + 0.1, z + Math.sin(angle) * 0.9)
				blade.rotation.set(Math.sin(angle) * 1.25, 0, -Math.cos(angle) * 1.25)
				this.scene.add(blade)
			}
		}
		for (let i = 0; i < 5; i += 1) {
			const cloud = new Group()
			for (let puff = 0; puff < 4; puff += 1) {
				const blob = new Mesh(new SphereGeometry(0.8 + (puff % 2) * 0.3, 12, 8), new MeshBasicMaterial({ color: 0xffffff, fog: false }))
				blob.position.set(puff * 0.9 - 1.3, (puff % 2) * 0.2, 0)
				cloud.add(blob)
			}
			cloud.position.set(-16 + i * 8, 6.5 + (i % 3), -13)
			this.scene.add(cloud)
			this.clouds.push(cloud)
		}
	}

	/** The pointer the tutorial uses: a pulsing ring on the floor plane and a bobbing arrow. */
	private addMarker(): Group {
		const group = new Group()
		const ring = new Mesh(new RingGeometry(0.75, 0.95, 32), new MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, side: DoubleSide, depthWrite: false }))
		ring.rotation.x = -Math.PI / 2
		const arrow = new Mesh(new ConeGeometry(0.22, 0.45, 4), new MeshBasicMaterial({ color: 0xffe066 }))
		arrow.rotation.x = Math.PI
		arrow.position.y = 1.0
		arrow.name = "arrow"
		ring.name = "ring"
		group.add(ring, arrow)
		group.visible = false
		this.scene.add(group)
		return group
	}

	// ---- public ----
	resize(width: number, height: number) {
		this.renderer.setSize(width, height, false)
		this.aspect = width / Math.max(1, height)
		this.camera.aspect = this.aspect
		// Narrow screens: pull the stalls and the customers in, so the scene fills the width.
		const spread = Math.min(1, Math.max(0.5, (this.aspect - 0.35) / 0.95))
		this.setSpread(spread)
		const fov = this.camera.fov
		const need = 15.2 * spread + (spread < 1 ? 1.1 : 0)
		const distance = Math.max(spread < 1 ? 9.5 : 16.5, need / (2 * Math.tan((fov * Math.PI) / 360) * this.aspect))
		this.zoom = distance
		this.look.y = 1.15 + (spread < 1 ? 0.9 : 0)
		this.camera.updateProjectionMatrix()
	}

	setQuality(quality: Quality) {
		this.quality = quality
		const level = QUALITY[quality]
		this.renderer.setPixelRatio(Math.min(level.pixelRatio, window.devicePixelRatio || 1))
		this.renderer.shadowMap.enabled = level.shadows
		this.sun.castShadow = level.shadows
		this.scene.traverse((object) => {
			const material = (object as Mesh).material
			if (material && !Array.isArray(material)) material.needsUpdate = true
		})
	}

	private setSpread(spread: number) {
		for (const id of Object.keys(BASE_STATIONS) as StationId[]) {
			const x = BASE_STATIONS[id] * spread
			STATION_X[id] = x
			this.stations[id].group.position.x = x
			this.stations[id].top.x = x
		}
		this.scene.children.forEach((child) => {
			if (child.userData.station !== undefined) child.position.x = (child.userData.station as number) * spread
		})
		BASE_COLUMNS.forEach((base, index) => {
			const x = base * spread
			COLUMN_X[index] = x
			const hit = this.customerHits[index]
			if (hit) hit.position.x = x
		})
		for (const piece of this.wide) piece.scale.x = Math.max(0.56, spread * 1.04)
	}

	/** Which station, customer or cook a screen point touches. */
	pick(clientX: number, clientY: number, bounds: DOMRect, extra: Object3D[] = []): Target | null {
		const pointer = new Vector2(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1)
		this.raycaster.setFromCamera(pointer, this.camera)
		const found = this.raycaster.intersectObjects([...extra, ...this.hits], true)[0]
		const hit = found?.object
		let object: Object3D | null = hit ?? null
		while (object && !object.userData.target) object = object.parent
		return (object?.userData.target as Target | undefined) ?? null
	}

	/** A world point as a pixel position inside the canvas, or null when it is behind the camera. */
	project(point: Vector3, bounds: { width: number; height: number }): { x: number; y: number } | null {
		const v = point.clone().project(this.camera)
		if (v.z > 1) return null
		return { x: ((v.x + 1) / 2) * bounds.width, y: ((1 - v.y) / 2) * bounds.height }
	}

	/** Points the tutorial marker at a station or a customer's place; null hides it. */
	mark(target: Target | null) {
		if (!target || "cook" in target) {
			this.markerTarget = null
			this.marker.visible = false
			return
		}
		this.markerTarget = "station" in target ? new Vector3(STATION_X[target.station], TABLE_TOP + 0.02, STATION_Z) : new Vector3(COLUMN_X[target.customer] ?? 0, COUNTER_TOP + 0.02, COUNTER_Z)
		this.marker.visible = true
	}

	/** Fills the wok: what is frying, from raw to golden. */
	setFrying(progress: number | null, ready: boolean) {
		this.wokFood.clear()
		if (progress === null) return
		const piece = outlined(new Mesh(new RoundedBoxGeometry(0.5, 0.12, 0.34, 2, 0.04), toon(ready ? "#e8a43a" : "#e8d3a0")), 0.015)
		piece.rotation.y = this.time * 0.5
		piece.position.y = 0.02 + Math.sin(this.time * 7) * 0.012
		this.wokFood.add(piece)
	}

	private share(count: number) {
		return Math.max(1, Math.round(count * QUALITY[this.quality].particles))
	}
	sparkle(at: Vector3, count = 14) {
		this.sparks.emit(at, this.share(count), { speed: 2.6, up: 1.2, life: 0.7, gravity: 3 })
	}
	steamAt(at: Vector3, count = 2) {
		this.steam.emit(at, this.share(count), { speed: 0.35, up: 1.1, spread: 0.3, life: 1.3, gravity: -0.4, drag: 0.2 })
	}
	puff(at: Vector3, count = 10) {
		this.puffs.emit(at, this.share(count), { speed: 1.8, up: 0.8, life: 0.5, gravity: 1 })
	}
	burst(at: Vector3) {
		for (const emitter of this.confetti) emitter.emit(at, this.share(16), { speed: 5, up: 1.4, spread: 1.4, life: 1.6, gravity: 8, drag: 0.8 })
	}

	update(dt: number, shake = true) {
		this.time += dt
		const t = this.time
		for (const [index, flame] of this.fire.entries()) {
			const flicker = 0.75 + Math.sin(t * 14 + index * 2.1) * 0.25 + Math.sin(t * 23 + index) * 0.1
			flame.scale.set(1, flicker, 1)
			flame.position.y = 0.28 + flicker * 0.1
		}
		for (const bubble of this.bubbles) {
			const phase = ((t * 1.4 + (bubble.userData.seed as number)) % 1.6) / 1.6
			bubble.visible = this.fire.length > 0
			bubble.scale.setScalar(phase < 0.75 ? 0.4 + phase : Math.max(0.01, (1 - phase) * 6))
			bubble.position.set(Math.cos((bubble.userData.seed as number) * 2) * 0.4, 0.52, Math.sin((bubble.userData.seed as number) * 3) * 0.4)
		}
		for (const [index, bulb] of this.lights.entries()) bulb.scale.setScalar(0.85 + Math.sin(t * 3 + index * 1.3) * 0.2)
		for (const [index, lamp] of this.lamps.entries()) lamp.rotation.z = Math.sin(t * 1.3 + index) * 0.05
		for (const [index, flag] of this.flags.entries()) flag.rotation.x = Math.sin(t * 2.2 + index * 0.7) * 0.18
		for (const [index, cloud] of this.clouds.entries()) {
			cloud.position.x += dt * (0.25 + index * 0.04)
			if (cloud.position.x > 26) cloud.position.x = -26
		}
		const [minute, hour] = this.clockHands
		if (minute) minute.rotation.z = -(t * 0.4)
		if (hour) hour.rotation.z = -(t * 0.4) / 12
		this.steam.update(dt)
		this.sparks.update(dt)
		this.puffs.update(dt)
		this.motes.update(dt)
		for (const emitter of this.confetti) emitter.update(dt)
		if (Math.random() < dt * 5) this.steamAt(new Vector3(STATION_X.nasi, TABLE_TOP + 0.95, STATION_Z), 1)
		// Dust motes drifting in the sunlight from the window.
		if (Math.random() < dt * 6) this.motes.emit(new Vector3((Math.random() - 0.5) * 8, 1 + Math.random() * 2.5, -1 + Math.random() * 3), 1, { speed: 0.15, up: 0.3, spread: 0.4, life: 4, gravity: -0.02, drag: 0.1 })

		if (this.markerTarget && this.marker.visible) {
			this.marker.position.copy(this.markerTarget)
			const pulse = 1 + Math.sin(t * 6) * 0.12
			this.marker.getObjectByName("ring")?.scale.setScalar(pulse)
			const arrow = this.marker.getObjectByName("arrow")
			if (arrow) arrow.position.y = 1.15 + Math.abs(Math.sin(t * 5)) * 0.25
		}

		const shakeBy = shake ? shakeOffset(dt, t) : { x: 0, y: 0 }
		const direction = new Vector3(0, 6.9, 8.4).normalize()
		this.camera.position.copy(this.look).addScaledVector(direction, this.zoom)
		this.camera.position.x += Math.sin(t * 0.35) * this.drift * 0.8 + shakeBy.x
		this.camera.position.y += Math.sin(t * 0.5) * this.drift * 0.25 + shakeBy.y
		this.camera.lookAt(this.look)
	}

	render() {
		this.renderer.render(this.scene, this.camera)
	}

	/** Where a cook's plate sits: the near edge of the table, in front of the cook. */
	plateAt(x: number): Vector3 {
		return new Vector3(x, TABLE_TOP + 0.04, PLATE_Z)
	}

	/** Where a plate lands on the counter in front of a customer. */
	counterSpot(slot: number): Vector3 {
		return new Vector3(COLUMN_X[slot] ?? 0, COUNTER_TOP + 0.06, COUNTER_Z + 0.25)
	}
}
