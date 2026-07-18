import * as React from "react"

export function ProviderIcon({
  iconUrl,
  displayName,
  size = "default",
}: {
  iconUrl?: string
  displayName: string
  size?: "compact" | "default" | "lg" | "showcase"
}) {
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
  if (iconUrl && iconUrl !== failedIconUrl) {
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
