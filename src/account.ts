import { connectPlayer, getPlayer, type PlayerProfile } from "@plupin/game-sdk"
import type { PlupSkin } from "@plupin/character/three"

/**
 * Who is playing: the Plupin account, not a name typed into this game. A player's look (the body
 * they picked, the colour, the skin they drew) and the emotes they own belong to the whole platform,
 * so the game reads them with `getPlayer()` and draws the player the way every other game does.
 *
 * Signed out, the game does not make up a guest: it asks the player to sign in to Plupin first.
 * `failed` (no platform to ask, as on a static server) is the only case that plays as a guest, so a
 * page opened outside Plupin still runs.
 */

export interface Me {
	name: string
	username: string | null
	badge: PlayerProfile["badge"]
	color: string
	shape: PlayerProfile["look"]["shape"]
	skin: PlupSkin | undefined
	emotes: string[]
	guest: boolean
}

export type Account = { status: "ok"; me: Me } | { status: "signin_required" } | { status: "guest"; me: Me }

const DEFAULT_COLOR = "#3d7bff"
const PALETTE = ["#3d7bff", "#ff8a4c", "#4cc98a", "#c39bff", "#ffd24d", "#ff6f91"]

export function fromProfile(player: PlayerProfile): Me {
	return {
		name: player.name,
		username: player.username,
		badge: player.badge,
		color: player.look.tint ?? player.outfitColor ?? DEFAULT_COLOR,
		shape: player.look.shape,
		skin: player.look.skin ? { body: player.look.skin.body, faceType: player.look.skin.face } : undefined,
		emotes: player.emotes,
		guest: false,
	}
}

export function guest(name: string): Me {
	const hash = [...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0)
	return { name, username: null, badge: null, color: PALETTE[hash % PALETTE.length] ?? DEFAULT_COLOR, shape: "plup", skin: undefined, emotes: [], guest: true }
}

export async function loadAccount(): Promise<Account> {
	const result = await getPlayer()
	if (result.status === "ok") return { status: "ok", me: fromProfile(result.player) }
	if (result.status === "signin_required") return { status: "signin_required" }
	return { status: "guest", me: guest(`tamu-${Math.floor(Math.random() * 900 + 100)}`) }
}

/** One click on the platform's own page: sign in there if needed, and say this game may see who you are. */
export async function signIn(): Promise<Account> {
	const connected = await connectPlayer()
	if (connected.status !== "connected") return { status: "signin_required" }
	return loadAccount()
}

/** The platform's origin, from the game's own address (`warung-desa.plupin.com` -> `plupin.com`). */
export function platformOrigin(gameId: string): string {
	const here = new URL(location.href)
	if (here.hostname.startsWith(`${gameId}.`)) return `${here.protocol}//${here.hostname.slice(gameId.length + 1)}${here.port ? `:${here.port}` : ""}`
	return here.origin
}

/** Where to add a player as a friend: the platform's friends page with the name filled in. */
export const friendLink = (gameId: string, username: string) => `${platformOrigin(gameId)}/friends?add=${encodeURIComponent(username)}`
