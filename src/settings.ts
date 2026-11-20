/**
 * The player's settings, remembered between visits: audio, graphics and the helpers. One small store
 * with subscribers, so a slider in the panel and the engine that reads it never drift apart.
 */

export type Quality = "rendah" | "sedang" | "tinggi"

export interface Settings {
	/** 0 to 1. */
	music: number
	/** 0 to 1. */
	sfx: number
	quality: Quality
	/** Camera shake and hit-stop; off for people who feel ill from them. */
	shake: boolean
	/** The next-step hints and the pointer on what to tap. */
	hints: boolean
	/** The first-run walkthrough has been seen. */
	tutorialDone: boolean
}

const KEY = "warung-desa:settings"
const DEFAULTS: Settings = { music: 0.7, sfx: 0.9, quality: "tinggi", shake: true, hints: true, tutorialDone: false }

function load(): Settings {
	try {
		const raw = localStorage.getItem(KEY)
		if (!raw) return { ...DEFAULTS }
		const parsed = JSON.parse(raw) as Partial<Settings>
		const clamp = (value: unknown, fallback: number) =>
			typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
		return {
			music: clamp(parsed.music, DEFAULTS.music),
			sfx: clamp(parsed.sfx, DEFAULTS.sfx),
			quality: parsed.quality === "rendah" || parsed.quality === "sedang" || parsed.quality === "tinggi" ? parsed.quality : DEFAULTS.quality,
			shake: parsed.shake !== false,
			hints: parsed.hints !== false,
			tutorialDone: parsed.tutorialDone === true,
		}
	} catch {
		return { ...DEFAULTS }
	}
}

let current = load()
const listeners = new Set<(settings: Settings) => void>()

export const settings = (): Readonly<Settings> => current

export function update(patch: Partial<Settings>) {
	current = { ...current, ...patch }
	try {
		localStorage.setItem(KEY, JSON.stringify(current))
	} catch {
		// no storage: the choice lasts for this visit
	}
	for (const listener of listeners) listener(current)
}

export function onSettings(listener: (settings: Settings) => void): () => void {
	listeners.add(listener)
	listener(current)
	return () => listeners.delete(listener)
}

/** What each quality level costs: pixel ratio cap, shadows, particle share. */
export const QUALITY = {
	rendah: { pixelRatio: 1, shadows: false, particles: 0.35 },
	sedang: { pixelRatio: 1.5, shadows: true, particles: 0.7 },
	tinggi: { pixelRatio: 2, shadows: true, particles: 1 },
} as const
