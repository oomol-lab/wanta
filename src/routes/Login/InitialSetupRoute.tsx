import type { UseAuth } from "@/hooks/useAuth"
import type { UseLinkRuntime } from "@/hooks/useLinkRuntime"
import type { UserFacingError } from "@/lib/user-facing-error"
import type { UseModelCatalog } from "@/routes/Chat/useModelCatalog"

import { ArrowLeft, BrainCircuit, Check, ChevronRight, Cloud, Server, Settings2 } from "lucide-react"
import * as React from "react"
import { LoginBrandPanel } from "./LoginBrandPanel.tsx"
import { Loader } from "@/components/ai-elements/loader"
import { BrandIcon } from "@/components/BrandIcon"
import { ErrorNotice } from "@/components/ErrorNotice"
import { OpenConnectorEndpointFields } from "@/components/OpenConnectorEndpointFields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/i18n/i18n"
import {
  hasCompleteOpenConnectorEndpoints,
  inferOpenConnectorDeploymentMode,
  resolveOpenConnectorConsoleUrl,
} from "@/lib/openconnector-deployment"
import { resolveUserFacingError } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"
import { AddCustomModelDialog } from "@/routes/Chat/AddCustomModelDialog"

type SetupView = "choice" | "self-managed"

export function InitialSetupRoute({
  auth,
  completing,
  linkRuntime,
  models,
  onCompleteSelfManaged,
}: {
  auth: UseAuth
  completing: boolean
  linkRuntime: UseLinkRuntime
  models: UseModelCatalog
  onCompleteSelfManaged: () => Promise<void>
}) {
  const t = useT()
  const [view, setView] = React.useState<SetupView>("choice")

  return (
    <div className="relative flex h-full flex-col bg-background text-foreground">
      <header className="absolute inset-x-0 top-0 z-10 h-[var(--app-titlebar-height)] [-webkit-app-region:drag]" />
      <main className="oo-login-main min-h-0 flex-1">
        {view === "choice" ? (
          <div className="mx-auto grid h-full max-w-[1480px] grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)] gap-5 md:gap-7 lg:gap-9">
            <section className="flex min-h-0 items-center overflow-y-auto">
              <SetupChoice auth={auth} onSelfManaged={() => setView("self-managed")} />
            </section>
            <LoginBrandPanel t={t} />
          </div>
        ) : (
          <SelfManagedSetup
            completing={completing}
            linkRuntime={linkRuntime}
            models={models}
            onBack={() => setView("choice")}
            onComplete={onCompleteSelfManaged}
            onSkip={onCompleteSelfManaged}
          />
        )}
      </main>
    </div>
  )
}

function SetupChoice({ auth, onSelfManaged }: { auth: UseAuth; onSelfManaged: () => void }) {
  const t = useT()
  return (
    <div className="w-full max-w-[40rem] px-2 py-8 md:px-6 lg:px-9 xl:px-11">
      <BrandIcon className="size-14" />
      <div className="mt-7 space-y-3">
        <h1 className="max-w-[34rem] text-[1.8rem] leading-[1.15] font-semibold tracking-normal md:text-[2rem]">
          {t("setup.title")}
        </h1>
        <p className="max-w-[34rem] text-sm leading-6 text-muted-foreground">{t("setup.description")}</p>
      </div>

      <div className="mt-7 grid gap-3">
        <SetupOption
          actionLabel={auth.loggingIn ? t("login.waiting") : t("setup.oomolAction")}
          disabled={auth.loggingIn}
          icon={<Cloud className="size-5" />}
          loading={auth.loggingIn}
          onClick={() => void auth.login()}
          primary
          title={t("setup.oomolTitle")}
          description={t("setup.oomolDescription")}
          recommended={t("setup.recommended")}
        />

        <SetupOption
          actionLabel={t("setup.selfManagedAction")}
          icon={<Settings2 className="size-5" />}
          onClick={onSelfManaged}
          title={t("setup.selfManagedTitle")}
          description={t("setup.selfManagedDescription")}
        />
      </div>
      {auth.error ? <ErrorNotice error={auth.error} compact className="mt-3" /> : null}
    </div>
  )
}

function SetupOption({
  actionLabel,
  description,
  disabled = false,
  icon,
  loading = false,
  onClick,
  primary = false,
  recommended,
  title,
}: {
  actionLabel: string
  description: string
  disabled?: boolean
  icon: React.ReactNode
  loading?: boolean
  onClick: () => void
  primary?: boolean
  recommended?: string
  title: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "group w-full rounded-xl border bg-card/80 p-4 text-left shadow-xs transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-foreground/20 hover:shadow-sm disabled:pointer-events-none disabled:opacity-60",
        primary && "border-foreground/16 bg-foreground/[0.025]",
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            {recommended ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.6875rem] font-medium text-primary">
                {recommended}
              </span>
            ) : null}
          </div>
          <p className="mt-1 max-w-[31rem] text-xs leading-5 text-muted-foreground">{description}</p>
          <span className={cn("mt-2.5 inline-flex items-center gap-1 text-xs font-medium", primary && "text-primary")}>
            {loading ? <Loader /> : null}
            {actionLabel}
            {!loading ? <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /> : null}
          </span>
        </div>
      </div>
    </button>
  )
}

function SelfManagedSetup({
  completing,
  linkRuntime,
  models,
  onBack,
  onComplete,
  onSkip,
}: {
  completing: boolean
  linkRuntime: UseLinkRuntime
  models: UseModelCatalog
  onBack: () => void
  onComplete: () => Promise<void>
  onSkip: () => Promise<void>
}) {
  const t = useT()
  const saved = linkRuntime.state?.openConnector
  const [baseUrl, setBaseUrl] = React.useState(saved?.baseUrl ?? "")
  const [consoleUrl, setConsoleUrl] = React.useState(saved?.consoleUrl ?? "")
  const [deploymentMode, setDeploymentMode] = React.useState(() => inferOpenConnectorDeploymentMode(saved))
  const [runtimeToken, setRuntimeToken] = React.useState("")
  const [actionError, setActionError] = React.useState<UserFacingError | null>(null)
  const hasModel = Boolean(models.catalog?.customModels.length)
  const connectorOnline = linkRuntime.status.kind === "online"

  React.useEffect(() => {
    setBaseUrl(saved?.baseUrl ?? "")
    setConsoleUrl(saved?.consoleUrl ?? "")
    setDeploymentMode(inferOpenConnectorDeploymentMode(saved))
  }, [saved?.baseUrl, saved?.consoleUrl])

  const endpointConfigurationComplete = hasCompleteOpenConnectorEndpoints(deploymentMode, baseUrl, consoleUrl)
  const changeDeploymentMode = (nextMode: typeof deploymentMode) => {
    setDeploymentMode(nextMode)
    if (nextMode === "local" && consoleUrl.trim() === baseUrl.trim()) setConsoleUrl("")
  }

  const saveAndTest = async () => {
    setActionError(null)
    const token = runtimeToken.trim()
    try {
      await linkRuntime.saveOpenConnector({
        baseUrl,
        consoleUrl: resolveOpenConnectorConsoleUrl(deploymentMode, baseUrl, consoleUrl),
        ...(token ? { runtimeToken: token } : {}),
      })
      const result = await linkRuntime.testOpenConnector({ baseUrl, ...(token ? { runtimeToken: token } : {}) })
      if (result.kind !== "online") {
        throw new Error(t(`setup.openConnectorTest.${result.kind}`))
      }
      setRuntimeToken("")
    } catch (cause) {
      setActionError(resolveUserFacingError(cause, { area: "connections", preserveMessage: true }))
    }
  }

  const runActivation = (operation: () => Promise<void>) => {
    setActionError(null)
    void operation().catch((cause: unknown) => {
      setActionError(resolveUserFacingError(cause, { area: "generic", preserveMessage: true }))
    })
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[72rem] flex-col overflow-y-auto px-5 py-8 sm:px-8 lg:px-12">
      <button
        type="button"
        className="mb-5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="size-3.5" />
        {t("setup.back")}
      </button>
      <div className="max-w-[48rem]">
        <h1 className="text-2xl font-semibold md:text-[1.75rem]">{t("setup.selfManagedSetupTitle")}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("setup.selfManagedSetupDescription")}</p>
      </div>

      <div className="mt-7 grid items-stretch gap-4 lg:grid-cols-2">
        <SetupStep
          complete={hasModel}
          icon={<BrainCircuit className="size-4" />}
          title={t("setup.modelStepTitle")}
          description={
            hasModel
              ? t("setup.modelConfigured", {
                  model:
                    models.catalog?.customModels[0]?.displayName ?? models.catalog?.customModels[0]?.modelName ?? "",
                })
              : t("setup.modelStepDescription")
          }
        >
          <Button variant="outline" size="sm" onClick={models.openDialog}>
            {hasModel ? t("setup.addAnotherModel") : t("setup.configureModel")}
          </Button>
        </SetupStep>

        <SetupStep
          complete={connectorOnline}
          icon={<Server className="size-4" />}
          optional
          title={t("setup.openConnectorStepTitle")}
          description={connectorOnline ? t("setup.openConnectorReady") : t("setup.openConnectorStepDescription")}
        >
          <div className="grid gap-2">
            <OpenConnectorEndpointFields
              baseUrl={baseUrl}
              consoleUrl={consoleUrl}
              disabled={linkRuntime.busy}
              mode={deploymentMode}
              onBaseUrlChange={setBaseUrl}
              onConsoleUrlChange={setConsoleUrl}
              onModeChange={changeDeploymentMode}
            />
            <Input
              type="password"
              autoComplete="off"
              value={runtimeToken}
              placeholder={saved?.tokenConfigured ? t("setup.openConnectorTokenSaved") : t("setup.openConnectorToken")}
              disabled={linkRuntime.busy}
              onChange={(event) => setRuntimeToken(event.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={linkRuntime.busy || !endpointConfigurationComplete}
              onClick={() => void saveAndTest()}
            >
              {linkRuntime.busy ? <Loader /> : null}
              {t("setup.saveAndTest")}
            </Button>
          </div>
        </SetupStep>
      </div>

      {models.catalogError ? <ErrorNotice error={models.catalogError} compact className="mt-3" /> : null}
      {actionError ? <ErrorNotice error={actionError} compact className="mt-3" /> : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        <div>
          <Button variant="ghost" disabled={completing || linkRuntime.busy} onClick={() => runActivation(onSkip)}>
            {t("setup.skip")}
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">{t("setup.skipDescription")}</p>
        </div>
        <Button
          size="lg"
          disabled={!hasModel || completing || linkRuntime.busy}
          onClick={() => runActivation(onComplete)}
        >
          {completing ? <Loader /> : <Check />}
          {t("setup.completeSelfManaged")}
        </Button>
      </div>

      <AddCustomModelDialog
        connectorsEnabled={false}
        open={models.dialogOpen}
        providers={models.catalog?.providers ?? []}
        error={models.dialogError}
        onClose={models.closeDialog}
        onSave={models.saveModel}
      />
    </div>
  )
}

function SetupStep({
  children,
  complete,
  description,
  icon,
  optional = false,
  title,
}: {
  children: React.ReactNode
  complete: boolean
  description: string
  icon: React.ReactNode
  optional?: boolean
  title: string
}) {
  const t = useT()
  return (
    <section className={cn("rounded-xl border bg-card/80 p-4", complete && "border-emerald-500/35")}>
      <div className="flex gap-3">
        <div
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg bg-muted",
            complete && "bg-emerald-500/10 text-emerald-600",
          )}
        >
          {complete ? <Check className="size-4" /> : icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            {optional ? (
              <span className="rounded-full border px-2 py-0.5 text-[0.6875rem] text-muted-foreground">
                {t("settings.optional")}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </section>
  )
}
