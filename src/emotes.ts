import { type ClipRef, type CustomClip, EMOTES, type Emote, emoteOf } from "@plupin/character"
import sorakAnim from "./emote-sorak.json"

/**
 * Emotes, the way a game plays them: an emote is data (a name, a face, a glyph, a clip). The free ones
 * ship with the character package (`EMOTES`); `emote-sorak` is the official animated listing, the same
 * keyframes the shop stores in `assetConfig.anim`. `plup.emote(name, custom)` plays any of them on the
 * 3D mascot. A game does not decide who may play a paid emote: the platform does.
 */

const SORAK: Emote = {
	id: "emote-sorak",
	label: "Sorak",
	glyph: "\\(^o^)/",
	face: "teriak",
	clip: "jump",
	anim: sorakAnim as CustomClip,
	sigmaPrice: 0,
}

/** A named emote, or undefined for one the package does not know. */
export function emote(name: string): Emote | undefined {
	return name === "sorak" || name === "emote-sorak" ? SORAK : emoteOf(name)
}

/** A clip the game authors itself, to show that a clip is only keyframes: a front-facing waddle. */
const STEPS = 8
export const WADDLE: CustomClip = {
	fps: 14,
	loop: true,
	bones: ["armL", "armR", "legL", "legR", "torso"],
	frames: Array.from({ length: STEPS }, (_, step) => {
		const swing = Math.sin((step / STEPS) * Math.PI * 2)
		return [
			0, 0, -0.12 - 0.5 * swing,
			0, 0, 0.12 - 0.5 * swing,
			0, 0, 0.32 * Math.max(0, swing),
			0, 0, 0.32 * Math.min(0, swing),
			0, 0, 0.1 * swing,
			Math.abs(swing) * 0.4,
		].map((value) => Math.round(value * 1000) / 1000)
	}),
}

/** How long one pass of an emote runs, in seconds. */
export function lengthOf(clip: ClipRef): number {
	return typeof clip === "string" ? 1.4 : clip.frames.length / clip.fps
}

export const FREE_EMOTES = [SORAK, ...EMOTES.filter((entry) => entry.sigmaPrice === 0)]
