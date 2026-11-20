import {
	AmbientLight,
	BoxGeometry,
	CanvasTexture,
	CircleGeometry,
	Color,
	ConeGeometry,
	CylinderGeometry,
	DirectionalLight,
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
import type { Item, StationId, Target } from "./game"
import { canvasTexture, outlined, toon } from "./toon"

/** World layout, in metres. Cooks stand behind the table; customers stand behind the counter. */
export const STATION_X: Record<StationId, number> = { nasi: -2.9, wajan: 0, sambal: 2.9 }
/** Mutable on purpose: a narrow screen pulls the stalls and the customers closer together. */
export const COLUMN_X: number[] = [-2.9, 0, 2.9]
const BASE_X = { nasi: -2.9, wajan: 0, sambal: 2.9 }
export const TABLE_Z = 0.55
export const COOK_Z = 2.2
export const COUNTER_Z = -1.55
export const CUSTOMER_Z = -2.7
/** Where plates sit: the front edge of the table, in front of the cook. */
export const PLATE_Z = TABLE_Z + 0.85
const TABLE_TOP = 0.98

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
				for (let grain = 0; grain < 7; grain += 1) {
					ctx.fillStyle = dark
					ctx.globalAlpha = 0.18
					ctx.fillRect(Math.random() * 256, y + 6 + Math.random() * 50, 30 + Math.random() * 70, 2)
				}
				ctx.globalAlpha = 1
				ctx.fillStyle = dark
				ctx.fillRect(((row * 97) % 200) + 20, y, 3, 64)
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
	{ repeat: [3, 1.2], pixel: true },
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
		gradient.addColorStop(0, "#6cc4ff")
		gradient.addColorStop(0.62, "#ffe2a6")
		gradient.addColorStop(1, "#ffc88a")
		ctx.fillStyle = gradient
		ctx.fillRect(0, 0, 512, 256)
		ctx.fillStyle = "rgba(255, 244, 200, 0.9)"
		ctx.beginPath()
		ctx.arc(380, 150, 34, 0, Math.PI * 2)
		ctx.fill()
		// Hills and terraced rice fields, three layers going darker towards the front.
		const layers: [string, number, number][] = [
			["#7fb98d", 175, 22],
			["#5da877", 195, 18],
			["#3f8f63", 218, 14],
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
		for (let i = 0; i < 6; i += 1) ctx.fillRect(40 + i * 80, 215 + (i % 2) * 8, 60, 3)
	})
}

function sign(text: string, color: string, ink: string) {
	return canvasTexture(256, 96, (ctx) => {
		ctx.fillStyle = color
		ctx.fillRect(0, 0, 256, 96)
		ctx.fillStyle = ink
		ctx.fillRect(0, 0, 256, 8)
		ctx.fillRect(0, 88, 256, 8)
		ctx.font = "bold 54px ui-rounded, system-ui, sans-serif"
		ctx.textAlign = "center"
		ctx.textBaseline = "middle"
		ctx.fillText(text, 128, 50)
	})
}

export interface Station {
	group: Group
	top: Vector3
}

export class World {
	readonly scene = new Scene()
	readonly camera = new PerspectiveCamera(38, 1, 0.1, 80)
	readonly renderer: WebGLRenderer
	readonly stations = {} as Record<StationId, Station>
	readonly hits: Object3D[] = []
	private readonly raycaster = new Raycaster()
	private readonly look = new Vector3(0, 1.25, -0.6)
	private readonly steam: Emitter
	private readonly sparks: Emitter
	private readonly puffs: Emitter
	private readonly confetti: Emitter[]
	private readonly fire: Mesh[] = []
	private readonly lights: Mesh[] = []
	private readonly clouds: Mesh[] = []
	private readonly lamps: Group[] = []
	private readonly wokOil: Mesh
	readonly wokFood: Group
	private time = 0
	private zoom = 1
	/** Things as wide as the room: they stretch with the spread. */
	private readonly wide: Object3D[] = []
	private readonly customerHits: Object3D[] = []
	/** Slow camera drift for the title screen; 0 while playing. */
	drift = 0
	private aspect = 1

	constructor(canvas: HTMLCanvasElement) {
		this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" })
		this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
		this.renderer.shadowMap.enabled = true
		this.renderer.shadowMap.type = PCFSoftShadowMap
		this.renderer.outputColorSpace = SRGBColorSpace

		this.scene.background = new Color("#ffd9a0")
		this.scene.fog = new Fog("#ffd9a0", 26, 60)

		this.addLights()
		this.addRoom()
		this.addCounter()
		this.addTable()
		this.stations.nasi = this.addRice()
		this.wokFood = new Group()
		const wok = this.addWok()
		this.wokOil = wok.oil
		this.stations.wajan = wok.station
		this.stations.sambal = this.addSambal()
		this.addCustomerHits()
		this.addScenery()

		this.steam = new Emitter(this.scene, "dot", 0xffffff, 0.5, { capacity: 160 })
		this.sparks = new Emitter(this.scene, "star", 0xffe066, 0.38, { additive: true, capacity: 160 })
		this.puffs = new Emitter(this.scene, "dot", 0xffa24a, 0.55, { additive: true, capacity: 120 })
		this.confetti = ["#ff6f91", "#4cc9e2", "#ffd24d", "#7bd389", "#c39bff"].map(
			(color) => new Emitter(this.scene, "square", new Color(color).getHex(), 0.3, { capacity: 70 }),
		)
	}

	private addLights() {
		this.scene.add(new AmbientLight(0xfff2dc, 0.55))
		this.scene.add(new HemisphereLight(0xfff1d6, 0x7a5a9a, 0.9))
		const sun = new DirectionalLight(0xfff0cf, 2.1)
		sun.position.set(-6, 11, 7)
		sun.castShadow = true
		sun.shadow.mapSize.set(2048, 2048)
		sun.shadow.camera.left = -9
		sun.shadow.camera.right = 9
		sun.shadow.camera.top = 7
		sun.shadow.camera.bottom = -7
		sun.shadow.bias = -0.0004
		sun.shadow.radius = 4
		this.scene.add(sun)
		const rim = new DirectionalLight(0xb9a6ff, 0.7)
		rim.position.set(7, 4, -3)
		this.scene.add(rim)
		// Warm glow under the awning, where the lamps hang.
		const glow = new PointLight(0xffb15c, 14, 9, 1.8)
		glow.position.set(0, 3, -1.2)
		this.scene.add(glow)
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
		const floor = new Mesh(new PlaneGeometry(40, 30), toon("#ffffff", { map: wood("#b9824a", "#7a4d27", "#c78f55", [10, 8]) }))
		floor.rotation.x = -Math.PI / 2
		floor.receiveShadow = true
		this.scene.add(floor)

		// Back wall with a window onto the village.
		const wallMaterial = toon("#ffffff", { map: bamboo })
		const wall = (width: number, height: number, x: number, y: number) => {
			const piece = new Mesh(new BoxGeometry(width, height, 0.3), wallMaterial)
			piece.position.set(x, y, -4.7)
			piece.receiveShadow = true
			piece.castShadow = true
			this.scene.add(piece)
		}
		wall(5.2, 5, -5.2, 2.5)
		wall(5.2, 5, 5.2, 2.5)
		wall(5.2, 1.6, 0, 0.8)
		wall(5.2, 1.4, 0, 4.3)
		const frame = outlined(new Mesh(new RoundedBoxGeometry(5.5, 2.4, 0.2, 2, 0.05), toon("#7a4d27")), 0.025)
		frame.position.set(0, 2.4, -4.55)
		frame.scale.set(1, 1, 0.4)
		// Hollow it: a thin dark frame drawn as four bars instead of a slab that would hide the view.
		frame.visible = false
		const bar = (w: number, h: number, x: number, y: number) => {
			const piece = outlined(new Mesh(new RoundedBoxGeometry(w, h, 0.22, 2, 0.04), toon("#8a5a2e")), 0.02)
			piece.position.set(x, y, -4.52)
			this.scene.add(piece)
		}
		bar(5.5, 0.16, 0, 3.6)
		bar(5.5, 0.16, 0, 1.6)
		bar(0.16, 2.1, -2.7, 2.6)
		bar(0.16, 2.1, 2.7, 2.6)
		bar(0.1, 2.1, 0, 2.6)

		const backdrop = new Mesh(new PlaneGeometry(34, 13), new MeshBasicMaterial({ map: sky(), fog: false }))
		backdrop.position.set(0, 4.2, -13)
		this.scene.add(backdrop)
	}

	private addCounter() {
		const body = outlined(new Mesh(new RoundedBoxGeometry(9.4, 1, 1.3, 3, 0.08), toon("#ffffff", { map: wood("#a86b3a", "#6a3f1d", "#b87a45", [3, 1]) })), 0.03)
		body.position.set(0, 0.5, COUNTER_Z)
		const top = outlined(new Mesh(new RoundedBoxGeometry(9.8, 0.1, 1.3, 3, 0.04), toon("#c98c4f")), 0.03)
		top.position.set(0, 1.06, COUNTER_Z)
		this.wide.push(body, top)
		const trim = new Mesh(new BoxGeometry(9.5, 0.16, 0.04), toon("#ffffff", { map: stripes("#d8432f", "#fff3dc", 24) }))
		trim.position.set(0, 0.86, COUNTER_Z + 0.67)
		this.add(body)
		this.add(top)
		this.add(trim, false)
		this.wide.push(trim)
	}

	private addTable() {
		const top = outlined(new Mesh(new RoundedBoxGeometry(9.6, 0.2, 1.9, 3, 0.06), toon("#ffffff", { map: wood("#c98c4f", "#7a4d27", "#d99c5d", [3, 1]) })), 0.03)
		top.position.set(0, TABLE_TOP - 0.1, TABLE_Z)
		const cloth = new Mesh(new BoxGeometry(9.4, 0.025, 1.0), toon("#ffffff", { map: stripes("#ff8a4c", "#fff3dc", 28) }))
		cloth.position.set(0, TABLE_TOP + 0.005, TABLE_Z + 0.2)
		this.add(top)
		this.add(cloth, false)
		this.wide.push(top, cloth)
		for (const x of [-4.4, 4.4]) {
			const leg = outlined(new Mesh(new BoxGeometry(0.28, TABLE_TOP - 0.2, 0.28), toon("#8a5a2e")), 0.02)
			leg.position.set(x, (TABLE_TOP - 0.2) / 2, TABLE_Z + 0.6)
			this.add(leg)
		}
	}

	private station(id: StationId, label: string, color: string): { group: Group; top: Vector3 } {
		const x = STATION_X[id]
		const group = new Group()
		group.position.set(x, TABLE_TOP, TABLE_Z)
		// A menu card leaning on the front edge of the table, readable from above.
		const plate = outlined(new Mesh(new RoundedBoxGeometry(1.05, 0.36, 0.06, 2, 0.02), toon("#ffffff", { map: sign(label, color, "#2b1d12") })), 0.02)
		plate.position.set(0, 0.17, 0.88)
		plate.rotation.x = -0.9
		group.add(plate)
		const hit = new Mesh(new BoxGeometry(1.8, 1.0, 1.6), new MeshBasicMaterial({ visible: false }))
		hit.position.set(0, 0.5, 0.15)
		hit.userData = { target: { station: id } satisfies Target }
		group.add(hit)
		this.hits.push(hit)
		this.add(group)
		return { group, top: new Vector3(x, TABLE_TOP, TABLE_Z) }
	}

	private addRice(): Station {
		const station = this.station("nasi", "NASI", "#fff3dc")
		const basket = outlined(
			new Mesh(
				new CylinderGeometry(0.62, 0.5, 0.55, 20),
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
		const rice = outlined(new Mesh(new SphereGeometry(0.6, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), toon("#fffaf0")), 0.02)
		rice.scale.set(1, 0.55, 1)
		rice.position.y = 0.55
		station.group.add(basket, rice)
		for (let i = 0; i < 18; i += 1) {
			const grain = new Mesh(new SphereGeometry(0.02, 5, 4), toon("#e8dfc8"))
			const angle = Math.random() * Math.PI * 2
			const radius = Math.random() * 0.45
			grain.position.set(Math.cos(angle) * radius, 0.55 + Math.sqrt(Math.max(0, 0.36 - radius * radius)) * 0.55 * 0.9, Math.sin(angle) * radius)
			station.group.add(grain)
		}
		return station
	}

	private addWok(): { station: Station; oil: Mesh } {
		const station = this.station("wajan", "WAJAN", "#ffd24d")
		const stove = outlined(new Mesh(new CylinderGeometry(0.72, 0.8, 0.5, 18), toon("#9c3b2e")), 0.03)
		stove.position.y = 0.25
		const wok = outlined(
			new Mesh(new SphereGeometry(0.78, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon("#3a3a46", { side: 2 })),
			0.02,
		)
		wok.scale.set(1, 0.55, 1)
		wok.position.y = 0.95
		const rim = outlined(new Mesh(new TorusGeometry(0.78, 0.035, 8, 28), toon("#555566")), 0.01)
		rim.rotation.x = Math.PI / 2
		rim.position.y = 0.95
		const oil = new Mesh(new CircleGeometry(0.62, 24), new MeshBasicMaterial({ color: 0xffc94d }))
		oil.rotation.x = -Math.PI / 2
		oil.position.y = 0.78
		for (const side of [-1, 1]) {
			const handle = outlined(new Mesh(new CylinderGeometry(0.04, 0.04, 0.55, 8), toon("#6a3f1d")), 0.015)
			handle.rotation.z = Math.PI / 2
			handle.position.set(side * 1.0, 0.98, 0)
			station.group.add(handle)
		}
		station.group.add(stove, wok, rim, oil)
		this.wokFood.position.set(0, 0.84, 0)
		station.group.add(this.wokFood)
		// Fire: three flickering cones between the stove and the wok.
		for (let i = 0; i < 6; i += 1) {
			const flame = new Mesh(new ConeGeometry(0.1, 0.34, 6), new MeshBasicMaterial({ color: i % 2 ? 0xff7a2a : 0xffc23a }))
			const angle = (i / 6) * Math.PI * 2
			flame.position.set(Math.cos(angle) * 0.46, 0.55, Math.sin(angle) * 0.46)
			station.group.add(flame)
			this.fire.push(flame)
		}
		return { station, oil }
	}

	private addSambal(): Station {
		const station = this.station("sambal", "SAMBAL", "#ff8a76")
		const bowl = outlined(new Mesh(new CylinderGeometry(0.62, 0.48, 0.34, 20), toon("#8a8f9c")), 0.025)
		bowl.position.y = 0.17
		const sambal = outlined(new Mesh(new SphereGeometry(0.5, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon("#d8301f")), 0.02)
		sambal.scale.set(1, 0.5, 1)
		sambal.position.y = 0.32
		const pestle = outlined(new Mesh(new CylinderGeometry(0.07, 0.11, 0.9, 10), toon("#6f7480")), 0.02)
		pestle.position.set(-0.2, 0.7, 0.1)
		pestle.rotation.z = 0.5
		const chili = outlined(new Mesh(new ConeGeometry(0.06, 0.32, 8), toon("#e83a1c")), 0.012)
		chili.position.set(0.8, 0.06, 0.4)
		chili.rotation.z = Math.PI / 2 + 0.3
		station.group.add(bowl, sambal, pestle, chili)
		return station
	}

	private addCustomerHits() {
		COLUMN_X.forEach((x, index) => {
			const hit = new Mesh(new BoxGeometry(2.3, 3, 1.6), new MeshBasicMaterial({ visible: false }))
			hit.position.set(x, 1.6, CUSTOMER_Z)
			hit.userData = { target: { customer: index } satisfies Target }
			this.scene.add(hit)
			this.hits.push(hit)
			this.customerHits.push(hit)
		})
	}

	private addScenery() {
		// Awning over the counter: striped cloth with a scalloped, hanging edge, lamps and string lights.
		const cloth = new Mesh(new BoxGeometry(11.4, 0.1, 3.4), toon("#ffffff", { map: stripes("#e0402e", "#fff3dc", 14) }))
		cloth.position.set(0, 3.95, -3.0)
		cloth.rotation.x = 0.1
		this.add(cloth)
		for (let i = 0; i < 14; i += 1) {
			const scallop = outlined(new Mesh(new CylinderGeometry(0.4, 0.4, 0.1, 14, 1, false, 0, Math.PI), toon(i % 2 ? "#fff3dc" : "#e0402e")), 0.015)
			scallop.rotation.set(Math.PI / 2, 0, Math.PI / 2)
			scallop.position.set(-5.2 + i * 0.8, 3.72, -1.42)
			this.scene.add(scallop)
		}
		for (const x of [-3.6, 0, 3.6]) {
			const lamp = new Group()
			const cord = new Mesh(new CylinderGeometry(0.012, 0.012, 0.6, 4), toon("#2b1d12"))
			cord.position.y = 0.3
			const bulb = outlined(new Mesh(new SphereGeometry(0.2, 14, 10), new MeshBasicMaterial({ color: 0xffb35c })), 0.025)
			lamp.add(cord, bulb)
			lamp.position.set(x, 3.0, -1.6)
			this.scene.add(lamp)
			this.lamps.push(lamp)
		}
		for (let i = 0; i < 13; i += 1) {
			const bulb = new Mesh(new SphereGeometry(0.06, 6, 5), new MeshBasicMaterial({ color: i % 2 ? 0xffe066 : 0xff8a76 }))
			bulb.position.set(-5.6 + i * 0.93, 3.58 - Math.sin(i * 0.5) * 0.07, -1.35)
			this.scene.add(bulb)
			this.lights.push(bulb)
		}
		// Palms and clouds out the window.
		for (const [x, z, h] of [[-9, -9, 5], [8, -8, 6], [-4.5, -10, 4], [12, -10, 4.5]] as const) {
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
			cloud.position.set(-16 + i * 8, 6.5 + (i % 3), -12)
			this.scene.add(cloud)
			this.clouds.push(cloud as unknown as Mesh)
		}
	}

	// ---- public ----
	resize(width: number, height: number) {
		this.renderer.setSize(width, height, false)
		this.aspect = width / Math.max(1, height)
		this.camera.aspect = this.aspect
		// Narrow screens: pull the stalls and the customers in, so the scene fills the width.
		const spread = Math.min(1, Math.max(0.5, (this.aspect - 0.35) / 0.95))
		this.setSpread(spread)
		// Frame the 11.5 m the stalls need: wide screens are limited by height, tall ones by width.
		const fov = this.camera.fov
		const need = 13.2 * spread + (spread < 1 ? 0.9 : 0)
		const distance = Math.max(spread < 1 ? 7 : 12.5, need / (2 * Math.tan((fov * Math.PI) / 360) * this.aspect))
		this.look.y = 1.25 + (spread < 1 ? 0.9 : 0)
		this.zoom = distance
		this.camera.updateProjectionMatrix()
	}

	private setSpread(spread: number) {
		for (const id of Object.keys(BASE_X) as StationId[]) {
			const x = BASE_X[id] * spread
			STATION_X[id] = x
			this.stations[id].group.position.x = x
			this.stations[id].top.x = x
		}
		COLUMN_X.forEach((_, index) => {
			const x = (Object.values(BASE_X)[index] ?? 0) * spread
			COLUMN_X[index] = x
			const hit = this.customerHits[index]
			if (hit) hit.position.x = x
		})
		for (const piece of this.wide) piece.scale.x = Math.max(0.56, spread * 1.04)
	}

	/** Which station or customer a screen point touches. */
	pick(clientX: number, clientY: number, bounds: DOMRect): Target | null {
		const pointer = new Vector2(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1)
		this.raycaster.setFromCamera(pointer, this.camera)
		const found = this.raycaster.intersectObjects(this.hits, false)[0]
		return (found?.object.userData.target as Target | undefined) ?? null
	}

	/** A world point as a pixel position inside the canvas, or null when it is behind the camera. */
	project(point: Vector3, bounds: { width: number; height: number }): { x: number; y: number } | null {
		const v = point.clone().project(this.camera)
		if (v.z > 1) return null
		return { x: ((v.x + 1) / 2) * bounds.width, y: ((1 - v.y) / 2) * bounds.height }
	}

	/** Fills the wok: what is frying, from raw to golden. */
	setFrying(progress: number | null, ready: boolean) {
		this.wokFood.clear()
		if (progress === null) return
		const piece = outlined(new Mesh(new RoundedBoxGeometry(0.5, 0.12, 0.34, 2, 0.04), toon(ready ? "#e8a43a" : "#e8d3a0")), 0.015)
		piece.rotation.y = this.time * 0.5
		piece.position.y = 0.02 + Math.sin(this.time * 7) * 0.012
		this.wokFood.add(piece)
		void this.wokOil
	}

	sparkle(at: Vector3, count = 14) {
		this.sparks.emit(at, count, { speed: 2.6, up: 1.2, life: 0.7, gravity: 3 })
	}
	steamAt(at: Vector3, count = 2) {
		this.steam.emit(at, count, { speed: 0.35, up: 1.1, spread: 0.3, life: 1.3, gravity: -0.4, drag: 0.2 })
	}
	puff(at: Vector3, count = 10) {
		this.puffs.emit(at, count, { speed: 1.8, up: 0.8, life: 0.5, gravity: 1 })
	}
	burst(at: Vector3) {
		for (const emitter of this.confetti) emitter.emit(at, 16, { speed: 5, up: 1.4, spread: 1.4, life: 1.6, gravity: 8, drag: 0.8 })
	}

	update(dt: number) {
		this.time += dt
		const t = this.time
		for (const [index, flame] of this.fire.entries()) {
			const flicker = 0.75 + Math.sin(t * 14 + index * 2.1) * 0.25 + Math.sin(t * 23 + index) * 0.1
			flame.scale.set(1, flicker, 1)
			flame.position.y = 0.5 + flicker * 0.12
		}
		for (const [index, bulb] of this.lights.entries()) bulb.scale.setScalar(0.85 + Math.sin(t * 3 + index * 1.3) * 0.2)
		for (const [index, lamp] of this.lamps.entries()) lamp.rotation.z = Math.sin(t * 1.3 + index) * 0.05
		for (const [index, cloud] of this.clouds.entries()) {
			cloud.position.x += dt * (0.25 + index * 0.04)
			if (cloud.position.x > 24) cloud.position.x = -24
		}
		this.steam.update(dt)
		this.sparks.update(dt)
		this.puffs.update(dt)
		for (const emitter of this.confetti) emitter.update(dt)
		// Rice steam, always.
		if (Math.random() < dt * 5) this.steamAt(new Vector3(STATION_X.nasi, TABLE_TOP + 0.9, TABLE_Z), 1)

		const shakeBy = shakeOffset(dt, t)
		const sway = this.drift
		const direction = new Vector3(0, 4.9, 9.6).normalize()
		this.camera.position.copy(this.look).addScaledVector(direction, this.zoom)
		this.camera.position.x += Math.sin(t * 0.35) * sway * 0.8 + shakeBy.x
		this.camera.position.y += Math.sin(t * 0.5) * sway * 0.25 + shakeBy.y
		this.camera.lookAt(this.look)
	}

	render() {
		this.renderer.render(this.scene, this.camera)
	}

	/** Where an item flies to or from: the table in front of a seat's x. */
	plateAt(x: number): Vector3 {
		return new Vector3(x, TABLE_TOP + 0.04, PLATE_Z)
	}

	itemOf(_item: Item) {
		return null
	}
}
