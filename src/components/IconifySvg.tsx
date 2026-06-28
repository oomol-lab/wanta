import type { AppIconComponent } from "@/components/AppIcons"
import type { IconifyIcon as IconifyIconData } from "@iconify/types"
import type { SVGProps } from "react"

export function createIconifySvgIcon(icon: IconifyIconData): AppIconComponent {
  return function IconifySvgIcon({ children: _children, ...props }: SVGProps<SVGSVGElement>) {
    const width = icon.width ?? 16
    const height = icon.height ?? width
    return (
      <svg
        {...props}
        width="1em"
        height="1em"
        viewBox={`0 0 ${width} ${height}`}
        dangerouslySetInnerHTML={{ __html: icon.body }}
      />
    )
  }
}
