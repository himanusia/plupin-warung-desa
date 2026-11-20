import { type ClipRef, type CustomClip, EMOTES, type Emote, emoteOf } from "@plupin/character"
import sorakAnim from "./emote-sorak.json"

/**
 * Emotes, the way a game plays them.
 *
 * An emote is data: a name, a face, a glyph and a clip. The free ones ship with the character
 * package (`EMOTES`); a creator's or the platform's own animated one is a listing whose
 * `assetConfig.anim` is plain keyframes, which is what `emote-sorak.json` below is: the exact
 * animation the official Plupin account sells in the shop (`emote-sorak`). A game does not decide
 * who may play a paid emote: the platform does, from what the player owns. Here every emote the
 * game plays is a free one, so it can play them all.
 */

export interface Playing {
	emote: Emote
	/** What the rig performs: the emote's own keyframes, or a clip it already has. */
	clip: ClipRef
	startedAt: number
	seconds: number
}

/** The official animated emote, as the listing stores it. */
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

/**
 * A clip a game authors itself, to show that a clip is only keyframes: a front-facing waddle (legs
 * alternate out to the side, arms swing, the body bobs) because the stock `walk` swings forward and
 * back, which a front view cannot show. Frame = x, y, z for each bone in `bones`, then lift.
 */
const WADDLE_STEPS = 8
export const WADDLE: CustomClip = {
	fps: 14,
	loop: true,
	bones: ["armL", "armR", "legL", "legR", "torso"],
	frames: Array.from({ length: WADDLE_STEPS }, (_, step) => {
		const swing = Math.sin((step / WADDLE_STEPS) * Math.PI * 2)
		return [
			0, 0, -0.12 - 0.35 * swing, // armL
			0, 0, 0.12 - 0.35 * swing, // armR
			0, 0, 0.32 * Math.max(0, swing), // legL
			0, 0, 0.32 * Math.min(0, swing), // legR
			0, 0, 0.1 * swing, // torso sways with the step
			Math.abs(swing) * 0.22, // lift: a little bounce on each foot
		].map((value) => Math.round(value * 1000) / 1000)
	}),
}

/** How long one pass of an emote runs, in seconds. */
export function lengthOf(clip: ClipRef): number {
	return typeof clip === "string" ? 1.4 : clip.frames.length / clip.fps
}

export function play(name: string, now: number): Playing | undefined {
	const found = emote(name)
	if (!found) return undefined
	const clip = found.anim ?? found.clip
	return { emote: found, clip, startedAt: now, seconds: lengthOf(clip) }
}

/** Every free emote this game can reach, for the README and the tests. */
export const FREE_EMOTES = [SORAK, ...EMOTES.filter((entry) => entry.sigmaPrice === 0)]
