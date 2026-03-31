import { useEffect, useRef } from "react"

interface StarfieldProps {
  className?: string
}

interface ShootingStar {
  x: number
  y: number
  length: number
  speed: number
  angle: number
  opacity: number
  life: number
  maxLife: number
}

export default function Starfield({ className = "" }: StarfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    let width = containerRef.current.clientWidth
    let height = containerRef.current.clientHeight

    const resize = () => {
      if (!containerRef.current) return
      width = containerRef.current.clientWidth
      height = containerRef.current.clientHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()

    const resizeObserver = new ResizeObserver(() => resize())
    resizeObserver.observe(containerRef.current)

    // Fewer, slower stars
    const starCount = 100
    const stars = Array.from({ length: starCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 1.5 + 0.5,
      speed: Math.random() * 0.1 + 0.02,
      opacity: Math.random() * 0.5 + 0.15,
      twinkleSpeed: Math.random() * 0.01 + 0.003,
      twinkleOffset: Math.random() * Math.PI * 2,
    }))

    // Shooting stars
    const shootingStars: ShootingStar[] = []
    let lastShootingStarTime = 0

    const spawnShootingStar = (time: number) => {
      const angle = Math.random() * Math.PI * 2 // any direction
      // Spawn from a random edge or random spot
      const spawnX = Math.random() * width
      const spawnY = Math.random() * height
      shootingStars.push({
        x: spawnX,
        y: spawnY,
        length: 250 + Math.random() * 200,
        speed: 1.5 + Math.random() * 1,
        angle,
        opacity: 0.7 + Math.random() * 0.3,
        life: 0,
        maxLife: 160 + Math.random() * 100,
      })
      lastShootingStarTime = time
    }

    let animFrame: number

    const animate = (time: number) => {
      ctx.clearRect(0, 0, width, height)

      // Draw stars
      stars.forEach((star) => {
        const twinkle = Math.sin(time * star.twinkleSpeed + star.twinkleOffset) * 0.3 + 0.7
        const alpha = star.opacity * twinkle

        ctx.beginPath()
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(179, 197, 255, ${alpha})`
        ctx.fill()

        // Subtle drift
        star.y -= star.speed
        star.x += Math.sin(time * 0.0003 + star.twinkleOffset) * 0.05

        // Wrap around
        if (star.y < -2) {
          star.y = height + 2
          star.x = Math.random() * width
        }
        if (star.x < -2) star.x = width + 2
        if (star.x > width + 2) star.x = -2
      })

      // Spawn shooting stars occasionally (every 3-7 seconds)
      if (time - lastShootingStarTime > 3000 + Math.random() * 4000) {
        spawnShootingStar(time)
      }

      // Draw shooting stars
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const s = shootingStars[i]
        s.life++

        const progress = s.life / s.maxLife
        // Fade in then out
        const fadeAlpha = progress < 0.2
          ? progress / 0.2
          : 1 - (progress - 0.2) / 0.8
        const alpha = s.opacity * Math.max(0, fadeAlpha)

        const tailX = s.x - Math.cos(s.angle) * s.length * (1 - progress * 0.5)
        const tailY = s.y - Math.sin(s.angle) * s.length * (1 - progress * 0.5)

        // Gradient trail
        const gradient = ctx.createLinearGradient(tailX, tailY, s.x, s.y)
        gradient.addColorStop(0, `rgba(179, 197, 255, 0)`)
        gradient.addColorStop(0.6, `rgba(200, 215, 255, ${alpha * 0.4})`)
        gradient.addColorStop(1, `rgba(255, 255, 255, ${alpha})`)

        ctx.beginPath()
        ctx.moveTo(tailX, tailY)
        ctx.lineTo(s.x, s.y)
        ctx.strokeStyle = gradient
        ctx.lineWidth = 1.5
        ctx.stroke()

        // Bright head
        ctx.beginPath()
        ctx.arc(s.x, s.y, 1.5, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
        ctx.fill()

        // Move
        s.x += Math.cos(s.angle) * s.speed
        s.y += Math.sin(s.angle) * s.speed

        // Remove when done
        if (s.life >= s.maxLife) {
          shootingStars.splice(i, 1)
        }
      }

      animFrame = requestAnimationFrame(animate)
    }

    animFrame = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animFrame)
      resizeObserver.disconnect()
    }
  }, [])

  return (
    <div ref={containerRef} className={`absolute inset-0 pointer-events-none ${className}`}>
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  )
}
