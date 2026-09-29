import type { ConnectionProviderIcon } from "../../../electron/connections/common.ts"

import * as React from "react"
import { useProviderSpriteStatus } from "./connection-provider-sprite.ts"
import { ThemeContext } from "@/components/theme-context"

export function ProviderIcon({
  iconUrl,
  iconSprite,
  iconSpritePosition,
  displayName,
  size = "default",
}: ConnectionProviderIcon & {
  iconUrl?: string
  displayName: string
  size?: "compact" | "default" | "lg" | "showcase"
}) {
  const theme = React.useContext(ThemeContext)?.effectiveTheme ?? "light"
  const spriteUrl =
    iconSprite && iconSpritePosition ? (theme === "dark" ? iconSprite.darkUrl : iconSprite.lightUrl) : null
  const spriteStatus = useProviderSpriteStatus(spriteUrl)
  const [failedIconUrl, setFailedIconUrl] = React.useState<string | null>(null)
  const dim =
    size === "lg"
      ? { width: "2.25rem", height: "2.25rem" }
      : size === "showcase"
        ? { width: "1.5rem", height: "1.5rem" }
        : size === "compact"
          ? { width: "1rem", height: "1rem" }
          : undefined
  const imageDim =
    size === "showcase"
      ? { width: "1.0625rem", height: "1.0625rem" }
      : size === "compact"
        ? { width: "0.75rem", height: "0.75rem" }
        : undefined
  const className = size === "compact" ? "oo-entity-icon oo-entity-icon-compact" : "oo-entity-icon"
  if (iconSprite && iconSpritePosition && spriteUrl && spriteStatus === "loaded") {
    return (
      <span className={`${className} oo-entity-icon-brand`} style={dim} aria-hidden="true">
        <span className="oo-entity-icon-image relative block overflow-hidden" style={imageDim}>
          <img
            key={spriteUrl}
            src={spriteUrl}
            alt=""
            referrerPolicy="no-referrer"
            decoding="async"
            draggable={false}
            className="absolute max-w-none"
            style={{
              width: `${(iconSprite.width / iconSprite.iconSize) * 100}%`,
              height: `${(iconSprite.height / iconSprite.iconSize) * 100}%`,
              left: `${(-iconSpritePosition.x / iconSprite.iconSize) * 100}%`,
              top: `${(-iconSpritePosition.y / iconSprite.iconSize) * 100}%`,
            }}
          />
        </span>
      </span>
    )
  }
  if (iconUrl && iconUrl !== failedIconUrl && spriteStatus !== "loading") {
    return (
      <span className={`${className} oo-entity-icon-brand`} style={dim}>
        <img
          src={iconUrl}
          alt=""
          className="oo-entity-icon-image"
          style={imageDim}
          loading="eager"
          decoding="async"
          draggable={false}
          onError={() => setFailedIconUrl(iconUrl)}
        />
      </span>
    )
  }
  return (
    <span className={`${className} oo-entity-icon-fallback`} style={dim}>
      {displayName.slice(0, 1)}
    </span>
  )
}
