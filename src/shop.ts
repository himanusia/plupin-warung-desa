import { getEntitlements, requestPurchase } from "@plupin/game-sdk"

/**
 * One permanent product, declared in plupin.json: a gold apron.
 *
 * The game never spends Sigma and never decides a price: `requestPurchase` opens the platform's own
 * confirmation page, and what the player really owns is read back with `getEntitlements`, never taken
 * from the purchase result (a page's own scripts can fake that). The apron is cosmetic, so reading the
 * platform's record is all the protection it needs.
 */
export const APRON = "celemek-emas"
export const APRON_PRICE = 20

/** Whether this player holds the apron. False when signed out or when the read failed. */
export async function ownsApron(): Promise<boolean> {
	const held = await getEntitlements()
	return held.status === "ok" && held.items.some((item) => item.sku === APRON)
}

/** Must be called from a click: the confirmation opens in a window the browser would otherwise block. */
export async function buyApron(): Promise<"owned" | "canceled" | "failed"> {
	const result = await requestPurchase(APRON)
	if (result.status === "canceled") return "canceled"
	if (result.status === "failed") return "failed"
	return (await ownsApron()) ? "owned" : "failed"
}
