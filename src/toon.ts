import {
	BackSide,
	type BufferGeometry,
	Color,
	DataTexture,
	LinearFilter,
	Mesh,
	MeshBasicMaterial,
	MeshToonMaterial,
	type MeshToonMaterialParameters,
	NearestFilter,
	RedFormat,
	SRGBColorSpace,
	CanvasTexture,
	RepeatWrapping,
} from "three"

/**
 * One look for every prop: hard-banded toon shading and a dark ink outline, the same as Plup, so the
 * whole warung reads as one drawing and not as a mascot dropped into a scene.
 */

let gradient: DataTexture | null = null
function bands() {
	if (gradient) return gradient
	gradient = new DataTexture(new Uint8Array([105, 175, 255]), 3, 1, RedFormat)
	gradient.minFilter = NearestFilter
	gradient.magFilter = NearestFilter
	gradient.needsUpdate = true
	return gradient
}

export function toon(color: string | number, extra: MeshToonMaterialParameters = {}) {
	return new MeshToonMaterial({ color: new Color(color), gradientMap: bands(), ...extra })
}

const INK = 0x1a1233

/** An inverted hull sized to the geometry's own bounds, so a thin plank gets a thin outline. */
export function outlined<T extends Mesh>(mesh: T, width = 0.03, color = INK): T {
	const geometry = mesh.geometry as BufferGeometry
	geometry.computeBoundingBox()
	const box = geometry.boundingBox
	if (!box) return mesh
	const size = { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z }
	const hull = new Mesh(geometry, new MeshBasicMaterial({ color, side: BackSide }))
	hull.scale.set(
		1 + (width * 2) / Math.max(size.x, 0.001),
		1 + (width * 2) / Math.max(size.y, 0.001),
		1 + (width * 2) / Math.max(size.z, 0.001),
	)
	hull.raycast = () => {}
	hull.castShadow = false
	mesh.add(hull)
	return mesh
}

export function canvasTexture(
	width: number,
	height: number,
	draw: (ctx: CanvasRenderingContext2D) => void,
	options: { repeat?: [number, number]; pixel?: boolean } = {},
) {
	const canvas = document.createElement("canvas")
	canvas.width = width
	canvas.height = height
	const ctx = canvas.getContext("2d")
	if (ctx) draw(ctx)
	const texture = new CanvasTexture(canvas)
	texture.colorSpace = SRGBColorSpace
	texture.wrapS = RepeatWrapping
	texture.wrapT = RepeatWrapping
	if (options.repeat) texture.repeat.set(...options.repeat)
	if (options.pixel) {
		texture.magFilter = NearestFilter
		texture.minFilter = NearestFilter
	} else texture.minFilter = LinearFilter
	return texture
}
