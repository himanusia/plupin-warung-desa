import { AppError, Leaderboard } from "@plupin/game-sdk"

/**
 * The shift's coins, read from the board `plupin.json` declares.
 *
 * The SDK has no `submit`: a score is written by the room that finished a match under the platform's
 * own rules (a turn-based document), so a game running its own rules cannot write one and a client
 * cannot spoof one. This game runs its rules on the host, so its board shows what the platform holds
 * and is empty until a refereed mode exists. Reading it is still the example: `top`, `me`, `around`.
 */
export async function topCoins(gameId: string): Promise<{ name: string; score: number; you: boolean }[]> {
	try {
		const page = await new Leaderboard({ gameId, board: "koin" }).top(5)
		return page.entries.map((entry) => ({ name: entry.name, score: entry.score, you: entry.you }))
	} catch (error) {
		if (!(error instanceof AppError)) console.warn("warung-desa: leaderboard", error)
		return []
	}
}
