import wantaLogo from "../../resources/branding/logo.png"
import claudeCodeIcon from "@/assets/agent-icons/claude-code-color.svg"
import codexIcon from "@/assets/agent-icons/codex-color.svg"
import hermesAgentDarkIcon from "@/assets/agent-icons/hermes-agent-dark.svg"
import hermesAgentIcon from "@/assets/agent-icons/hermes-agent.svg"
import qoderDarkIcon from "@/assets/agent-icons/qoder-color-dark.svg"
import qoderIcon from "@/assets/agent-icons/qoder-color.svg"
import traeIcon from "@/assets/agent-icons/trae-color.svg"
import { AppIcons } from "@/components/AppIcons"
import { cn } from "@/lib/utils"

interface AgentIconProps {
  className?: string
  host: string
}

interface AgentIconAsset {
  agent: string
  darkSrc?: string
  src: string
}

export function AgentIcon({ className, host }: AgentIconProps) {
  const icon = getAgentIcon(host.trim().toLowerCase())

  if (icon) {
    return (
      <span className={cn("oo-entity-icon oo-entity-icon-brand", className)} title={host}>
        <img className={cn("oo-entity-icon-image", icon.darkSrc ? "dark:hidden" : undefined)} src={icon.src} alt="" />
        {icon.darkSrc && <img className="oo-entity-icon-image hidden dark:block" src={icon.darkSrc} alt="" />}
      </span>
    )
  }

  return (
    <span className={cn("oo-entity-icon oo-entity-icon-fallback", className)} title={host}>
      <AppIcons.object.agent className="size-4" />
    </span>
  )
}

function getAgentIcon(normalizedHost: string): AgentIconAsset | undefined {
  if (normalizedHost.includes("wanta")) {
    return { agent: "wanta", src: wantaLogo }
  }
  if (normalizedHost.includes("claude")) {
    return { agent: "claude-code", src: claudeCodeIcon }
  }
  if (normalizedHost.includes("codex")) {
    return { agent: "codex", src: codexIcon }
  }
  if (normalizedHost.includes("hermes")) {
    return { agent: "hermes", darkSrc: hermesAgentDarkIcon, src: hermesAgentIcon }
  }
  if (normalizedHost.includes("qoder")) {
    return { agent: "qoder", darkSrc: qoderDarkIcon, src: qoderIcon }
  }
  if (normalizedHost.includes("trae")) {
    return { agent: "trae", src: traeIcon }
  }
  return undefined
}
