import type { GitBranchInfo, GitRepositoryState } from "../../../electron/git/common.ts"
import type { SessionProject } from "../../../electron/session/common.ts"
import type { UserFacingError } from "@/lib/user-facing-error"

import { Check, Folder, FolderPlus, GitBranch, LoaderCircle, Plus, Search, X } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { projectGitView } from "./project-git-view.ts"
import { ErrorNotice } from "@/components/ErrorNotice"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

interface ProjectContextBarProps {
  activeProject?: SessionProject
  disabled?: boolean
  gitError: UserFacingError | null
  gitLoading: boolean
  gitState: GitRepositoryState | null
  projects: SessionProject[]
  onCheckoutBranch: (branch: string) => Promise<GitRepositoryState | null>
  onCreateAndCheckoutBranch: (branch: string) => Promise<GitRepositoryState | null>
  onCreateProjectFromFolder: () => Promise<SessionProject | null>
  onRefreshGit: () => Promise<GitRepositoryState | null>
  onSelectProject: (projectId: string | undefined) => Promise<void>
}

type ContextMenuPlacement = {
  bottom: number
  left: number
  maxHeight: number
  width: number
}

function normalizedQuery(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function dirtyFileCount(state: GitRepositoryState): number {
  return state.stagedCount + state.unstagedCount + state.untrackedCount
}

function branchSortRank(branch: GitBranchInfo): number {
  if (branch.name === "main" || branch.name === "master") {
    return 0
  }
  if (branch.current) {
    return 1
  }
  return 2
}

function sortBranchesForMenu(branches: GitBranchInfo[]): GitBranchInfo[] {
  return [...branches].sort((left, right) => {
    const rankDiff = branchSortRank(left) - branchSortRank(right)
    if (rankDiff !== 0) {
      return rankDiff
    }
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
  })
}

function useContextMenuPlacement(
  open: boolean,
  anchorRef: React.RefObject<HTMLDivElement | null>,
  options: { preferredHeight: number; preferredWidth: number },
): ContextMenuPlacement | null {
  const [placement, setPlacement] = React.useState<ContextMenuPlacement | null>(null)

  React.useLayoutEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }

    const updatePlacement = (): void => {
      const anchor = anchorRef.current
      if (!anchor) {
        return
      }

      const anchorRect = anchor.getBoundingClientRect()
      const menuWidth = Math.min(options.preferredWidth, Math.max(280, window.innerWidth - 24))
      const left = Math.min(Math.max(anchorRect.left, 12), window.innerWidth - menuWidth - 12)
      const bottom = Math.max(window.innerHeight - anchorRect.top + 8, 12)
      const maxHeight = Math.min(options.preferredHeight, Math.max(180, anchorRect.top - 24))

      setPlacement({ bottom, left, maxHeight, width: menuWidth })
    }

    updatePlacement()
    window.addEventListener("resize", updatePlacement)
    window.addEventListener("scroll", updatePlacement, true)
    return () => {
      window.removeEventListener("resize", updatePlacement)
      window.removeEventListener("scroll", updatePlacement, true)
    }
  }, [anchorRef, open, options.preferredHeight, options.preferredWidth])

  return placement
}

export function ProjectContextBar({
  activeProject,
  disabled = false,
  gitError,
  gitLoading,
  gitState,
  projects,
  onCheckoutBranch,
  onCreateAndCheckoutBranch,
  onCreateProjectFromFolder,
  onRefreshGit,
  onSelectProject,
}: ProjectContextBarProps) {
  const t = useT()
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const menuLayerRef = React.useRef<HTMLDivElement | null>(null)
  const projectAnchorRef = React.useRef<HTMLDivElement | null>(null)
  const gitAnchorRef = React.useRef<HTMLDivElement | null>(null)
  const [projectOpen, setProjectOpen] = React.useState(false)
  const [gitOpen, setGitOpen] = React.useState(false)
  const [projectQuery, setProjectQuery] = React.useState("")
  const [branchQuery, setBranchQuery] = React.useState("")
  const [busyBranch, setBusyBranch] = React.useState<string | null>(null)
  const filteredProjects = React.useMemo(() => {
    const query = normalizedQuery(projectQuery)
    if (!query) {
      return projects
    }
    return projects.filter(
      (project) => normalizedQuery(project.name).includes(query) || normalizedQuery(project.path).includes(query),
    )
  }, [projectQuery, projects])
  const visibleBranches = React.useMemo(() => {
    const query = normalizedQuery(branchQuery)
    const branches = gitState?.available
      ? sortBranchesForMenu(gitState.branches.filter((branch) => !branch.remote))
      : []
    return query ? branches.filter((branch) => normalizedQuery(branch.name).includes(query)) : branches
  }, [branchQuery, gitState])
  const gitView = projectGitView({ error: gitError, loading: gitLoading, project: activeProject, state: gitState })
  const gitMenuState = gitView.kind === "ready" ? gitView.state : null
  const projectMenuPlacement = useContextMenuPlacement(projectOpen, projectAnchorRef, {
    preferredHeight: 320,
    preferredWidth: 360,
  })
  const gitMenuPlacement = useContextMenuPlacement(gitOpen && gitMenuState !== null, gitAnchorRef, {
    preferredHeight: 380,
    preferredWidth: 400,
  })

  React.useEffect(() => {
    if (!projectOpen && !gitOpen) {
      return
    }
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && (rootRef.current?.contains(target) || menuLayerRef.current?.contains(target))) {
        return
      }
      setProjectOpen(false)
      setGitOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setProjectOpen(false)
        setGitOpen(false)
      }
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [gitOpen, projectOpen])

  React.useEffect(() => {
    if (projectOpen) {
      setProjectQuery("")
    }
  }, [projectOpen])

  React.useEffect(() => {
    if (gitOpen) {
      setBranchQuery("")
      void onRefreshGit()
    }
  }, [gitOpen, onRefreshGit])

  const closeMenus = React.useCallback(() => {
    setProjectOpen(false)
    setGitOpen(false)
  }, [])

  const selectProject = async (projectId: string | undefined): Promise<void> => {
    closeMenus()
    await onSelectProject(projectId)
  }

  const createProject = async (): Promise<void> => {
    closeMenus()
    await onCreateProjectFromFolder()
  }

  const checkoutBranch = async (branch: GitBranchInfo): Promise<void> => {
    if (branch.current || branch.remote || disabled) {
      return
    }
    if (gitState?.dirty && !globalThis.confirm(t("git.checkoutDirtyConfirm", { branch: branch.name }))) {
      return
    }
    setBusyBranch(branch.name)
    try {
      const next = await onCheckoutBranch(branch.name)
      if (!next?.available) {
        toast.error(next?.message || t("git.checkoutFailed"))
        return
      }
      toast.success(t("git.checkoutSucceeded", { branch: branch.name }))
      closeMenus()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      toast.error(message || t("git.checkoutFailed"))
    } finally {
      setBusyBranch(null)
    }
  }

  const createAndCheckoutBranch = async (branch: string): Promise<void> => {
    const branchName = branch.trim()
    if (!branchName || disabled) {
      return
    }
    if (gitState?.dirty && !globalThis.confirm(t("git.checkoutDirtyConfirm", { branch: branchName }))) {
      return
    }
    setBusyBranch(branchName)
    try {
      const next = await onCreateAndCheckoutBranch(branchName)
      if (!next?.available) {
        toast.error(next?.message || t("git.createCheckoutFailed"))
        return
      }
      toast.success(t("git.createCheckoutSucceeded", { branch: branchName }))
      closeMenus()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      toast.error(message || t("git.createCheckoutFailed"))
    } finally {
      setBusyBranch(null)
    }
  }

  return (
    <div ref={rootRef} className="flex min-w-0 items-center gap-3 overflow-hidden">
      <div ref={projectAnchorRef} className="relative min-w-0">
        <ProjectChip
          active={projectOpen}
          disabled={disabled}
          project={activeProject}
          onClear={() => void selectProject(undefined)}
          onOpen={() => {
            setProjectOpen((open) => !open)
            setGitOpen(false)
          }}
        />
        {projectOpen ? (
          <ProjectMenu
            activeProjectId={activeProject?.id}
            disabled={disabled}
            menuRef={menuLayerRef}
            placement={projectMenuPlacement}
            projects={filteredProjects}
            query={projectQuery}
            onCreateProject={createProject}
            onQueryChange={setProjectQuery}
            onSelectProject={selectProject}
          />
        ) : null}
      </div>
      {gitView.kind === "ready" ? (
        <div ref={gitAnchorRef} className="relative min-w-0">
          <ContextChip
            active={gitOpen}
            disabled={disabled}
            icon={<GitBranch className="size-3.5" />}
            indicator={gitView.state.dirty ? "dirty" : undefined}
            label={gitView.branchLabel}
            title={gitView.state.repositoryRoot ?? gitView.branchLabel}
            onClick={() => {
              setGitOpen((open) => !open)
              setProjectOpen(false)
            }}
          />
          {gitOpen && gitMenuState ? (
            <GitMenu
              branches={visibleBranches}
              busyBranch={busyBranch}
              error={gitError}
              gitState={gitMenuState}
              loading={gitLoading}
              menuRef={menuLayerRef}
              placement={gitMenuPlacement}
              query={branchQuery}
              unavailableLabel=""
              onCheckoutBranch={checkoutBranch}
              onCreateAndCheckoutBranch={createAndCheckoutBranch}
              onQueryChange={setBranchQuery}
            />
          ) : null}
        </div>
      ) : gitView.kind === "loading" ? (
        <ContextChip
          disabled
          icon={<LoaderCircle className="size-3.5 animate-spin" />}
          label={t("git.loading")}
          title={t("git.loading")}
        />
      ) : null}
    </div>
  )
}

function ProjectChip({
  active = false,
  disabled = false,
  project,
  onClear,
  onOpen,
}: {
  active?: boolean
  disabled?: boolean
  project?: SessionProject
  onClear: () => void
  onOpen: () => void
}) {
  const t = useT()
  if (!project) {
    return (
      <ContextChip
        active={active}
        disabled={disabled}
        icon={<Folder className="size-3.5" />}
        label={t("project.chooseProject")}
        title={t("project.chooseProject")}
        onClick={onOpen}
      />
    )
  }

  return (
    <div
      className={cn(
        "group relative flex h-8 max-w-52 min-w-0 items-center rounded-md text-[0.8125rem] leading-[1.125rem] font-medium text-muted-foreground outline-none focus-within:bg-accent focus-within:text-foreground hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground",
        disabled && "pointer-events-none opacity-55",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        title={project.path}
        aria-expanded={active}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left outline-none"
        onClick={onOpen}
      >
        <span className="grid size-3.5 shrink-0 place-items-center opacity-85">
          <Folder className="size-3.5 transition-opacity group-focus-within:opacity-0 group-hover:opacity-0" />
        </span>
        <span className="min-w-0 truncate">{project.name}</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        title={t("project.noProject")}
        aria-label={t("project.noProject")}
        className="pointer-events-none absolute left-1.5 grid size-3.5 place-items-center rounded-full bg-muted-foreground text-background opacity-0 transition-opacity outline-none group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-foreground focus-visible:pointer-events-auto focus-visible:opacity-100"
        onClick={onClear}
      >
        <X className="size-2.5" />
      </button>
    </div>
  )
}

function ContextChip({
  active = false,
  disabled = false,
  icon,
  indicator,
  label,
  title,
  onClick,
}: {
  active?: boolean
  disabled?: boolean
  icon: React.ReactNode
  indicator?: "dirty"
  label: string
  title: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled || !onClick}
      title={title}
      aria-expanded={active}
      className={cn(
        "flex h-8 max-w-52 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[0.8125rem] leading-[1.125rem] font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus:bg-accent focus:text-foreground disabled:pointer-events-none disabled:opacity-55",
        active && "bg-accent text-foreground",
      )}
      onClick={onClick}
    >
      <span className="shrink-0 opacity-85">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      {indicator === "dirty" ? (
        <span className="size-1.5 shrink-0 rounded-full bg-[var(--oo-warning-foreground)]" />
      ) : null}
    </button>
  )
}

function MenuSearch({
  label,
  query,
  onQueryChange,
}: {
  label: string
  query: string
  onQueryChange: (query: string) => void
}) {
  return (
    <label className="flex h-9 shrink-0 items-center gap-2 px-3 text-muted-foreground">
      <Search className="size-4 shrink-0" />
      <input
        value={query}
        placeholder={label}
        aria-label={label}
        className="oo-text-body min-w-0 flex-1 border-0 bg-transparent p-0 text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
        onChange={(event) => onQueryChange(event.target.value)}
      />
    </label>
  )
}

function ProjectMenu({
  activeProjectId,
  disabled,
  menuRef,
  placement,
  projects,
  query,
  onCreateProject,
  onQueryChange,
  onSelectProject,
}: {
  activeProjectId?: string
  disabled: boolean
  menuRef: React.RefObject<HTMLDivElement | null>
  placement: ContextMenuPlacement | null
  projects: SessionProject[]
  query: string
  onCreateProject: () => void
  onQueryChange: (query: string) => void
  onSelectProject: (projectId: string | undefined) => Promise<void>
}) {
  const t = useT()
  if (!placement) {
    return null
  }

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[100] flex flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
      style={{
        bottom: placement.bottom,
        left: placement.left,
        maxHeight: placement.maxHeight,
        width: placement.width,
      }}
    >
      <MenuSearch label={t("project.searchPlaceholder")} query={query} onQueryChange={onQueryChange} />
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            disabled={disabled}
            className="grid w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)_1rem] items-center gap-2 rounded-sm px-2 py-2 text-left outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            onClick={() => void onSelectProject(project.id)}
          >
            <Folder className="size-4 text-muted-foreground" />
            <span className="grid min-w-0 gap-0.5">
              <span className="oo-text-value truncate">{project.name}</span>
              <span className="oo-text-caption-compact truncate text-muted-foreground">{project.path}</span>
            </span>
            {project.id === activeProjectId ? <Check className="size-4" /> : <span aria-hidden="true" />}
          </button>
        ))}
        {projects.length === 0 ? (
          <div className="oo-text-body px-2 py-6 text-center text-muted-foreground">{t("project.searchEmpty")}</div>
        ) : null}
      </div>
      <div className="shrink-0 border-t p-1">
        <ProjectMenuButton disabled={disabled} onClick={onCreateProject}>
          <FolderPlus className="size-4" />
          {t("project.newProject")}
        </ProjectMenuButton>
        <ProjectMenuButton disabled={disabled || !activeProjectId} onClick={() => void onSelectProject(undefined)}>
          <X className="size-4" />
          {t("project.noProject")}
        </ProjectMenuButton>
      </div>
    </div>,
    document.body,
  )
}

function ProjectMenuButton({
  children,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="relative flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function GitMenu({
  branches,
  busyBranch,
  error,
  gitState,
  loading,
  menuRef,
  placement,
  query,
  unavailableLabel,
  onCheckoutBranch,
  onCreateAndCheckoutBranch,
  onQueryChange,
}: {
  branches: GitBranchInfo[]
  busyBranch: string | null
  error: UserFacingError | null
  gitState: GitRepositoryState
  loading: boolean
  menuRef: React.RefObject<HTMLDivElement | null>
  placement: ContextMenuPlacement | null
  query: string
  unavailableLabel: string
  onCheckoutBranch: (branch: GitBranchInfo) => Promise<void>
  onCreateAndCheckoutBranch: (branch: string) => Promise<void>
  onQueryChange: (query: string) => void
}) {
  const t = useT()
  const createBranchName = query.trim()
  const branchExists = branches.some((branch) => branch.name === createBranchName)
  const canCreateBranch =
    gitState.available && createBranchName.length > 0 && !branchExists && !loading && busyBranch === null
  const createBranchTitle = !createBranchName
    ? t("git.createAndCheckoutBranchHint")
    : branchExists
      ? t("git.branchAlreadyExists")
      : t("git.createAndCheckoutBranch")
  if (!placement) {
    return null
  }

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[100] flex flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
      style={{
        bottom: placement.bottom,
        left: placement.left,
        maxHeight: placement.maxHeight,
        width: placement.width,
      }}
    >
      <MenuSearch label={t("git.searchPlaceholder")} query={query} onQueryChange={onQueryChange} />
      {error ? (
        <div className="shrink-0 px-2 pb-2">
          <ErrorNotice error={error} compact />
        </div>
      ) : null}
      {!gitState.available ? (
        <div className="oo-text-body px-3 py-6 text-center text-muted-foreground">{unavailableLabel}</div>
      ) : (
        <>
          <div className="oo-text-value shrink-0 px-3 py-2 text-muted-foreground">{t("git.branches")}</div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1 pt-0">
            {branches.map((branch) => {
              const disabled = branch.current || branch.remote || loading || busyBranch !== null
              const dirtyLabel =
                branch.current && gitState.dirty ? t("git.uncommittedFiles", { count: dirtyFileCount(gitState) }) : null
              return (
                <button
                  key={branch.name}
                  type="button"
                  disabled={disabled}
                  title={branch.remote ? t("git.remoteBranchDisabled") : branch.name}
                  className={cn(
                    "grid w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)_1rem] items-center gap-3 rounded-sm px-2 py-2.5 text-left outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:cursor-default",
                    branch.current ? "disabled:opacity-100" : "disabled:opacity-55",
                  )}
                  onClick={() => void onCheckoutBranch(branch)}
                >
                  <GitBranch className={cn("size-4", branch.current ? "text-foreground" : "text-muted-foreground")} />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="oo-text-value truncate">{branch.name}</span>
                    {dirtyLabel ? (
                      <span className="oo-text-caption-compact truncate text-muted-foreground">{dirtyLabel}</span>
                    ) : null}
                  </span>
                  {branch.current ? <Check className="size-4" /> : <span aria-hidden="true" />}
                </button>
              )
            })}
            {branches.length === 0 ? (
              <div className="oo-text-body px-2 py-6 text-center text-muted-foreground">
                {t("git.branchSearchEmpty")}
              </div>
            ) : null}
          </div>
          <div className="shrink-0 border-t p-1">
            <button
              type="button"
              disabled={!canCreateBranch}
              title={createBranchTitle}
              className="relative flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:cursor-default disabled:opacity-60"
              onClick={() => void onCreateAndCheckoutBranch(createBranchName)}
            >
              <Plus className="size-4" />
              {t("git.createAndCheckoutBranch")}
            </button>
          </div>
        </>
      )}
    </div>,
    document.body,
  )
}
