import type { ModelCatalog, ModelChoice, SaveCustomModelRequest } from "../../../electron/models/common.ts"
import type { UserFacingError } from "../../lib/user-facing-error.ts"

import * as React from "react"
import { useModelsService } from "../../components/AppContext.ts"
import { resolveUserFacingError } from "../../lib/user-facing-error.ts"

export interface UseModelCatalog {
  catalog: ModelCatalog | null
  catalogError: UserFacingError | null
  dialogOpen: boolean
  dialogError: UserFacingError | null
  selectionError: UserFacingError | null
  closeDialog: () => void
  deleteModel: (id: string) => void
  openDialog: () => void
  saveModel: (request: SaveCustomModelRequest) => Promise<void>
  selectModel: (choice: ModelChoice) => void
}

function hasModelChoice(catalog: ModelCatalog | null, choice: ModelChoice): boolean {
  if (!catalog) {
    return false
  }
  if (choice.kind === "builtin") {
    return catalog.builtins.some((model) => model.id === choice.id)
  }
  return catalog.customModels.some((model) => model.id === choice.id)
}

function withSelectedModel(catalog: ModelCatalog | null, choice: ModelChoice): ModelCatalog | null {
  if (!catalog) {
    return null
  }
  if (!hasModelChoice(catalog, choice)) {
    return catalog
  }
  return { ...catalog, selected: choice }
}

export function modelCatalogForRuntime(catalog: ModelCatalog | null, cloudModelsEnabled: boolean): ModelCatalog | null {
  if (!catalog || cloudModelsEnabled) return catalog
  const selectedCustom = catalog.customModels.find((model) =>
    catalog.selected.kind === "custom" ? model.id === catalog.selected.id : false,
  )
  const fallback = selectedCustom ?? catalog.customModels[0]
  return {
    ...catalog,
    builtins: [],
    ...(fallback ? { selected: { kind: "custom" as const, id: fallback.id } } : {}),
  }
}

export function useModelCatalog(): UseModelCatalog {
  const modelsService = useModelsService()
  const [catalog, setCatalog] = React.useState<ModelCatalog | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [catalogError, setCatalogError] = React.useState<UserFacingError | null>(null)
  const [dialogError, setDialogError] = React.useState<UserFacingError | null>(null)
  const [selectionError, setSelectionError] = React.useState<UserFacingError | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void modelsService
      .invoke("listModels")
      .then((nextCatalog) => {
        if (!cancelled) {
          setCatalog(nextCatalog)
          setCatalogError(null)
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setCatalogError(resolveUserFacingError(cause, { area: "model" }))
        }
      })
    const off = modelsService.serverEvents.on("modelsChanged", (nextCatalog) => {
      setCatalog(nextCatalog)
      setCatalogError(null)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [modelsService])

  const selectModel = React.useCallback(
    (choice: ModelChoice) => {
      setSelectionError(null)
      let previousCatalog: ModelCatalog | null = null
      setCatalog((current) => {
        previousCatalog = current
        return withSelectedModel(current, choice)
      })
      void modelsService
        .invoke("setSelectedModel", choice)
        .then(setCatalog)
        .catch((cause) => {
          setSelectionError(resolveUserFacingError(cause, { area: "model" }))
          void modelsService
            .invoke("listModels")
            .then(setCatalog)
            .catch(() => setCatalog(previousCatalog))
        })
    },
    [modelsService],
  )

  const deleteModel = React.useCallback(
    (id: string) => {
      setSelectionError(null)
      void modelsService
        .invoke("deleteCustomModel", id)
        .then(setCatalog)
        .catch((cause) => setSelectionError(resolveUserFacingError(cause, { area: "model" })))
    },
    [modelsService],
  )

  const saveModel = React.useCallback(
    async (request: SaveCustomModelRequest) => {
      setDialogError(null)
      try {
        const nextCatalog = await modelsService.invoke("saveCustomModel", request)
        setCatalog(nextCatalog)
        setDialogOpen(false)
      } catch (cause) {
        setDialogError(resolveUserFacingError(cause, { area: "model" }))
        throw cause
      }
    },
    [modelsService],
  )

  const openDialog = React.useCallback(() => {
    setDialogError(null)
    setDialogOpen(true)
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialogError(null)
    setDialogOpen(false)
  }, [])

  return {
    catalog,
    catalogError,
    dialogOpen,
    dialogError,
    selectionError,
    closeDialog,
    deleteModel,
    openDialog,
    saveModel,
    selectModel,
  }
}
