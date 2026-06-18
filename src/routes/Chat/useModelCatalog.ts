import type { ModelCatalog, ModelChoice, SaveCustomModelRequest } from "../../../electron/models/common.ts"
import type { UserFacingError } from "@/lib/user-facing-error"

import * as React from "react"
import { useModelsService } from "@/components/AppContext"
import { resolveUserFacingError } from "@/lib/user-facing-error"

export interface UseModelCatalog {
  catalog: ModelCatalog | null
  dialogOpen: boolean
  error: UserFacingError | null
  closeDialog: () => void
  deleteModel: (id: string) => void
  openDialog: () => void
  saveModel: (request: SaveCustomModelRequest) => Promise<void>
  selectModel: (choice: ModelChoice) => void
}

export function useModelCatalog(): UseModelCatalog {
  const modelsService = useModelsService()
  const [catalog, setCatalog] = React.useState<ModelCatalog | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void modelsService
      .invoke("listModels")
      .then((nextCatalog) => {
        if (!cancelled) {
          setCatalog(nextCatalog)
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(resolveUserFacingError(cause, { area: "model" }))
        }
      })
    const off = modelsService.serverEvents.on("modelsChanged", (nextCatalog) => setCatalog(nextCatalog))
    return () => {
      cancelled = true
      off()
    }
  }, [modelsService])

  const selectModel = React.useCallback(
    (choice: ModelChoice) => {
      setError(null)
      void modelsService
        .invoke("setSelectedModel", choice)
        .then(setCatalog)
        .catch((cause) => setError(resolveUserFacingError(cause, { area: "model" })))
    },
    [modelsService],
  )

  const deleteModel = React.useCallback(
    (id: string) => {
      setError(null)
      void modelsService
        .invoke("deleteCustomModel", id)
        .then(setCatalog)
        .catch((cause) => setError(resolveUserFacingError(cause, { area: "model" })))
    },
    [modelsService],
  )

  const saveModel = React.useCallback(
    async (request: SaveCustomModelRequest) => {
      setError(null)
      try {
        const nextCatalog = await modelsService.invoke("saveCustomModel", request)
        setCatalog(nextCatalog)
        setDialogOpen(false)
      } catch (cause) {
        setError(resolveUserFacingError(cause, { area: "model" }))
        throw cause
      }
    },
    [modelsService],
  )

  const openDialog = React.useCallback(() => {
    setError(null)
    setDialogOpen(true)
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialogOpen(false)
  }, [])

  return {
    catalog,
    dialogOpen,
    error,
    closeDialog,
    deleteModel,
    openDialog,
    saveModel,
    selectModel,
  }
}
