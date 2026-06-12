import type { MotionProps } from "motion/react"
import type { CSSProperties, ElementType, JSX } from "react"

import { motion } from "motion/react"
import { memo, useMemo } from "react"
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

const ShimmerComponent = ({ children, as: Component = "p", className, duration = 2, spread = 2 }: ShimmerProps) => {
  const MotionComponent = getMotionComponent(Component as keyof JSX.IntrinsicElements)
  const dynamicSpread = useMemo(() => (children?.length ?? 0) * spread, [children, spread])

  return (
    <MotionComponent
      animate={{ backgroundPosition: "0% center" }}
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[background-repeat:no-repeat,padding-box] [--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))]",
        className,
      )}
      initial={{ backgroundPosition: "100% center" }}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage: "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
        } as CSSProperties
      }
      transition={{
        duration,
        ease: "linear",
        repeat: Number.POSITIVE_INFINITY,
      }}
    >
      {children}
    </MotionComponent>
  )
}

export const Shimmer = memo(ShimmerComponent)
