import type { MotionProps } from "motion/react"
import type { CSSProperties, ElementType, JSX } from "react"

import { motion, useReducedMotion } from "motion/react"
import { memo } from "react"
import { cn } from "@/lib/utils"

type MotionHTMLProps = MotionProps & Record<string, unknown>

// 缓存 motion 组件，避免在 render 期间重复创建。
const motionComponentCache = new Map<keyof JSX.IntrinsicElements, React.ComponentType<MotionHTMLProps>>()

function getMotionComponent(element: keyof JSX.IntrinsicElements): React.ComponentType<MotionHTMLProps> {
  let component = motionComponentCache.get(element)
  if (!component) {
    component = motion.create(element)
    motionComponentCache.set(element, component)
  }
  return component
}

export interface ShimmerProps {
  children: string
  as?: ElementType
  className?: string
  duration?: number
  spread?: number
}

export function clampShimmerSpread(spread: number): number {
  if (!Number.isFinite(spread)) {
    return 32
  }
  return Math.min(56, Math.max(18, spread))
}

const ShimmerComponent = ({ children, as: Component = "p", className, duration = 2, spread = 32 }: ShimmerProps) => {
  const MotionComponent = getMotionComponent(Component as keyof JSX.IntrinsicElements)
  const reduceMotion = useReducedMotion()
  const shimmerSpread = clampShimmerSpread(spread)

  return (
    <MotionComponent
      className={cn(
        "relative inline-block",
        reduceMotion
          ? "text-muted-foreground"
          : "bg-[length:250%_100%,auto] bg-clip-text [background-repeat:no-repeat,padding-box] text-transparent [--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--shimmer-highlight),#0000_calc(50%+var(--spread)))]",
        className,
      )}
      {...(!reduceMotion
        ? {
            animate: { backgroundPosition: "0% center" },
            initial: { backgroundPosition: "100% center" },
            style: {
              "--spread": `${shimmerSpread}px`,
              "--shimmer-highlight": "color-mix(in oklab, var(--color-background) 12%, white)",
              backgroundImage:
                "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
            } as CSSProperties,
            transition: {
              duration,
              ease: "linear",
              repeat: Number.POSITIVE_INFINITY,
            },
          }
        : {})}
    >
      {children}
    </MotionComponent>
  )
}

export const Shimmer = memo(ShimmerComponent)
