import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	CanvasTexture,
	Points,
	PointsMaterial,
	type Scene,
	type Vector3,
} from "three"

/**
 * Juice: tweens, particles, camera shake. Nothing here knows the rules; it only makes what the rules
 * report feel like something. Every effect is short, eased and cheap.
 */

export const ease = {
	linear: (t: number) => t,
	outQuad: (t: number) => 1 - (1 - t) * (1 - t),
	inQuad: (t: number) => t * t,
	inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
	outBack: (t: number) => {
		const c1 = 1.70158
		const c3 = c1 + 1
		return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
	},
	outElastic: (t: number) => {
		if (t === 0 || t === 1) return t
		const c4 = (2 * Math.PI) / 3
		return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
	},
	outBounce: (t: number) => {
		const n1 = 7.5625
		const d1 = 2.75
		if (t < 1 / d1) return n1 * t * t
		if (t < 2 / d1) return n1 * (t - 1.5 / d1) * (t - 1.5 / d1) + 0.75
		if (t < 2.5 / d1) return n1 * (t - 2.25 / d1) * (t - 2.25 / d1) + 0.9375
		return n1 * (t - 2.625 / d1) * (t - 2.625 / d1) + 0.984375
	},
}

interface Tween {
	t: number
	duration: number
	delay: number
	easing: (t: number) => number
	update: (progress: number) => void
	done?: (() => void) | undefined
}

const tweens: Tween[] = []

/** Runs `update(0..1)` over `duration` seconds, eased, after an optional delay. */
export function tween(
	duration: number,
	update: (progress: number) => void,
	options: { easing?: (t: number) => number; delay?: number; done?: () => void } = {},
) {
	tweens.push({
		t: 0,
		duration,
		delay: options.delay ?? 0,
		easing: options.easing ?? ease.outQuad,
		update,
		done: options.done,
	})
}

export function updateTweens(dt: number) {
	for (let index = tweens.length - 1; index >= 0; index -= 1) {
		const item = tweens[index]
		if (!item) continue
		if (item.delay > 0) {
			item.delay -= dt
			continue
		}
		item.t += dt
		const raw = Math.min(1, item.t / item.duration)
		item.update(item.easing(raw))
		if (raw >= 1) {
			tweens.splice(index, 1)
			item.done?.()
		}
	}
}

/** Camera shake: a trauma value that decays, squared into an offset. */
let trauma = 0
export function shake(amount: number) {
	trauma = Math.min(1, trauma + amount)
}
export function shakeOffset(dt: number, time: number): { x: number; y: number } {
	trauma = Math.max(0, trauma - dt * 1.8)
	const power = trauma * trauma
	return { x: Math.sin(time * 61) * power * 0.22, y: Math.sin(time * 73 + 1.7) * power * 0.16 }
}

/** Hit-stop: the world freezes for a few frames on an impact. 0 when running. */
let freeze = 0
export function hitStop(seconds: number) {
	freeze = Math.max(freeze, seconds)
}
export function consumeFreeze(dt: number): boolean {
	if (freeze <= 0) return false
	freeze -= dt
	return true
}

function spriteTexture(draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
	const canvas = document.createElement("canvas")
	canvas.width = 64
	canvas.height = 64
	const ctx = canvas.getContext("2d")
	if (ctx) draw(ctx, 64)
	return new CanvasTexture(canvas)
}

const textures = {
	dot: () =>
		spriteTexture((ctx, size) => {
			const gradient = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2)
			gradient.addColorStop(0, "rgba(255,255,255,1)")
			gradient.addColorStop(0.5, "rgba(255,255,255,0.7)")
			gradient.addColorStop(1, "rgba(255,255,255,0)")
			ctx.fillStyle = gradient
			ctx.fillRect(0, 0, size, size)
		}),
	star: () =>
		spriteTexture((ctx, size) => {
			ctx.fillStyle = "#fff"
			ctx.beginPath()
			for (let i = 0; i < 10; i += 1) {
				const radius = i % 2 === 0 ? size * 0.46 : size * 0.18
				const angle = (i / 10) * Math.PI * 2 - Math.PI / 2
				ctx.lineTo(size / 2 + Math.cos(angle) * radius, size / 2 + Math.sin(angle) * radius)
			}
			ctx.closePath()
			ctx.fill()
		}),
	square: () =>
		spriteTexture((ctx, size) => {
			ctx.fillStyle = "#fff"
			ctx.fillRect(size * 0.2, size * 0.28, size * 0.6, size * 0.44)
		}),
}

export type ParticleKind = keyof typeof textures

interface Particle {
	x: number
	y: number
	z: number
	vx: number
	vy: number
	vz: number
	life: number
	max: number
	gravity: number
	drag: number
}

/** One pool per look (sprite, blending, colour): a Points object with a fixed capacity. */
export class Emitter {
	private readonly particles: Particle[] = []
	private readonly positions: BufferAttribute
	private readonly sizes: Float32Array
	private readonly points: Points
	private readonly capacity: number

	constructor(
		scene: Scene,
		kind: ParticleKind,
		color: number,
		size: number,
		options: { additive?: boolean; capacity?: number; fade?: boolean } = {},
	) {
		this.capacity = options.capacity ?? 200
		const geometry = new BufferGeometry()
		this.positions = new BufferAttribute(new Float32Array(this.capacity * 3), 3)
		this.sizes = new Float32Array(this.capacity)
		geometry.setAttribute("position", this.positions)
		const material = new PointsMaterial({
			color,
			size,
			map: textures[kind](),
			transparent: true,
			depthWrite: false,
			sizeAttenuation: true,
			opacity: 1,
			...(options.additive ? { blending: AdditiveBlending } : {}),
		})
		this.points = new Points(geometry, material)
		this.points.frustumCulled = false
		this.points.renderOrder = 10
		scene.add(this.points)
		geometry.setDrawRange(0, 0)
	}

	emit(
		at: Vector3,
		count: number,
		options: { speed?: number; up?: number; spread?: number; life?: number; gravity?: number; drag?: number } = {},
	) {
		const { speed = 2, up = 1, spread = 1, life = 0.8, gravity = 6, drag = 0.4 } = options
		for (let i = 0; i < count && this.particles.length < this.capacity; i += 1) {
			const angle = Math.random() * Math.PI * 2
			const push = speed * (0.4 + Math.random() * 0.8)
			this.particles.push({
				x: at.x + (Math.random() - 0.5) * 0.1 * spread,
				y: at.y,
				z: at.z + (Math.random() - 0.5) * 0.1 * spread,
				vx: Math.cos(angle) * push * spread,
				vy: up * (0.6 + Math.random() * 0.8) * speed,
				vz: Math.sin(angle) * push * spread,
				life: life * (0.7 + Math.random() * 0.6),
				max: life,
				gravity,
				drag,
			})
		}
	}

	update(dt: number) {
		let live = 0
		for (let index = this.particles.length - 1; index >= 0; index -= 1) {
			const p = this.particles[index]
			if (!p) continue
			p.life -= dt
			if (p.life <= 0) {
				this.particles.splice(index, 1)
				continue
			}
			p.vy -= p.gravity * dt
			const damp = Math.max(0, 1 - p.drag * dt)
			p.vx *= damp
			p.vz *= damp
			p.x += p.vx * dt
			p.y += p.vy * dt
			p.z += p.vz * dt
		}
		for (const p of this.particles) {
			this.positions.setXYZ(live, p.x, p.y, p.z)
			live += 1
		}
		this.positions.needsUpdate = true
		this.points.geometry.setDrawRange(0, live)
		const material = this.points.material as PointsMaterial
		// Fade the whole pool with the youngest particle: cheap, and good enough for short bursts.
		material.opacity = live > 0 ? 1 : 0
		void this.sizes
	}
}
