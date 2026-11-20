import { rollPlatformRandom } from "@plupin/game-sdk"
import { RECIPES } from "./game"

/**
 * Today's special, from the platform's random number and not from `Math.random`.
 *
 * A free roll that only decorates the game could use its own generator, but a player can argue a
 * result was the game's to choose; the platform keeps the roll and the offset, so there is an answer.
 * The call never throws. A spent budget or a lost connection is a status, and the game then simply has
 * no special that shift: a missing bonus is better than a blocked round.
 */
export async function rollSpecial(): Promise<string | null> {
	const result = await rollPlatformRandom(RECIPES.map(() => 1))
	if (result.status !== "ok") return null
	return RECIPES[result.index]?.id ?? null
}
