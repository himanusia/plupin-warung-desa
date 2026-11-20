import { readFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { defineConfig, type PluginOption } from "vite"

/**
 * `base: "./"` so every asset is relative (the game is served under its own address), and
 * `plupin.json` is copied into the build output. The bundle size is printed because it is the one
 * number nobody asks a browser for until it is too late.
 */
function emitManifest(): PluginOption {
	return {
		name: "emit-plupin-manifest",
		generateBundle() {
			this.emitFile({ type: "asset", fileName: "plupin.json", source: readFileSync("plupin.json", "utf8") })
		},
	}
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`

function reportBundleSize(): PluginOption {
	return {
		name: "warung-desa-report-bundle-size",
		apply: "build",
		generateBundle(_options, bundle) {
			let raw = 0
			let gzip = 0
			const rows: string[] = []
			for (const [fileName, output] of Object.entries(bundle)) {
				const source = output.type === "chunk" ? output.code : output.source
				const bytes = Buffer.byteLength(source)
				const zipped = gzipSync(source).length
				raw += bytes
				gzip += zipped
				rows.push(`    ${fileName.padEnd(28)} ${kb(bytes).padStart(11)} ${kb(zipped).padStart(11)}`)
			}
			rows.push(`    ${"total".padEnd(28)} ${kb(raw).padStart(11)} ${kb(gzip).padStart(11)}`)
			this.warn(["bundle size (raw / gzip over the wire)", ...rows].join("\n"))
		},
	}
}

export default defineConfig({
	base: "./",
	build: { target: "es2022", assetsInlineLimit: 0, modulePreload: { polyfill: false } },
	// One copy of three: the character package takes it as a peer, so the game's copy is the scene's.
	resolve: { dedupe: ["three"] },
	plugins: [emitManifest(), reportBundleSize()],
})
