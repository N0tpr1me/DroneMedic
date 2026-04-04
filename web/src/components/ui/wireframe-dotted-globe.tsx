import { useEffect, useRef, useState } from "react"
import * as d3 from "d3"

// Medical delivery route nodes (cities with drone hubs)
const ROUTE_NODES: Array<{ name: string; coords: [number, number] }> = [
  { name: "London", coords: [-0.1278, 51.5074] },
  { name: "Paris", coords: [2.3522, 48.8566] },
  { name: "Nairobi", coords: [36.8219, -1.2921] },
  { name: "Mumbai", coords: [72.8777, 19.0760] },
  { name: "Tokyo", coords: [139.6503, 35.6762] },
  { name: "Sydney", coords: [151.2093, -33.8688] },
  { name: "New York", coords: [-74.0060, 40.7128] },
  { name: "Sao Paulo", coords: [-46.6333, -23.5505] },
  { name: "Lagos", coords: [3.3792, 6.5244] },
  { name: "Dubai", coords: [55.2708, 25.2048] },
]

// Route connections (pairs of node indices)
const ROUTES: Array<[number, number]> = [
  [0, 1], [0, 2], [1, 3], [2, 8], [3, 4],
  [4, 5], [6, 0], [6, 7], [7, 8], [3, 9],
  [9, 2], [8, 2], [5, 3],
]

interface RotatingGlobeProps {
  className?: string
}

export default function RotatingGlobe({ className = "" }: RotatingGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return

    const canvas = canvasRef.current
    const context = canvas.getContext("2d")
    if (!context) return

    let containerWidth = containerRef.current.clientWidth
    let containerHeight = containerRef.current.clientHeight
    let radius = Math.min(containerWidth, containerHeight) / 2.2

    const dpr = window.devicePixelRatio || 1
    canvas.width = containerWidth * dpr
    canvas.height = containerHeight * dpr
    canvas.style.width = `${containerWidth}px`
    canvas.style.height = `${containerHeight}px`
    context.scale(dpr, dpr)

    const projection = d3
      .geoOrthographic()
      .scale(radius)
      .translate([containerWidth * 0.5, containerHeight * 0.5])
      .clipAngle(90)

    const resizeCanvas = () => {
      if (!containerRef.current) return
      containerWidth = containerRef.current.clientWidth
      containerHeight = containerRef.current.clientHeight
      radius = Math.min(containerWidth, containerHeight) / 2.2

      canvas.width = containerWidth * dpr
      canvas.height = containerHeight * dpr
      canvas.style.width = `${containerWidth}px`
      canvas.style.height = `${containerHeight}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)

      projection
        .scale(radius)
        .translate([containerWidth * 0.5, containerHeight * 0.5])
    }

    const resizeObserver = new ResizeObserver(() => resizeCanvas())
    resizeObserver.observe(containerRef.current)

    const path = d3.geoPath().projection(projection).context(context)

    // Point-in-polygon for land dot generation
    const pointInPolygon = (point: [number, number], polygon: number[][]): boolean => {
      const [x, y] = point
      let inside = false
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i]
        const [xj, yj] = polygon[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
      }
      return inside
    }

    const pointInFeature = (point: [number, number], feature: d3.GeoPermissibleObjects & { geometry: { type: string; coordinates: number[][][] | number[][][][] } }): boolean => {
      const geometry = feature.geometry
      if (geometry.type === "Polygon") {
        if (!pointInPolygon(point, geometry.coordinates[0] as number[][])) return false
        for (let i = 1; i < geometry.coordinates.length; i++) {
          if (pointInPolygon(point, geometry.coordinates[i] as number[][])) return false
        }
        return true
      } else if (geometry.type === "MultiPolygon") {
        for (const polygon of geometry.coordinates as number[][][][]) {
          if (pointInPolygon(point, polygon[0])) {
            let inHole = false
            for (let i = 1; i < polygon.length; i++) {
              if (pointInPolygon(point, polygon[i])) { inHole = true; break }
            }
            if (!inHole) return true
          }
        }
      }
      return false
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const generateDotsInPolygon = (feature: any, dotSpacing = 16) => {
      const dots: [number, number][] = []
      const bounds = d3.geoBounds(feature)
      const [[minLng, minLat], [maxLng, maxLat]] = bounds
      const stepSize = dotSpacing * 0.08
      for (let lng = minLng; lng <= maxLng; lng += stepSize) {
        for (let lat = minLat; lat <= maxLat; lat += stepSize) {
          const point: [number, number] = [lng, lat]
          if (pointInFeature(point, feature)) dots.push(point)
        }
      }
      return dots
    }

    interface DotData { lng: number; lat: number }

    const allDots: DotData[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let landFeatures: any

    // Traveling dots state
    interface TravelingDot {
      routeIndex: number
      progress: number // 0-1
      speed: number
      forward: boolean // direction
    }

    const travelingDots: TravelingDot[] = ROUTES.map((_, i) => ({
      routeIndex: i,
      progress: Math.random(), // start at random position
      speed: 0.0008 + Math.random() * 0.001,
      forward: Math.random() > 0.5,
    }))

    // Interpolate great circle arc between two points
    const interpolateArc = (from: [number, number], to: [number, number], t: number): [number, number] => {
      const interp = d3.geoInterpolate(from, to)
      return interp(t)
    }

    const render = (time: number) => {
      context.clearRect(0, 0, containerWidth, containerHeight)

      const currentScale = projection.scale()
      const scaleFactor = currentScale / radius

      // Globe background
      context.beginPath()
      context.arc(containerWidth * 0.5, containerHeight * 0.5, currentScale, 0, 2 * Math.PI)
      context.fillStyle = "#06060f"
      context.fill()
      context.strokeStyle = "rgba(0, 218, 243, 0.15)"
      context.lineWidth = 1.5 * scaleFactor
      context.stroke()

      if (landFeatures) {
        // Graticule
        const graticule = d3.geoGraticule()
        context.beginPath()
        path(graticule())
        context.strokeStyle = "rgba(179, 197, 255, 0.08)"
        context.lineWidth = 0.5 * scaleFactor
        context.stroke()

        // Land outlines
        context.beginPath()
        landFeatures.features.forEach((feature: d3.GeoPermissibleObjects) => { path(feature) })
        context.strokeStyle = "rgba(0, 218, 243, 0.35)"
        context.lineWidth = 0.9 * scaleFactor
        context.stroke()

        // Land halftone dots
        allDots.forEach((dot) => {
          const projected = projection([dot.lng, dot.lat])
          if (projected && projected[0] >= 0 && projected[0] <= containerWidth && projected[1] >= 0 && projected[1] <= containerHeight) {
            context.beginPath()
            context.arc(projected[0], projected[1], 1 * scaleFactor, 0, 2 * Math.PI)
            context.fillStyle = "rgba(179, 197, 255, 0.38)"
            context.fill()
          }
        })

        // Route arcs
        ROUTES.forEach(([fromIdx, toIdx]) => {
          const from = ROUTE_NODES[fromIdx].coords
          const to = ROUTE_NODES[toIdx].coords
          const segments = 50
          let started = false
          for (let i = 0; i <= segments; i++) {
            const t = i / segments
            const point = interpolateArc(from, to, t)
            const projected = projection(point)
            if (projected) {
              if (!started) { context.beginPath(); context.moveTo(projected[0], projected[1]); started = true }
              else context.lineTo(projected[0], projected[1])
            } else if (started) {
              context.strokeStyle = "rgba(0, 218, 243, 0.12)"
              context.lineWidth = 1 * scaleFactor
              context.stroke()
              started = false
            }
          }
          if (started) {
            context.strokeStyle = "rgba(0, 218, 243, 0.12)"
            context.lineWidth = 1 * scaleFactor
            context.stroke()
          }
        })

        // Route node markers
        ROUTE_NODES.forEach((node) => {
          const projected = projection(node.coords)
          if (projected) {
            // Outer glow
            context.beginPath()
            context.arc(projected[0], projected[1], 4 * scaleFactor, 0, 2 * Math.PI)
            context.fillStyle = "rgba(0, 218, 243, 0.15)"
            context.fill()
            // Inner dot
            context.beginPath()
            context.arc(projected[0], projected[1], 2 * scaleFactor, 0, 2 * Math.PI)
            context.fillStyle = "#00daf3"
            context.fill()
          }
        })

        // Traveling dots — animate along routes
        travelingDots.forEach((dot) => {
          const [fromIdx, toIdx] = ROUTES[dot.routeIndex]
          const from = ROUTE_NODES[fromIdx].coords
          const to = ROUTE_NODES[toIdx].coords
          const point = dot.forward ? interpolateArc(from, to, dot.progress) : interpolateArc(to, from, dot.progress)
          const projected = projection(point)

          if (projected) {
            // Glow trail
            const glowSize = 6 + Math.sin(time * 0.003) * 2
            context.beginPath()
            context.arc(projected[0], projected[1], glowSize * scaleFactor, 0, 2 * Math.PI)
            context.fillStyle = "rgba(0, 218, 243, 0.15)"
            context.fill()

            // Bright dot
            context.beginPath()
            context.arc(projected[0], projected[1], 2.5 * scaleFactor, 0, 2 * Math.PI)
            context.fillStyle = "#00daf3"
            context.shadowColor = "#00daf3"
            context.shadowBlur = 8
            context.fill()
            context.shadowBlur = 0
          }

          // Advance position
          dot.progress += dot.speed
          if (dot.progress >= 1) {
            dot.progress = 0
            dot.forward = !dot.forward // bounce back
          }
        })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loadWorldData = async () => {
      try {
        setIsLoading(true)
        const response = await fetch(
          "https://raw.githubusercontent.com/martynafford/natural-earth-geojson/refs/heads/master/110m/physical/ne_110m_land.json",
        )
        if (!response.ok) throw new Error("Failed to load land data")
        landFeatures = await response.json()

        landFeatures.features.forEach((feature: d3.GeoPermissibleObjects) => {
          const dots = generateDotsInPolygon(feature, 16)
          dots.forEach(([lng, lat]) => allDots.push({ lng, lat }))
        })

        setIsLoading(false)
      } catch {
        setIsLoading(false)
      }
    }

    // Rotation and interaction
    const rotation: [number, number] = [0, 0]
    let autoRotate = true
    const rotationSpeed = 0.075

    let animFrame: number
    const animate = (time: number) => {
      if (autoRotate) {
        rotation[0] += rotationSpeed
        projection.rotate(rotation)
      }
      render(time)
      animFrame = requestAnimationFrame(animate)
    }

    const handleMouseDown = (event: MouseEvent) => {
      autoRotate = false
      const startX = event.clientX
      const startY = event.clientY
      const startRotation: [number, number] = [...rotation]

      const handleMouseMove = (e: MouseEvent) => {
        rotation[0] = startRotation[0] + (e.clientX - startX) * 0.5
        rotation[1] = Math.max(-90, Math.min(90, startRotation[1] - (e.clientY - startY) * 0.5))
        projection.rotate(rotation)
      }

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
        setTimeout(() => { autoRotate = true }, 10)
      }

      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
    }

    canvas.addEventListener("mousedown", handleMouseDown)

    loadWorldData()
    animFrame = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animFrame)
      resizeObserver.disconnect()
      canvas.removeEventListener("mousedown", handleMouseDown)
    }
  }, [])

  return (
    <div ref={containerRef} className={`relative w-full h-full ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div style={{ width: 24, height: 24, border: '2px solid #00daf3', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ cursor: 'grab' }}
      />
    </div>
  )
}
