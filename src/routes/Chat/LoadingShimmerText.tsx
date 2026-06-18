import { Shimmer } from "@/components/ai-elements/shimmer"

export function LoadingShimmerText({ children, className }: { children: string; className?: string }) {
  return (
    <Shimmer as="span" className={className} duration={2.2} spread={32}>
      {children}
    </Shimmer>
  )
}
