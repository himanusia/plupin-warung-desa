import type { Item } from "./game"

/** DOM helpers for the layer above the canvas: icons, bubbles, floating numbers, flying coins. */

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
	const found = document.getElementById(id)
	if (!found) throw new Error(`index.html is missing #${id}`)
	return found as T
}
export const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)

export function icon(item: Item): string {
	const ink = "#1a1233"
	if (item === "nasi")
		return `<svg class="item" viewBox="0 0 40 40"><ellipse cx="20" cy="30" rx="15" ry="5" fill="#cfc3a2" stroke="${ink}" stroke-width="2.5"/><path d="M6 30 Q8 10 20 9 Q32 10 34 30 Z" fill="#fffaf0" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round"/><g fill="#d9cdb0"><circle cx="15" cy="20" r="1.4"/><circle cx="22" cy="16" r="1.4"/><circle cx="26" cy="24" r="1.4"/><circle cx="18" cy="26" r="1.4"/></g></svg>`
	if (item === "tempe")
		return `<svg class="item" viewBox="0 0 40 40"><rect x="4" y="12" width="32" height="18" rx="5" fill="#e2a03a" stroke="${ink}" stroke-width="2.5"/><g fill="#a6651c"><circle cx="12" cy="18" r="1.8"/><circle cx="20" cy="17" r="1.8"/><circle cx="28" cy="19" r="1.8"/><circle cx="15" cy="25" r="1.8"/><circle cx="24" cy="25" r="1.8"/></g></svg>`
	if (item === "kerupuk")
		return `<svg class="item" viewBox="0 0 40 40"><ellipse cx="14" cy="26" rx="11" ry="9" fill="#f9e3a8" stroke="${ink}" stroke-width="2.5"/><ellipse cx="25" cy="21" rx="11" ry="9" fill="#f2c35a" stroke="${ink}" stroke-width="2.5"/><g fill="#d9a53a"><circle cx="22" cy="19" r="1.4"/><circle cx="28" cy="23" r="1.4"/><circle cx="25" cy="16" r="1.2"/></g></svg>`
	return `<svg class="item" viewBox="0 0 40 40"><ellipse cx="20" cy="30" rx="16" ry="6" fill="#3fae74" stroke="${ink}" stroke-width="2.5"/><path d="M8 29 Q10 11 21 11 Q31 12 33 29 Z" fill="#d8301f" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round"/><ellipse cx="17" cy="19" rx="3" ry="2" fill="#ff8a76"/></svg>`
}

export interface BubbleSpec {
	id: number
	name: string
	/** One list of items per plate: a pesta order has two. */
	parts: readonly (readonly Item[])[]
	/** Which parts are already served. */
	got: readonly number[]
	/** What my plate holds, so the items I already have light up. */
	have: readonly Item[]
	patience: number
	special: boolean
	/** Pixel position of the point above the customer's head. */
	x: number
	y: number
	scale: number
}

/** One bubble per order: made on first sight with a pop, moved every frame, removed when gone. */
export class Bubbles {
	private readonly root = $("bubbles")
	private readonly live = new Map<number, HTMLElement>()

	update(specs: BubbleSpec[]) {
		const seen = new Set<number>()
		for (const spec of specs) {
			seen.add(spec.id)
			let node = this.live.get(spec.id)
			if (!node) {
				node = document.createElement("div")
				node.className = "bubble pop"
				node.innerHTML = `${spec.special ? '<span class="tag">★ SPESIAL</span>' : ""}${spec.parts.length > 1 ? '<span class="tag team">2 PIRING · 2 KOKI</span>' : ""}<div class="name">${spec.name}</div><div class="parts">${spec.parts.map((items, part) => `<div class="items" data-part="${part}">${items.map((item) => `<span class="slot" data-item="${item}">${icon(item)}</span>`).join("")}</div>`).join("")}</div><div class="meter"><i></i></div>`
				if (spec.special) node.classList.add("special")
				this.root.append(node)
				this.live.set(spec.id, node)
			}
			// Light up what is already on my plate for the first plate still to make; tick plates already served.
			const open = spec.parts.findIndex((_, part) => !spec.got.includes(part))
			node.querySelectorAll<HTMLElement>(".items").forEach((row) => {
				const part = Number(row.dataset.part)
				row.classList.toggle("done", spec.got.includes(part))
				row.querySelectorAll<HTMLElement>(".slot").forEach((slot) => slot.classList.toggle("have", part === open && spec.have.includes(slot.dataset.item as Item)))
			})
			const meter = node.querySelector<HTMLElement>(".meter i")
			if (meter) meter.style.transform = `scaleX(${Math.max(0, spec.patience)})`
			node.classList.toggle("warn", spec.patience < 0.5 && spec.patience >= 0.22)
			node.classList.toggle("hot", spec.patience < 0.22)
			node.style.transform = `translate(${spec.x}px, ${spec.y}px) translate(-50%, -100%) scale(${spec.scale})`
		}
		for (const [id, node] of this.live) {
			if (seen.has(id)) continue
			node.remove()
			this.live.delete(id)
		}
	}

	clear() {
		for (const node of this.live.values()) node.remove()
		this.live.clear()
	}
}

/** Rising, fading text at a pixel position. */
export function floater(text: string, x: number, y: number, kind: "" | "glyph" = "") {
	const node = document.createElement("div")
	node.className = `floater ${kind}`
	node.textContent = text
	$("floaters").append(node)
	const animation = node.animate(
		[
			{ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(0.3)`, opacity: 0 },
			{ transform: `translate(${x}px, ${y - 26}px) translate(-50%, -50%) scale(1.25)`, opacity: 1, offset: 0.2 },
			{ transform: `translate(${x}px, ${y - 90}px) translate(-50%, -50%) scale(1)`, opacity: 1, offset: 0.7 },
			{ transform: `translate(${x}px, ${y - 130}px) translate(-50%, -50%) scale(0.9)`, opacity: 0 },
		],
		{ duration: 1100, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
	)
	animation.onfinish = () => node.remove()
}

/** Coins that burst out of a point and arc into the coin counter. */
export function flyCoins(from: { x: number; y: number }, count: number, onLand: () => void) {
	const chip = $("coins-chip").getBoundingClientRect()
	const stage = $("floaters").getBoundingClientRect()
	const target = { x: chip.left - stage.left + 24, y: chip.top - stage.top + chip.height / 2 }
	for (let i = 0; i < count; i += 1) {
		const node = document.createElement("div")
		node.className = "flycoin"
		$("floaters").append(node)
		const spread = { x: (Math.random() - 0.5) * 120, y: -30 - Math.random() * 70 }
		const mid = { x: from.x + spread.x, y: from.y + spread.y }
		const animation = node.animate(
			[
				{ transform: `translate(${from.x}px, ${from.y}px) translate(-50%, -50%) scale(0.3)`, offset: 0 },
				{ transform: `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%) scale(1.1)`, offset: 0.35, easing: "ease-in" },
				{ transform: `translate(${target.x}px, ${target.y}px) translate(-50%, -50%) scale(0.6)`, offset: 1 },
			],
			{ duration: 750 + i * 60, delay: i * 45, easing: "cubic-bezier(0.3, 0, 0.2, 1)", fill: "backwards" },
		)
		animation.onfinish = () => {
			node.remove()
			onLand()
		}
	}
}

export function countUp(node: HTMLElement, to: number, ms = 700) {
	const from = Number(node.textContent) || 0
	const start = performance.now()
	const step = (now: number) => {
		const t = Math.min(1, (now - start) / ms)
		node.textContent = String(Math.round(from + (to - from) * (1 - (1 - t) ** 3)))
		if (t < 1) requestAnimationFrame(step)
	}
	requestAnimationFrame(step)
}

export function bump(node: HTMLElement) {
	node.classList.remove("bump")
	void node.offsetWidth
	node.classList.add("bump")
}

/** Splits the logo into bouncing letters. */
export function logo() {
	const holder = document.querySelector<HTMLElement>(".logo")
	if (!holder) return
	holder.replaceChildren(
		...["WARUNG", "DESA"].map((word) => {
			const span = document.createElement("span")
			span.className = "word"
			;[...word].forEach((letter, index) => {
				const piece = document.createElement("span")
				piece.className = "letter"
				piece.textContent = letter
				piece.style.animationDelay = `${(index + (word === "DESA" ? 6 : 0)) * 0.11}s`
				span.append(piece)
			})
			return span
		}),
	)
}

/** Small plate icons for a name tag or the plate tray. */
export const miniPlate = (items: readonly Item[]) => items.map((item) => `<span class="mini">${icon(item)}</span>`).join("")
