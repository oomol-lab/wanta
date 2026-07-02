import * as React from "react"

export function useOrganizationAvatarPreviews() {
  const [avatarPreviewUrls, setAvatarPreviewUrls] = React.useState<Record<string, string>>({})
  const avatarPreviewUrlsRef = React.useRef(new Map<string, string>())

  const setOrganizationAvatarPreview = React.useCallback((organizationId: string, file: File | null) => {
    const current = avatarPreviewUrlsRef.current.get(organizationId)
    if (current) {
      URL.revokeObjectURL(current)
      avatarPreviewUrlsRef.current.delete(organizationId)
    }

    if (file) {
      avatarPreviewUrlsRef.current.set(organizationId, URL.createObjectURL(file))
    }

    setAvatarPreviewUrls(Object.fromEntries(avatarPreviewUrlsRef.current))
  }, [])

  React.useEffect(() => {
    return () => {
      for (const url of avatarPreviewUrlsRef.current.values()) {
        URL.revokeObjectURL(url)
      }
      avatarPreviewUrlsRef.current.clear()
    }
  }, [])

  return { avatarPreviewUrls, setOrganizationAvatarPreview }
}
