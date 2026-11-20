/**
 * Sound, made in the browser: a looping marimba-and-shaker tune and the effects, all synthesised with
 * the Web Audio API, so the game ships no audio files and weighs what it weighs. The context starts
 * on the first tap (browsers refuse earlier); a mute switch is remembered.
 */

const KEY = "warung-desa:mute"
// A pentatonic scale (C D E G A), so any note over any chord is pleasant.
const SCALE = [0, 2, 4, 7, 9]
const hz = (semitonesFromA4: number) => 440 * 2 ** (semitonesFromA4 / 12)
const note = (degree: number, octave = 0) => {
	const step = SCALE[((degree % 5) + 5) % 5] ?? 0
	// C4 is -9 from A4.
	return hz(-9 + step + Math.floor(degree / 5) * 12 + octave * 12)
}

// Two bars of melody as scale degrees (null = rest), over a four-chord bass.
const MELODY: (number | null)[] = [7, null, 8, 7, 4, null, 5, null, 7, null, 9, 8, 7, 5, 4, null, 5, null, 7, 8, 9, null, 8, 7, 5, 4, 5, null, 3, null, 4, null]
const BASS = [-14, -17, -12, -19]

class Sound {
	private ctx: AudioContext | null = null
	private master: GainNode | null = null
	private noise: AudioBuffer | null = null
	private timer = 0
	private nextStep = 0
	private step = 0
	muted = (() => {
		try {
			return localStorage.getItem(KEY) === "1"
		} catch {
			return false
		}
	})()
	private tempo = 104
	private playing = false

	/** Call from a tap: starts (or resumes) the audio context. */
	unlock() {
		if (!this.ctx) {
			const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
			if (!Ctx) return
			this.ctx = new Ctx()
			this.master = this.ctx.createGain()
			this.master.gain.value = this.muted ? 0 : 0.8
			this.master.connect(this.ctx.destination)
			const length = this.ctx.sampleRate
			this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
			const data = this.noise.getChannelData(0)
			for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
		}
		if (this.ctx.state === "suspended") void this.ctx.resume()
	}

	setMuted(value: boolean) {
		this.muted = value
		try {
			localStorage.setItem(KEY, value ? "1" : "0")
		} catch {
			// no storage: the switch still works for this visit
		}
		if (this.master && this.ctx) this.master.gain.setTargetAtTime(value ? 0 : 0.8, this.ctx.currentTime, 0.05)
	}

	private tone(freq: number, start: number, length: number, type: OscillatorType, volume: number, slideTo?: number) {
		if (!this.ctx || !this.master) return
		const osc = this.ctx.createOscillator()
		const gain = this.ctx.createGain()
		osc.type = type
		osc.frequency.setValueAtTime(freq, start)
		if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + length)
		gain.gain.setValueAtTime(0.0001, start)
		gain.gain.exponentialRampToValueAtTime(volume, start + 0.008)
		gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
		osc.connect(gain).connect(this.master)
		osc.start(start)
		osc.stop(start + length + 0.05)
	}

	private burst(start: number, length: number, volume: number, filter: BiquadFilterType, freq: number, sweepTo?: number) {
		if (!this.ctx || !this.master || !this.noise) return
		const source = this.ctx.createBufferSource()
		source.buffer = this.noise
		const biquad = this.ctx.createBiquadFilter()
		biquad.type = filter
		biquad.frequency.setValueAtTime(freq, start)
		if (sweepTo) biquad.frequency.exponentialRampToValueAtTime(sweepTo, start + length)
		const gain = this.ctx.createGain()
		gain.gain.setValueAtTime(volume, start)
		gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
		source.connect(biquad).connect(gain).connect(this.master)
		source.start(start)
		source.stop(start + length + 0.05)
	}

	// ---- the tune ----
	private schedule() {
		if (!this.ctx) return
		const stepLength = 60 / this.tempo / 2
		while (this.nextStep < this.ctx.currentTime + 0.15) {
			const at = this.nextStep
			const degree = MELODY[this.step % MELODY.length]
			if (degree != null) {
				// A kalimba-ish pluck: a sine and its octave, quick decay.
				this.tone(note(degree), at, 0.42, "sine", 0.1)
				this.tone(note(degree, 1), at, 0.18, "triangle", 0.035)
			}
			if (this.step % 8 === 0) this.tone(hz(BASS[(this.step / 8) % BASS.length] ?? -14), at, 0.9, "triangle", 0.12)
			if (this.step % 4 === 0) this.tone(70, at, 0.14, "sine", 0.16, 40)
			if (this.step % 2 === 1) this.burst(at, 0.05, 0.05, "highpass", 6000)
			this.step += 1
			this.nextStep += stepLength
		}
	}

	startMusic(tempo = 104) {
		this.tempo = tempo
		if (!this.ctx || this.playing) return
		this.playing = true
		this.nextStep = this.ctx.currentTime + 0.05
		this.step = 0
		this.timer = window.setInterval(() => this.schedule(), 40)
	}

	/** Faster for the last seconds. */
	setTempo(tempo: number) {
		this.tempo = tempo
	}

	stopMusic() {
		this.playing = false
		window.clearInterval(this.timer)
	}

	// ---- effects ----
	private at() {
		return this.ctx ? this.ctx.currentTime : 0
	}
	click() {
		this.tone(620, this.at(), 0.07, "square", 0.05, 420)
	}
	pick(index = 0) {
		const t = this.at()
		this.tone(note(5 + index * 2), t, 0.12, "triangle", 0.12)
		this.burst(t, 0.06, 0.06, "bandpass", 2200)
	}
	sizzleStart() {
		const t = this.at()
		this.burst(t, 0.7, 0.14, "bandpass", 3500, 1800)
		this.tone(160, t, 0.12, "sine", 0.14, 90)
	}
	ready() {
		const t = this.at()
		this.tone(hz(15), t, 0.5, "sine", 0.16)
		this.tone(hz(19), t + 0.001, 0.5, "sine", 0.1)
		this.tone(hz(27), t + 0.001, 0.4, "sine", 0.05)
	}
	toss() {
		const t = this.at()
		this.burst(t, 0.18, 0.1, "bandpass", 900, 3200)
	}
	coin(rise = 0) {
		const t = this.at()
		this.tone(note(10 + rise), t, 0.09, "square", 0.07)
		this.tone(note(15 + rise), t + 0.07, 0.22, "square", 0.07)
	}
	serve() {
		const t = this.at()
		this.burst(t, 0.22, 0.09, "bandpass", 600, 2600)
		this.coin()
		this.tone(note(12), t + 0.13, 0.3, "triangle", 0.09)
	}
	wrong() {
		const t = this.at()
		this.tone(150, t, 0.3, "sawtooth", 0.12, 70)
		this.tone(110, t + 0.04, 0.3, "square", 0.07, 55)
	}
	left() {
		const t = this.at()
		this.tone(note(4), t, 0.18, "triangle", 0.12, note(1))
		this.tone(note(1), t + 0.16, 0.3, "triangle", 0.12, note(-2))
	}
	tick(final = false) {
		this.tone(final ? 1100 : 800, this.at(), 0.05, "square", final ? 0.09 : 0.05)
	}
	start() {
		const t = this.at()
		;[0, 2, 4, 7].forEach((degree, i) => this.tone(note(degree + 5), t + i * 0.08, 0.2, "triangle", 0.12))
	}
	star(index: number) {
		const t = this.at()
		this.tone(note(7 + index * 2), t, 0.5, "triangle", 0.15)
		this.tone(note(7 + index * 2, 1), t, 0.4, "sine", 0.08)
	}
	fanfare() {
		const t = this.at()
		;[0, 2, 4, 7, 9, 12].forEach((degree, i) => this.tone(note(degree + 5), t + i * 0.09, 0.35, "triangle", 0.13))
	}
	pop() {
		this.tone(420, this.at(), 0.1, "sine", 0.1, 800)
	}
}

export const sound = new Sound()
