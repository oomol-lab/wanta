import * as React from "react"

export function ProviderIcon({
  iconUrl,
  displayName,
  size = "default",
}: {
  iconUrl?: string
  displayName: string
  size?: "default" | "lg"
}) {
  const [failed, setFailed] = React.useState(false)
  const dim = size === "lg" ? { width: "2.25rem", height: "2.25rem" } : undefined
  if (iconUrl && !failed) {
    return (
      <span className="oo-entity-icon oo-entity-icon-brand" style={dim}>
        <img src={iconUrl} alt="" className="oo-entity-icon-image" onError={() => setFailed(true)} />
      </span>
    )
  }
  return (
    <span className="oo-entity-icon oo-entity-icon-fallback" style={dim}>
      {displayName.slice(0, 1)}
    </span>
  )
}
