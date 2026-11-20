import { Peers, Room } from "@plupin/game-sdk"
import type { GameEvent, Seat, State, Target } from "./game"

/**
 * Everything that touches the room, and nothing that decides a rule. Authority here is "host": one
 * elected seat runs the rules in game.ts and publishes the world; everyone else sends taps and draws
 * what arrives. That is the right tier for a game nobody pays for the outcome of. (A result another
 * player or the economy depends on, like a leaderboard score, needs "server": see the README.)
 *
 * Frames on the wire, all small:
 *   pose    every seat, 12 Hz     { x, e, n }       where I stand, the emote I play, its counter
 *   tap     any seat -> the host  { target }        an intent, never a result
 *   world   the host, 6 Hz        { state }         the whole shared state
 *   events  the host, on change   { events }        what just happened, for the screen to react to
 */

export const POSE_HZ = 12
export const WORLD_HZ = 6

export interface Pose {
	x: number
	/** The emote this seat is playing, or null. */
	e: string | null
	/** Bumps on every new emote, so the same one twice in a row still restarts. */
	n: number
	/** The name to print under the character. */
	name: string
	color: string
}

export interface Remote {
	seat: Seat
	name: string
	color: string
	x: number
	emote: string | null
	n: number
}

export class Net {
	readonly room: Room
	readonly remotes = new Map<Seat, Remote>()
	private readonly peers: Peers<Pose>
	private leader: Seat | null = null
	onTap: (seat: Seat, target: Target) => void = () => {}
	onWorld: (state: State) => void = () => {}
	onEvents: (events: GameEvent[]) => void = () => {}
	onHost: (host: boolean) => void = () => {}
	onRemoteEmote: (seat: Seat, emote: string) => void = () => {}
	onLeave: (seat: Seat) => void = () => {}

	constructor(gameId: string, name: string, party?: string) {
		// A party code (`?p=` on a link from the Plupin lobby) seats this player in the room the party opened.
		this.room = new Room({ gameId, name, authority: "host", ...(party ? { party } : {}) })
		this.peers = new Peers<Pose>({
			blend: (a, b, t) => ({ x: a.x + (b.x - a.x) * t, e: b.e, n: b.n, name: b.name, color: b.color }),
			create: (seat) => void this.remotes.set(seat, { seat, name: seat.slice(-4), color: "#3d7bff", x: 0, emote: null, n: 0 }),
			update: (seat, pose) => {
				const remote = this.remotes.get(seat)
				if (!remote) return
				remote.x = pose.x
				remote.name = pose.name
				remote.color = pose.color
				if (pose.e && pose.n !== remote.n) this.onRemoteEmote(seat, pose.e)
				remote.emote = pose.e
				remote.n = pose.n
			},
			remove: (seat) => {
				this.remotes.delete(seat)
				this.onLeave(seat)
			},
		})
		this.room.on("relay", ({ frame }) => {
			if (frame.from === this.room.seatId) return
			const data = frame.data as Record<string, unknown>
			if (frame.kind === "pose") this.peers.push(frame.from, performance.now(), data as unknown as Pose)
			else if (frame.kind === "tap" && this.isHost) this.onTap(frame.from, data.target as Target)
			else if (frame.kind === "world") this.onWorld(data.state as State)
			else if (frame.kind === "events") this.onEvents(data.events as GameEvent[])
		})
		// `connect()` resolves before the host is elected: only this event says who it is.
		this.room.on("host", ({ seat }) => {
			this.leader = seat
			this.onHost(this.isHost)
		})
	}

	/** Never throws: a page with no room (a static server, say) plays solo. */
	async connect(): Promise<boolean> {
		try {
			await this.room.connect()
			return true
		} catch (error) {
			console.warn("warung-desa: no room, playing solo", error)
			return false
		}
	}

	/** The elected host's seat, once the room has said who it is. */
	get hostSeat(): Seat | null {
		return this.leader
	}
	get joined(): boolean {
		return this.room.state === "joined"
	}
	get seat(): Seat {
		return this.room.seatId ?? "you"
	}
	get isHost(): boolean {
		return this.leader !== null && this.leader === this.room.seatId
	}
	/** Players at the stall, me included. */
	get players(): number {
		return 1 + this.remotes.size
	}

	sample(now: number) {
		this.peers.sample(now)
	}
	sendPose(pose: Pose) {
		if (this.joined) this.room.broadcast("pose", pose)
	}
	sendTap(target: Target) {
		if (this.joined) this.room.broadcast("tap", { target })
	}
	publishWorld(state: State) {
		if (this.joined) this.room.broadcast("world", { state })
	}
	publishEvents(events: GameEvent[]) {
		if (this.joined && events.length > 0) this.room.broadcast("events", { events })
	}
}
