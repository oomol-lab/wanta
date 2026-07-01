import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type {
  Organization,
  OrganizationAppAccess,
  OrganizationMember,
  OrganizationOverview,
  OrganizationProviderOption,
  OrganizationUserSummary,
} from "../../../electron/organizations/common.ts"
import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"
import type {
  BusyAction,
  LoadState,
  MemberSearchState,
  MemberView,
  ProviderAccessForm,
  ProviderGrantView,
} from "./organization-management-model.ts"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { UseOrganizationWorkspace, WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations"

import {
  Building2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  MoreHorizontalIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import {
  allOrganizations,
  buildGrantViews,
  buildMemberViews,
  createOrganizationSkillPackageSet,
  errorMessage,
  errorState,
  initialProviderAccessForm,
  isConflictError,
  loadState,
  loadingState,
  maxOrganizationAvatarLength,
  maxOrganizationNameLength,
  minimumMemberSearchLength,
  organizationCanManage,
  organizationManagementSnapshotsByAccountId,
  organizationNameValidation,
  organizationRole,
  organizationSkillPackageLinked,
  planOrganizationSkillBulkLinks,
  providerOptionsWithSelected,
  readyState,
  readOrganizationManagementSnapshot,
  readSelectedOrganizationId,
  uniqueStrings,
  userFallback,
  writeSelectedOrganizationId,
} from "./organization-management-model.ts"
import { parseProviderGrants, removeProviderGrant, setProviderGrant } from "./organization-provider-access.ts"
import { useSkillService } from "@/components/AppContext"
import { useAuthStateResource, useHomeSummaryResource, useSkillInventoryResource } from "@/components/AppDataHooks"
import { CachedAvatarImage } from "@/components/CachedAvatarImage"
import { ErrorNotice } from "@/components/ErrorNotice"
import { SearchField } from "@/components/SearchField"
import { normalizeSkillIconSource } from "@/components/skill-icon-source"
import { SkillIcon } from "@/components/SkillIcon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from "@/components/ui/confirm-dialog"
import { Dialog } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { organizationAvatarStyle, organizationInitials } from "@/hooks/useOrganizationWorkspace"
import { useAppI18n } from "@/i18n"
import { onOrganizationChanged } from "@/lib/organization-change-bus"
import {
  addOrganizationMember,
  createOrganization,
  getOrganizationAppAccess,
  getOrganizationOverview,
  listOrganizationMembers,
  listOrganizationProviderOptions,
  listUserSummaries,
  removeOrganizationMember,
  searchUsers,
  updateOrganizationAppAccess,
} from "@/lib/organizations-client"
import {
  listPublicSkillPackages,
  readPublicSkillPackageByName,
  searchPublicSkillPackages,
} from "@/lib/skills-catalog-client"
import { resolveUserFacingError } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"
import { useProviderSkillPackageLookup } from "@/routes/Skills/provider-skill-package-lookup"
import { buildProviderSkillRecommendations } from "@/routes/Skills/provider-skill-recommendations"
import {
  canInstallPublicSkill,
  getOrganizationSkillRuntimeStatus,
  getPublicPackageInstallState,
  getPublicPackagePrimaryInstallSkill,
  getPublicPackagePrimarySkill,
  getPublicSkillInstallStateLabel,
  getSkillRowStatusBadgeClassName,
  initialPublicPackageCatalogState,
  isEmojiIcon,
  isImageIcon,
  isNearScrollBottom,
  publicPackageCatalogReducer,
} from "@/routes/Skills/skill-route-model"

type AsyncResult<T> = { ok: true; value: T } | { error: unknown; ok: false }
type OrganizationSkillManageTab = "configured" | "market" | "recommended"
export type OrganizationSkillLinkInput = {
  packageName: string
  skillName: string
  version: string
}

function settle<T>(promise: Promise<T>): Promise<AsyncResult<T>> {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ error, ok: false }),
  )
}

function looksLikeSkillPackageName(query: string): boolean {
  const normalized = query.trim()
  return /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(normalized) && normalized.length >= 3
}

function mergeMarketPackages(
  packageInfo: PublicSkillPackage | null,
  packages: readonly PublicSkillPackage[],
): PublicSkillPackage[] {
  const items = packageInfo ? [packageInfo, ...packages] : [...packages]
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.name.trim().toLowerCase()
    if (!key || seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function organizationSkillMatchesQuery(
  skill: UseOrganizationSkills["skills"][number],
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true
  }
  return [skill.displayName, skill.skillName, skill.packageName, skill.description ?? "", skill.version]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalizedQuery))
}

function providerRecommendationMatchesQuery(
  recommendation: ProviderSkillRecommendation,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true
  }
  const skillDescription =
    recommendation.package.skills.find((skill) => skill.name === recommendation.skillId)?.description ?? ""
  return [
    recommendation.providerDisplayName,
    recommendation.package.displayName,
    recommendation.packageName,
    recommendation.skillId,
    recommendation.package.description ?? "",
    skillDescription,
  ].some((value) => value.toLowerCase().includes(normalizedQuery))
}

function publicPackageLinkInput(pkg: PublicSkillPackage, skillName?: string): OrganizationSkillLinkInput | null {
  const skill = skillName
    ? (pkg.skills.find((item) => item.name === skillName) ?? getPublicPackagePrimarySkill(pkg))
    : getPublicPackagePrimarySkill(pkg)
  if (!skill) {
    return null
  }
  return {
    packageName: pkg.name,
    skillName: skill.name,
    version: pkg.version,
  }
}

export function OrganizationManagementRoute({
  connectedProviders = [],
  organizationSkills,
  workspace,
  onOpenOrganizationSkills,
}: {
  connectedProviders?: ConnectionProvider[]
  organizationSkills?: UseOrganizationSkills
  workspace?: UseOrganizationWorkspace
  onOpenOrganizationSkills?: () => void
}) {
  const { t } = useAppI18n()
  const skillService = useSkillService()
  const authResource = useAuthStateResource()
  const skillInventory = useSkillInventoryResource()
  const homeSummaryResource = useHomeSummaryResource()
  const activeAccount = authResource.data?.status === "authenticated" ? authResource.data.account : undefined
  const activeAccountId = activeAccount?.id
  const activeWorkspace = workspace?.activeWorkspace
  const selectPersonalWorkspace = workspace?.selectPersonal
  const selectOrganizationWorkspace = workspace?.selectOrganization
  const hasWorkspaceController = Boolean(workspace)
  const activeWorkspaceOrganizationId = activeWorkspace?.type === "organization" ? activeWorkspace.organizationId : null
  const activeWorkspaceIsPersonal = activeWorkspace?.type === "personal"
  const initialSnapshot = readOrganizationManagementSnapshot(activeAccountId)
  const [overviewState, setOverviewState] = React.useState<LoadState<OrganizationOverview | null>>(
    () => initialSnapshot?.overviewState ?? loadState(null),
  )
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState<string | null>(
    () => initialSnapshot?.selectedOrganizationId ?? null,
  )
  const [membersState, setMembersState] = React.useState<LoadState<OrganizationMember[]>>(
    () => initialSnapshot?.membersState ?? loadState([]),
  )
  const [summariesState, setSummariesState] = React.useState<LoadState<Record<string, OrganizationUserSummary>>>(
    () => initialSnapshot?.summariesState ?? loadState({}),
  )
  const [providerOptionsState, setProviderOptionsState] = React.useState<LoadState<OrganizationProviderOption[]>>(
    () => initialSnapshot?.providerOptionsState ?? loadState([]),
  )
  const [appAccessState, setAppAccessState] = React.useState<LoadState<OrganizationAppAccess | null>>(
    () => initialSnapshot?.appAccessState ?? loadState(null),
  )
  const [busyAction, setBusyAction] = React.useState<BusyAction | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createName, setCreateName] = React.useState("")
  const [createAvatar, setCreateAvatar] = React.useState("")
  const [createDuplicated, setCreateDuplicated] = React.useState(false)
  const [addMemberOpen, setAddMemberOpen] = React.useState(false)
  const [memberInput, setMemberInput] = React.useState("")
  const [selectedSearchUserId, setSelectedSearchUserId] = React.useState<string | null>(null)
  const [memberSearch, setMemberSearch] = React.useState<MemberSearchState>({
    error: null,
    items: [],
    loading: false,
    query: "",
  })
  const [providerAccessForm, setProviderAccessForm] = React.useState<ProviderAccessForm>(initialProviderAccessForm)
  const overviewRequestId = React.useRef(0)
  const detailsRequestId = React.useRef(0)
  const detailsOrganizationIdRef = React.useRef<string | null>(initialSnapshot?.detailsOrganizationId ?? null)
  const skipInitialDetailsLoadRef = React.useRef(
    Boolean(initialSnapshot?.detailsOrganizationId && initialSnapshot.detailsOrganizationId === selectedOrganizationId),
  )
  const skipInitialOrganizationsLoadRef = React.useRef(Boolean(initialSnapshot))
  const resetAccountIdRef = React.useRef<string | null>(null)
  const memberSearchRequestId = React.useRef(0)

  const organizations = React.useMemo(() => allOrganizations(overviewState.data), [overviewState.data])
  const selectedOrganization = React.useMemo(() => {
    return selectedOrganizationId ? (organizations.find((item) => item.id === selectedOrganizationId) ?? null) : null
  }, [organizations, selectedOrganizationId])
  const selectedOrganizationSkills =
    selectedOrganization && organizationSkills?.organizationId === selectedOrganization.id ? organizationSkills : null
  const skillGroupById = React.useMemo(
    () => new Map((skillInventory.data?.groups ?? []).map((group) => [group.id, group])),
    [skillInventory.data?.groups],
  )
  const providerPackagesByService = useProviderSkillPackageLookup(connectedProviders).packagesByService
  const providerSkillRecommendations = React.useMemo(
    () =>
      buildProviderSkillRecommendations({
        groupById: skillGroupById,
        packagesByService: providerPackagesByService,
        providers: connectedProviders,
      }),
    [connectedProviders, providerPackagesByService, skillGroupById],
  )
  const canManage = React.useMemo(
    () => organizationCanManage(overviewState.data, selectedOrganization),
    [overviewState.data, selectedOrganization],
  )
  const memberViews = React.useMemo(
    () => buildMemberViews(membersState.data, summariesState.data),
    [membersState.data, summariesState.data],
  )
  const grantState = React.useMemo(
    () => buildGrantViews(appAccessState.data, memberViews, providerOptionsState.data),
    [appAccessState.data, memberViews, providerOptionsState.data],
  )
  const grantsByUserId = React.useMemo(
    () => new Map(grantState.grants.map((grant) => [grant.userId, grant])),
    [grantState.grants],
  )
  const providerAccessError = appAccessState.error ?? providerOptionsState.error ?? grantState.error
  const showOverviewLoading = organizations.length === 0 && ["idle", "loading"].includes(overviewState.status)
  const showOverviewError = organizations.length === 0 && Boolean(overviewState.error)
  const showOrganizationEmptyState = !showOverviewLoading && !showOverviewError && organizations.length === 0
  const createNameError = React.useMemo(() => {
    if (!createName) {
      return null
    }
    switch (organizationNameValidation(createName.trim())) {
      case "empty":
        return t("organizations.organizationNameRequired")
      case "invalid":
        return t("organizations.organizationNameInvalid")
      case "too-long":
        return t("organizations.organizationNameTooLong", { max: maxOrganizationNameLength })
      case "valid":
        return createDuplicated ? t("organizations.organizationNameDuplicated") : null
    }
  }, [createDuplicated, createName, t])

  const resetOrganizationState = React.useCallback((accountId: string | null) => {
    resetAccountIdRef.current = accountId
    overviewRequestId.current += 1
    detailsRequestId.current += 1
    detailsOrganizationIdRef.current = null
    skipInitialOrganizationsLoadRef.current = false
    skipInitialDetailsLoadRef.current = false
    setOverviewState(loadState(null))
    setSelectedOrganizationId(null)
    setMembersState(loadState([]))
    setSummariesState(loadState({}))
    setProviderOptionsState(loadState([]))
    setAppAccessState(loadState(null))
  }, [])

  const loadOrganizations = React.useCallback(
    async (_options: { forceRefresh?: boolean } = {}) => {
      if (!activeAccountId) {
        return
      }
      const requestId = overviewRequestId.current + 1
      overviewRequestId.current = requestId
      setOverviewState((current) => loadingState(current))
      try {
        const overview = await getOrganizationOverview(activeAccountId)
        if (overviewRequestId.current !== requestId) {
          return
        }
        setOverviewState(readyState(overview))
        setSelectedOrganizationId((current) => {
          const listedOrganizations = allOrganizations(overview)
          if (activeWorkspaceIsPersonal) {
            return null
          }
          if (
            activeWorkspaceOrganizationId &&
            listedOrganizations.some((organization) => organization.id === activeWorkspaceOrganizationId)
          ) {
            return activeWorkspaceOrganizationId
          }
          if (current && listedOrganizations.some((organization) => organization.id === current)) {
            return current
          }
          const storedOrganizationId = readSelectedOrganizationId(overview.accountId)
          if (
            storedOrganizationId &&
            listedOrganizations.some((organization) => organization.id === storedOrganizationId)
          ) {
            return storedOrganizationId
          }
          return listedOrganizations[0]?.id ?? null
        })
      } catch (error) {
        if (overviewRequestId.current === requestId) {
          setOverviewState((current) => errorState(current, error))
        }
      }
    },
    [activeAccountId, activeWorkspaceIsPersonal, activeWorkspaceOrganizationId],
  )

  const loadSelectedDetails = React.useCallback(
    async (organization: Organization, canManageDetails: boolean, _options: { forceRefresh?: boolean } = {}) => {
      const requestId = detailsRequestId.current + 1
      const preserveCurrentData = detailsOrganizationIdRef.current === organization.id
      detailsRequestId.current = requestId
      detailsOrganizationIdRef.current = null
      setMembersState((current) => loadingState(preserveCurrentData ? current : loadState([])))
      setSummariesState((current) => loadingState(preserveCurrentData ? current : loadState({})))
      setProviderOptionsState(
        canManageDetails ? (current) => loadingState(preserveCurrentData ? current : loadState([])) : loadState([]),
      )
      setAppAccessState(
        canManageDetails ? (current) => loadingState(preserveCurrentData ? current : loadState(null)) : loadState(null),
      )

      try {
        const membersRequest = settle(listOrganizationMembers(organization.id))
        const providerOptionsRequest = canManageDetails
          ? settle(listOrganizationProviderOptions(organization.name))
          : Promise.resolve<AsyncResult<OrganizationProviderOption[]>>({ ok: true, value: [] })
        const appAccessRequest = canManageDetails
          ? settle(getOrganizationAppAccess(organization.id))
          : Promise.resolve<AsyncResult<OrganizationAppAccess | null>>({ ok: true, value: null })

        const membersResult = await membersRequest
        if (detailsRequestId.current !== requestId) {
          return
        }
        if (!membersResult.ok) {
          setMembersState((current) => errorState(current, membersResult.error))
          setSummariesState((current) => errorState(current, membersResult.error))
          return
        }

        const members = membersResult.value
        setMembersState(readyState(members))

        const userIds = uniqueStrings(members.map((member) => member.user_id))
        const summariesRequest =
          userIds.length > 0
            ? settle(listUserSummaries(userIds))
            : Promise.resolve<AsyncResult<Record<string, OrganizationUserSummary>>>({ ok: true, value: {} })
        const detailTasks = [
          summariesRequest.then((summariesResult) => {
            if (detailsRequestId.current !== requestId) {
              return
            }
            if (summariesResult.ok) {
              setSummariesState(readyState(summariesResult.value))
            } else {
              setSummariesState((current) => errorState(current, summariesResult.error))
            }
          }),
        ]

        if (!canManageDetails) {
          setProviderOptionsState(loadState([]))
          setAppAccessState(loadState(null))
        } else {
          detailTasks.push(
            providerOptionsRequest.then((providerOptionsResult) => {
              if (detailsRequestId.current !== requestId) {
                return
              }
              if (providerOptionsResult.ok) {
                setProviderOptionsState(readyState(providerOptionsResult.value))
              } else {
                setProviderOptionsState((current) => errorState(current, providerOptionsResult.error))
              }
            }),
            appAccessRequest.then((appAccessResult) => {
              if (detailsRequestId.current !== requestId) {
                return
              }
              if (appAccessResult.ok) {
                setAppAccessState(readyState(appAccessResult.value))
              } else {
                setAppAccessState((current) => errorState(current, appAccessResult.error))
              }
            }),
          )
        }

        await Promise.all(detailTasks)
        if (detailsRequestId.current === requestId) {
          detailsOrganizationIdRef.current = organization.id
        }
      } catch (error) {
        if (detailsRequestId.current !== requestId) {
          return
        }
        setMembersState((current) => (current.status === "loading" ? errorState(current, error) : current))
        setSummariesState((current) => (current.status === "loading" ? errorState(current, error) : current))
        if (canManageDetails) {
          setProviderOptionsState((current) => (current.status === "loading" ? errorState(current, error) : current))
          setAppAccessState((current) => (current.status === "loading" ? errorState(current, error) : current))
        }
      }
    },
    [],
  )

  React.useEffect(() => {
    const snapshot = readOrganizationManagementSnapshot(activeAccountId)
    if (!activeAccountId) {
      if (resetAccountIdRef.current !== null || overviewState.data?.accountId || selectedOrganizationId) {
        resetOrganizationState(null)
      }
      return
    }
    if (overviewState.data?.accountId === activeAccountId) {
      resetAccountIdRef.current = null
      return
    }
    if (!snapshot) {
      if (resetAccountIdRef.current !== activeAccountId) {
        resetOrganizationState(activeAccountId)
      }
      return
    }

    resetAccountIdRef.current = null
    setOverviewState(snapshot.overviewState)
    setSelectedOrganizationId(snapshot.selectedOrganizationId)
    setMembersState(snapshot.membersState)
    setSummariesState(snapshot.summariesState)
    setProviderOptionsState(snapshot.providerOptionsState)
    setAppAccessState(snapshot.appAccessState)
    detailsOrganizationIdRef.current = snapshot.detailsOrganizationId
    skipInitialOrganizationsLoadRef.current = true
    skipInitialDetailsLoadRef.current = Boolean(
      snapshot.detailsOrganizationId && snapshot.detailsOrganizationId === snapshot.selectedOrganizationId,
    )
  }, [activeAccountId, overviewState.data?.accountId, resetOrganizationState, selectedOrganizationId])

  React.useEffect(() => {
    if (!activeAccountId || overviewState.data?.accountId !== activeAccountId) {
      return
    }

    organizationManagementSnapshotsByAccountId.set(activeAccountId, {
      appAccessState,
      detailsOrganizationId: detailsOrganizationIdRef.current,
      membersState,
      overviewState,
      providerOptionsState,
      savedAt: Date.now(),
      selectedOrganizationId,
      summariesState,
    })
  }, [
    activeAccountId,
    appAccessState,
    membersState,
    overviewState,
    providerOptionsState,
    selectedOrganizationId,
    summariesState,
  ])

  React.useEffect(() => {
    if (!activeAccountId) {
      return
    }
    if (skipInitialOrganizationsLoadRef.current) {
      skipInitialOrganizationsLoadRef.current = false
      return
    }

    void loadOrganizations()
  }, [activeAccountId, loadOrganizations])

  React.useEffect(() => {
    const handleWindowFocus = () => {
      void loadOrganizations()
    }
    window.addEventListener("focus", handleWindowFocus)
    return () => window.removeEventListener("focus", handleWindowFocus)
  }, [loadOrganizations])

  React.useEffect(() => {
    return onOrganizationChanged(() => {
      void loadOrganizations()
    })
  }, [loadOrganizations])

  React.useEffect(() => {
    if (!hasWorkspaceController) {
      return
    }
    if (activeWorkspaceIsPersonal) {
      setSelectedOrganizationId(null)
      return
    }
    if (activeWorkspaceOrganizationId) {
      setSelectedOrganizationId(activeWorkspaceOrganizationId)
    }
  }, [activeWorkspaceIsPersonal, activeWorkspaceOrganizationId, hasWorkspaceController])

  React.useEffect(() => {
    const accountId = overviewState.data?.accountId
    if (!accountId || !selectedOrganizationId) {
      return
    }
    if (organizations.some((organization) => organization.id === selectedOrganizationId)) {
      writeSelectedOrganizationId(accountId, selectedOrganizationId)
    }
  }, [organizations, overviewState.data?.accountId, selectedOrganizationId])

  React.useEffect(() => {
    if (!selectedOrganization) {
      detailsRequestId.current += 1
      detailsOrganizationIdRef.current = null
      setMembersState(loadState([]))
      setSummariesState(loadState({}))
      setProviderOptionsState(loadState([]))
      setAppAccessState(loadState(null))
      return
    }

    if (skipInitialDetailsLoadRef.current && detailsOrganizationIdRef.current === selectedOrganization.id) {
      skipInitialDetailsLoadRef.current = false
      return
    }

    skipInitialDetailsLoadRef.current = false
    void loadSelectedDetails(selectedOrganization, canManage)
  }, [canManage, loadSelectedDetails, selectedOrganization?.id, selectedOrganization?.name])

  React.useEffect(() => {
    const query = memberInput.trim()
    const requestId = memberSearchRequestId.current + 1
    memberSearchRequestId.current = requestId

    if (!addMemberOpen || query.length < minimumMemberSearchLength) {
      setMemberSearch({ error: null, items: [], loading: false, query })
      return
    }

    setMemberSearch({ error: null, items: [], loading: true, query })
    const timer = window.setTimeout(() => {
      void searchUsers(query)
        .then((users) => {
          if (memberSearchRequestId.current !== requestId) {
            return
          }
          const existingMemberIds = new Set(membersState.data.map((member) => member.user_id))
          setMemberSearch({
            error: null,
            items: users
              .filter((user) => !existingMemberIds.has(user.user_id))
              .map((user) => {
                const displayName = user.nickname || user.username
                return { ...user, displayName, fallback: userFallback(displayName), userId: user.user_id }
              }),
            loading: false,
            query,
          })
        })
        .catch((error) => {
          if (memberSearchRequestId.current === requestId) {
            setMemberSearch({ error: errorMessage(error), items: [], loading: false, query })
          }
        })
    }, 250)

    return () => window.clearTimeout(timer)
  }, [addMemberOpen, memberInput, membersState.data])

  const handleCreateOrganization = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      const orgName = createName.trim()
      const validation = organizationNameValidation(orgName)
      if (validation !== "valid") {
        toast.error(
          validation === "empty"
            ? t("organizations.organizationNameRequired")
            : validation === "invalid"
              ? t("organizations.organizationNameInvalid")
              : t("organizations.organizationNameTooLong", { max: maxOrganizationNameLength }),
        )
        return
      }

      setBusyAction("create")
      try {
        const organization = await createOrganization({
          orgName,
          ...(createAvatar.trim() ? { avatar: createAvatar.trim() } : {}),
        })
        toast.success(t("organizations.createOrganizationSuccess"))
        setCreateOpen(false)
        setCreateName("")
        setCreateAvatar("")
        setCreateDuplicated(false)
        await loadOrganizations({ forceRefresh: true })
        setSelectedOrganizationId(organization.id)
        selectOrganizationWorkspace?.(organization.id)
      } catch (error) {
        if (isConflictError(error)) {
          setCreateDuplicated(true)
          toast.error(t("organizations.organizationNameDuplicated"))
        } else {
          toast.error(errorMessage(error))
        }
      } finally {
        setBusyAction(null)
      }
    },
    [createAvatar, createName, loadOrganizations, selectOrganizationWorkspace, t],
  )

  const reloadMembersAndAccess = React.useCallback(async () => {
    if (selectedOrganization) {
      await loadSelectedDetails(selectedOrganization, canManage, { forceRefresh: true })
    }
  }, [canManage, loadSelectedDetails, selectedOrganization])

  const handleSelectPersonalWorkspace = React.useCallback(() => {
    setSelectedOrganizationId(null)
    selectPersonalWorkspace?.()
  }, [selectPersonalWorkspace])

  const handleSelectOrganizationWorkspace = React.useCallback(
    (organizationId: string) => {
      setSelectedOrganizationId(organizationId)
      selectOrganizationWorkspace?.(organizationId)
    },
    [selectOrganizationWorkspace],
  )

  const handleAddMember = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (!selectedOrganization || !canManage) {
        return
      }

      const userId = selectedSearchUserId ?? memberInput.trim()
      if (!userId) {
        toast.error(t("organizations.userIdRequired"))
        return
      }

      setBusyAction("add")
      try {
        await addOrganizationMember({ orgId: selectedOrganization.id, userId })
        toast.success(t("organizations.addMemberSuccess"))
        setMemberInput("")
        setSelectedSearchUserId(null)
        setMemberSearch({ error: null, items: [], loading: false, query: "" })
        setAddMemberOpen(false)
        await reloadMembersAndAccess()
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        setBusyAction(null)
      }
    },
    [canManage, memberInput, reloadMembersAndAccess, selectedOrganization, selectedSearchUserId, t],
  )

  const handleRemoveMember = React.useCallback(
    async (member: OrganizationMember) => {
      if (!selectedOrganization || !canManage) {
        return
      }

      setBusyAction(`remove:${member.user_id}`)
      try {
        await removeOrganizationMember({
          orgId: selectedOrganization.id,
          userId: member.user_id,
        })
        toast.success(t("organizations.removeMemberSuccess"))
        await reloadMembersAndAccess()
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        setBusyAction(null)
      }
    },
    [canManage, reloadMembersAndAccess, selectedOrganization, t],
  )

  const openGrantProviderAccess = React.useCallback((userId?: string) => {
    setProviderAccessForm({
      allProviders: false,
      mode: "create",
      open: true,
      providers: [],
      userId: userId ?? "",
    })
  }, [])

  const openEditProviderAccess = React.useCallback((grant: ProviderGrantView) => {
    setProviderAccessForm({
      allProviders: grant.allProviders,
      mode: "edit",
      open: true,
      providers: grant.providers.map((provider) => provider.service),
      userId: grant.userId,
    })
  }, [])

  const closeProviderAccess = React.useCallback(() => {
    if (busyAction === "saveProviderAccess") {
      return
    }
    setProviderAccessForm(initialProviderAccessForm)
  }, [busyAction])

  const handleSaveProviderAccess = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (!selectedOrganization || !canManage || providerAccessError) {
        return
      }

      const userId = providerAccessForm.userId.trim()
      if (!userId) {
        toast.error(t("organizations.memberRequired"))
        return
      }
      if (!providerAccessForm.allProviders && providerAccessForm.providers.length === 0) {
        toast.error(t("organizations.providerRequired"))
        return
      }

      setBusyAction("saveProviderAccess")
      try {
        const latest = await getOrganizationAppAccess(selectedOrganization.id)
        const parsed = parseProviderGrants(latest)
        if (!parsed.ok) {
          toast.error(t("organizations.providerAccessLoadFailed"))
          return
        }

        const existingGrant = parsed.grants.find((grant) => grant.userId === userId)
        const allProviders =
          providerAccessForm.mode === "create"
            ? providerAccessForm.allProviders || Boolean(existingGrant?.allProviders)
            : providerAccessForm.allProviders
        const providers =
          providerAccessForm.mode === "create" && existingGrant && !allProviders
            ? uniqueStrings([...existingGrant.providers, ...providerAccessForm.providers]).sort()
            : providerAccessForm.providers
        const nextAccess = setProviderGrant(parsed.access, userId, providers, allProviders)
        const updated = await updateOrganizationAppAccess(selectedOrganization.id, nextAccess)
        setAppAccessState(readyState(updated))
        setProviderAccessForm(initialProviderAccessForm)
        toast.success(t("organizations.providerAccessSaveSuccess"))
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        setBusyAction(null)
      }
    },
    [canManage, providerAccessError, providerAccessForm, selectedOrganization, t],
  )

  const handleRevokeProviderAccess = React.useCallback(
    async (grant: ProviderGrantView) => {
      if (!selectedOrganization || !canManage || providerAccessError) {
        return
      }

      setBusyAction(`revokeProviderAccess:${grant.userId}`)
      try {
        const latest = await getOrganizationAppAccess(selectedOrganization.id)
        const parsed = parseProviderGrants(latest)
        if (!parsed.ok) {
          toast.error(t("organizations.providerAccessLoadFailed"))
          return
        }
        const updated = await updateOrganizationAppAccess(
          selectedOrganization.id,
          removeProviderGrant(parsed.access, grant.userId),
        )
        setAppAccessState(readyState(updated))
        toast.success(t("organizations.providerAccessRevokeSuccess"))
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        setBusyAction(null)
      }
    },
    [canManage, providerAccessError, selectedOrganization, t],
  )

  const installRuntimeSkill = React.useCallback(
    async (skill: { packageName: string; skillName: string }) => {
      setBusyAction(`installSkill:${skill.packageName}:${skill.skillName}`)
      try {
        const nextInventory = await skillService.invoke("installRegistrySkill", {
          packageName: skill.packageName,
          skillId: skill.skillName,
        })
        skillInventory.setData(nextInventory)
        homeSummaryResource.invalidate()
        toast.success(t("skills.registryInstallDone", { name: skill.skillName }))
      } catch (error) {
        toast.error(t("skills.registryInstallFailed", { error: errorMessage(error) }))
      } finally {
        setBusyAction(null)
      }
    },
    [homeSummaryResource, skillInventory, skillService, t],
  )

  const installRuntimeSkills = React.useCallback(
    async (skills: readonly { packageName: string; skillName: string }[]) => {
      const targets = skills.filter((skill) => skill.packageName.trim() && skill.skillName.trim())
      if (targets.length === 0 || busyAction) {
        return
      }

      setBusyAction("installSkillBatch")
      let installedCount = 0
      let failedCount = 0
      let firstError: unknown
      try {
        for (const skill of targets) {
          try {
            const nextInventory = await skillService.invoke("installRegistrySkill", {
              packageName: skill.packageName,
              skillId: skill.skillName,
            })
            skillInventory.setData(nextInventory)
            installedCount += 1
          } catch (error) {
            failedCount += 1
            firstError ??= error
          }
        }
        homeSummaryResource.invalidate()
        if (installedCount > 0) {
          toast.success(t("organizations.skillManageInstallMissingSuccess", { count: installedCount }))
        }
        if (failedCount > 0) {
          toast.error(
            t("organizations.skillManageInstallMissingFailed", {
              count: failedCount,
              error: errorMessage(firstError),
            }),
          )
        }
      } finally {
        setBusyAction(null)
      }
    },
    [busyAction, homeSummaryResource, skillInventory, skillService, t],
  )

  const linkOrganizationSkill = React.useCallback(
    async (input: OrganizationSkillLinkInput, options: { installRuntime: boolean }) => {
      if (!selectedOrganizationSkills?.canManage) {
        return
      }

      await selectedOrganizationSkills.addSkill({
        packageName: input.packageName,
        skillName: input.skillName,
        version: input.version,
        versionPolicy: "pinned",
      })
      if (options.installRuntime) {
        const nextInventory = await skillService.invoke("installRegistrySkill", {
          packageName: input.packageName,
          skillId: input.skillName,
        })
        skillInventory.setData(nextInventory)
        homeSummaryResource.invalidate()
      }
    },
    [homeSummaryResource, selectedOrganizationSkills, skillInventory, skillService],
  )

  const addOrganizationSkillFromRecommendation = React.useCallback(
    async (recommendation: ProviderSkillRecommendation, options: { installRuntime: boolean }) => {
      if (!selectedOrganizationSkills?.canManage || busyAction) {
        return
      }

      setBusyAction(`addSkill:${recommendation.packageName}:${recommendation.skillId}`)
      try {
        await linkOrganizationSkill(
          {
            packageName: recommendation.packageName,
            skillName: recommendation.skillId,
            version: recommendation.package.version,
          },
          options,
        )
        toast.success(t("organizations.skillManageAddSuccess"))
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        setBusyAction(null)
      }
    },
    [busyAction, linkOrganizationSkill, selectedOrganizationSkills?.canManage, t],
  )

  const addOrganizationSkillFromPackage = React.useCallback(
    async (pkg: PublicSkillPackage, options: { installRuntime: boolean; skillName?: string }) => {
      if (!selectedOrganizationSkills?.canManage || busyAction) {
        return
      }

      const input = publicPackageLinkInput(pkg, options.skillName)
      if (!input) {
        toast.error(t("skills.discoverInstallNoSkill"))
        return
      }

      setBusyAction(`addSkill:${input.packageName}:${input.skillName}`)
      try {
        await linkOrganizationSkill(input, options)
        toast.success(t("organizations.skillManageAddSuccess"))
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        setBusyAction(null)
      }
    },
    [busyAction, linkOrganizationSkill, selectedOrganizationSkills?.canManage, t],
  )

  const addOrganizationSkillBatch = React.useCallback(
    async (recommendations: readonly ProviderSkillRecommendation[], options: { installRuntime: boolean }) => {
      if (!selectedOrganizationSkills?.canManage || recommendations.length === 0 || busyAction) {
        return
      }

      const plan = planOrganizationSkillBulkLinks(recommendations, selectedOrganizationSkills.skills)
      if (plan.linkable.length === 0) {
        return
      }

      setBusyAction("addSkillBatch")
      let linkedCount = 0
      let failedCount = 0
      let firstError: unknown
      try {
        for (const recommendation of plan.linkable) {
          try {
            await linkOrganizationSkill(
              {
                packageName: recommendation.packageName,
                skillName: recommendation.skillId,
                version: recommendation.package.version,
              },
              options,
            )
            linkedCount += 1
          } catch (error) {
            failedCount += 1
            firstError ??= error
          }
        }
        if (linkedCount > 0) {
          toast.success(
            options.installRuntime
              ? t("organizations.skillManageBulkAddInstallSuccess", { count: linkedCount })
              : t("organizations.skillManageBulkAddSuccess", { count: linkedCount }),
          )
        }
        if (failedCount > 0) {
          toast.error(
            t("organizations.skillManageBulkAddFailed", {
              count: failedCount,
              error: errorMessage(firstError),
            }),
          )
        }
      } finally {
        setBusyAction(null)
      }
    },
    [busyAction, linkOrganizationSkill, selectedOrganizationSkills, t],
  )

  return (
    <>
      <div className="h-full min-h-0 overflow-auto px-3 py-3">
        {showOverviewError ? (
          <div className="flex min-h-full items-center justify-center px-4 py-10">
            <ErrorBlock
              error={overviewState.error ?? ""}
              onRetry={() => void loadOrganizations({ forceRefresh: true })}
            />
          </div>
        ) : showOrganizationEmptyState ? (
          <EmptyOrganizationsState onCreate={() => setCreateOpen(true)} />
        ) : (
          <div className="grid min-w-0 items-start gap-3">
            {showOverviewLoading ? (
              <OrganizationManagementSkeleton />
            ) : (
              <>
                <OrganizationSwitcherPanel
                  activeWorkspace={activeWorkspace}
                  accountAvatarUrl={activeAccount?.avatarUrl}
                  accountName={activeAccount?.name}
                  organizations={organizations}
                  overview={overviewState.data}
                  selectedOrganization={selectedOrganization}
                  selectedOrganizationId={selectedOrganizationId}
                  onCreate={() => setCreateOpen(true)}
                  onSelect={handleSelectOrganizationWorkspace}
                  onSelectPersonal={handleSelectPersonalWorkspace}
                />
                {selectedOrganization && selectedOrganizationSkills ? (
                  <OrganizationSkillGuidePanel
                    busyAction={busyAction}
                    groupById={skillGroupById}
                    organizationSkills={selectedOrganizationSkills}
                    providerRecommendations={providerSkillRecommendations}
                    onAddRecommendation={addOrganizationSkillFromRecommendation}
                    onAddRecommendationBatch={addOrganizationSkillBatch}
                    onAddMarketPackage={addOrganizationSkillFromPackage}
                    onInstallRuntimeSkill={installRuntimeSkill}
                    onInstallRuntimeSkills={installRuntimeSkills}
                    onOpenOrganizationSkills={onOpenOrganizationSkills}
                  />
                ) : null}
                <OrganizationDetailPanel
                  appAccessLoading={appAccessState.status === "loading" || providerOptionsState.status === "loading"}
                  busyAction={busyAction}
                  canManage={canManage}
                  grantsByUserId={grantsByUserId}
                  members={memberViews}
                  membersError={membersState.error}
                  membersLoading={membersState.status === "loading"}
                  organization={selectedOrganization}
                  providerAccessError={providerAccessError}
                  onAddMember={() => setAddMemberOpen(true)}
                  onEditProviderAccess={openEditProviderAccess}
                  onGrantProviderAccess={openGrantProviderAccess}
                  onRemoveMember={handleRemoveMember}
                  onRevokeProviderAccess={handleRevokeProviderAccess}
                />
              </>
            )}
          </div>
        )}
      </div>
      <CreateOrganizationDialog
        avatar={createAvatar}
        busy={busyAction === "create"}
        name={createName}
        nameError={createNameError}
        open={createOpen}
        onAvatarChange={setCreateAvatar}
        onClose={() => {
          if (busyAction !== "create") {
            setCreateOpen(false)
          }
        }}
        onNameChange={(value) => {
          setCreateName(value)
          setCreateDuplicated(false)
        }}
        onSubmit={handleCreateOrganization}
      />
      <AddMemberDialog
        busy={busyAction === "add"}
        input={memberInput}
        open={addMemberOpen}
        search={memberSearch}
        onClose={() => {
          if (busyAction !== "add") {
            setAddMemberOpen(false)
            setMemberInput("")
            setSelectedSearchUserId(null)
          }
        }}
        onInputChange={(value) => {
          setMemberInput(value)
          setSelectedSearchUserId(null)
        }}
        onSearchSelect={(user) => {
          setMemberInput(user.username)
          setSelectedSearchUserId(user.userId)
        }}
        onSubmit={handleAddMember}
      />
      <ProviderAccessDialog
        busy={busyAction === "saveProviderAccess"}
        form={providerAccessForm}
        memberOptions={memberViews.filter((member) => member.role !== "creator")}
        providerOptions={providerOptionsWithSelected(providerOptionsState.data, providerAccessForm.providers)}
        onClose={closeProviderAccess}
        onFormChange={setProviderAccessForm}
        onSubmit={handleSaveProviderAccess}
      />
    </>
  )
}

function OrganizationSwitcherPanel({
  activeWorkspace,
  accountAvatarUrl,
  accountName,
  onCreate,
  onSelect,
  onSelectPersonal,
  organizations,
  overview,
  selectedOrganization,
  selectedOrganizationId,
}: {
  activeWorkspace?: WorkspaceSelection
  accountAvatarUrl?: string
  accountName?: string
  onCreate: () => void
  onSelect: (organizationId: string) => void
  onSelectPersonal: () => void
  organizations: Organization[]
  overview: OrganizationOverview | null
  selectedOrganization: Organization | null
  selectedOrganizationId: string | null
}) {
  const { t } = useAppI18n()
  const countLabel = t("organizations.organizationCount", { count: organizations.length })
  const selectedRole = selectedOrganization ? organizationRole(overview, selectedOrganization) : null
  const personalSelected = activeWorkspace?.type === "personal"
  const personalLabel = accountName?.trim() || t("organizations.personal")
  const personalDescription =
    personalLabel === t("organizations.personal") ? t("organizations.workspace") : t("organizations.personal")

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0">
            {personalSelected ? (
              <AccountWorkspaceAvatar
                avatarUrl={accountAvatarUrl}
                className="size-16 rounded-md text-lg"
                name={accountName}
              />
            ) : selectedOrganization ? (
              <OrganizationAvatar organization={selectedOrganization} className="size-16 rounded-md text-lg" />
            ) : (
              <div className="grid size-16 place-items-center rounded-md bg-muted text-muted-foreground">
                <Building2Icon className="size-5" />
              </div>
            )}
          </div>

          <div className="grid min-h-16 min-w-0 content-center gap-1.5">
            <div className="flex min-w-0 items-baseline gap-3">
              {personalSelected ? (
                <span className="oo-text-dialog-title min-w-0 truncate text-foreground">{personalLabel}</span>
              ) : selectedOrganization ? (
                <>
                  <span className="oo-text-dialog-title min-w-0 truncate text-foreground">
                    {selectedOrganization.name}
                  </span>
                  <span className="oo-text-caption-compact min-w-0 truncate font-mono text-muted-foreground">
                    {selectedOrganization.id}
                  </span>
                </>
              ) : (
                <span className="oo-text-body min-w-0 truncate text-muted-foreground">
                  {t("organizations.selectOrganization")}
                </span>
              )}
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <span className="oo-text-caption shrink-0">
                {personalSelected ? t("organizations.selectedWorkspace") : t("organizations.selectedOrganization")}
              </span>
              {personalSelected ? (
                <Badge variant="secondary" className="shrink-0">
                  {t("organizations.workspace")}
                </Badge>
              ) : selectedRole ? (
                <Badge variant="secondary" className="shrink-0">
                  {selectedRole === "creator" ? t("organizations.roleCreator") : t("organizations.roleMember")}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid min-w-0 gap-2 sm:h-16 sm:min-w-fit sm:shrink-0 sm:content-between sm:justify-items-end sm:gap-0">
          <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={onCreate}>
            <PlusIcon className="size-3.5" />
            {t("organizations.createOrganization")}
          </Button>
          <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-end">
            <span className="oo-text-body shrink-0 text-muted-foreground">{countLabel}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="px-2">
                  {t("organizations.switchOrganization")}
                  <ChevronsUpDownIcon className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="w-[min(36rem,calc(100vw-2rem))]">
                <DropdownMenuLabel>{t("organizations.selectWorkspace")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className={cn(
                    "grid min-h-14 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-2",
                    personalSelected && "bg-accent",
                  )}
                  onSelect={onSelectPersonal}
                >
                  <AccountWorkspaceAvatar
                    avatarUrl={accountAvatarUrl}
                    className="size-10 rounded-md text-sm"
                    name={accountName}
                  />
                  <span className="grid min-h-10 min-w-0 content-center">
                    <span className="flex min-h-5 min-w-0 items-center gap-2">
                      <span className="oo-text-label truncate">{personalLabel}</span>
                      {personalSelected ? (
                        <span className="size-2 shrink-0 rounded-full bg-[var(--success)]" aria-hidden="true" />
                      ) : null}
                    </span>
                    <span className="oo-text-caption-compact block truncate text-muted-foreground">
                      {personalDescription}
                    </span>
                  </span>
                  {personalSelected ? <CheckIcon className="size-4 justify-self-end" /> : null}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {organizations.map((organization) => {
                  const role = organizationRole(overview, organization)
                  const selected = !personalSelected && organization.id === selectedOrganizationId
                  return (
                    <DropdownMenuItem
                      key={organization.id}
                      className={cn(
                        "grid min-h-14 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-2",
                        selected && "bg-accent",
                      )}
                      onSelect={() => onSelect(organization.id)}
                    >
                      <OrganizationAvatar organization={organization} className="size-10 rounded-md text-sm" />
                      <span className="grid min-h-10 min-w-0 content-center">
                        <span className="flex min-h-5 min-w-0 items-center gap-2">
                          <span className="oo-text-label truncate">{organization.name}</span>
                          {selected ? (
                            <span className="size-2 shrink-0 rounded-full bg-[var(--success)]" aria-hidden="true" />
                          ) : null}
                        </span>
                        <span className="oo-text-caption-compact block truncate font-mono text-muted-foreground">
                          {organization.id}
                        </span>
                      </span>
                      <Badge variant="secondary" className="justify-self-end">
                        {role === "creator" ? t("organizations.roleCreator") : t("organizations.roleMember")}
                      </Badge>
                    </DropdownMenuItem>
                  )
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2 py-2" onSelect={onCreate}>
                  <PlusIcon className="size-4" />
                  <span>{t("organizations.createOrganization")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </section>
  )
}

function organizationSkillGuideStatus(
  organizationSkills: UseOrganizationSkills,
  t: ReturnType<typeof useAppI18n>["t"],
): string {
  const enabledCount = organizationSkills.skills.filter((skill) => skill.enabled).length
  if (!organizationSkills.apiEnabled) {
    return t("organizations.skillGuideUnavailableBadge")
  }
  if (organizationSkills.loading && !organizationSkills.hasLoaded) {
    return t("organizations.skillGuideLoading")
  }
  if (organizationSkills.error) {
    return t("organizations.skillGuideLoadFailed")
  }
  return enabledCount > 0
    ? t("organizations.skillGuideEnabledCount", { count: enabledCount })
    : t("organizations.skillGuideEmptyBadge")
}

function organizationSkillGuideActionLabel(
  organizationSkills: UseOrganizationSkills,
  t: ReturnType<typeof useAppI18n>["t"],
): string {
  if (!organizationSkills.canManage) {
    return t("organizations.skillGuideView")
  }
  return organizationSkills.apiEnabled && organizationSkills.skills.length > 0
    ? t("organizations.skillGuideManage")
    : t("organizations.skillGuideConfigure")
}

function OrganizationSkillGuidePanel({
  busyAction,
  groupById,
  organizationSkills,
  providerRecommendations,
  onAddRecommendation,
  onAddRecommendationBatch,
  onAddMarketPackage,
  onInstallRuntimeSkill,
  onInstallRuntimeSkills,
  onOpenOrganizationSkills,
}: {
  busyAction: BusyAction | null
  groupById: ReadonlyMap<string, ManagedSkillGroup>
  organizationSkills: UseOrganizationSkills
  providerRecommendations: ProviderSkillRecommendation[]
  onAddRecommendation: (
    recommendation: ProviderSkillRecommendation,
    options: { installRuntime: boolean },
  ) => Promise<void>
  onAddRecommendationBatch: (
    recommendations: readonly ProviderSkillRecommendation[],
    options: { installRuntime: boolean },
  ) => Promise<void>
  onAddMarketPackage: (
    pkg: PublicSkillPackage,
    options: { installRuntime: boolean; skillName?: string },
  ) => Promise<void>
  onInstallRuntimeSkill: (skill: { packageName: string; skillName: string }) => void
  onInstallRuntimeSkills: (skills: readonly { packageName: string; skillName: string }[]) => void
  onOpenOrganizationSkills?: () => void
}) {
  const { t } = useAppI18n()
  const [manageOpen, setManageOpen] = React.useState(false)
  const statusLabel = organizationSkillGuideStatus(organizationSkills, t)
  const actionLabel = organizationSkillGuideActionLabel(organizationSkills, t)
  const canOpenSettings = organizationSkills.apiEnabled || organizationSkills.canManage

  return (
    <>
      <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
        <div className="flex min-w-0 flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-md border bg-[var(--oo-inspector-surface)] text-muted-foreground">
              <PackageIcon className="size-5" />
            </div>
            <div className="grid min-w-0 gap-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="oo-text-title min-w-0 truncate text-foreground">{t("organizations.skillGuideTitle")}</h2>
                <Badge variant="outline" className="max-w-full shrink-0">
                  <span className="truncate">{statusLabel}</span>
                </Badge>
              </div>
              <p className="oo-text-body max-w-3xl text-muted-foreground">{t("organizations.skillGuideDescription")}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-end md:self-center">
            {canOpenSettings ? (
              <Button type="button" size="sm" onClick={() => setManageOpen(true)}>
                {actionLabel}
              </Button>
            ) : null}
          </div>
        </div>
      </section>
      <OrganizationSkillManageDialog
        busyAction={busyAction}
        groupById={groupById}
        open={manageOpen}
        organizationSkills={organizationSkills}
        providerRecommendations={providerRecommendations}
        onAddRecommendation={onAddRecommendation}
        onAddRecommendationBatch={onAddRecommendationBatch}
        onAddMarketPackage={onAddMarketPackage}
        onClose={() => setManageOpen(false)}
        onInstallRuntimeSkill={onInstallRuntimeSkill}
        onInstallRuntimeSkills={onInstallRuntimeSkills}
        onOpenAdvanced={onOpenOrganizationSkills}
      />
    </>
  )
}

function organizationRuntimeStatusLabel(
  state: ReturnType<typeof getOrganizationSkillRuntimeStatus>["state"],
  t: ReturnType<typeof useAppI18n>["t"],
): string {
  switch (state) {
    case "installed-same":
      return t("skills.organizationRuntimeInstalled")
    case "installed-modified":
      return t("skills.organizationRuntimeModified")
    case "installed-version-mismatch":
      return t("skills.organizationRuntimeVersionMismatch")
    case "same-id-different-package":
      return t("skills.organizationRuntimePackageConflict")
    case "local-conflict":
    case "unknown-conflict":
      return t("skills.organizationRuntimeLocalConflict")
    case "external-only":
    case "missing":
      return t("skills.organizationRuntimeMissing")
  }
}

function organizationRuntimeStatusTone(
  state: ReturnType<typeof getOrganizationSkillRuntimeStatus>["state"],
): "attention" | "pending" | "ready" {
  return state === "installed-same"
    ? "ready"
    : state === "missing" || state === "external-only"
      ? "pending"
      : "attention"
}

export function OrganizationSkillManageDialog({
  busyAction,
  groupById,
  onAddRecommendation,
  onAddRecommendationBatch,
  onAddMarketPackage,
  onClose = () => undefined,
  onInstallRuntimeSkill,
  onInstallRuntimeSkills,
  onOpenAdvanced,
  open = true,
  organizationSkills,
  providerRecommendations,
  variant = "dialog",
}: {
  busyAction: BusyAction | null
  groupById: ReadonlyMap<string, ManagedSkillGroup>
  onAddRecommendation: (
    recommendation: ProviderSkillRecommendation,
    options: { installRuntime: boolean },
  ) => Promise<void>
  onAddRecommendationBatch: (
    recommendations: readonly ProviderSkillRecommendation[],
    options: { installRuntime: boolean },
  ) => Promise<void>
  onAddMarketPackage: (
    pkg: PublicSkillPackage,
    options: { installRuntime: boolean; skillName?: string },
  ) => Promise<void>
  onClose?: () => void
  onInstallRuntimeSkill: (skill: { packageName: string; skillName: string }) => void
  onInstallRuntimeSkills: (skills: readonly { packageName: string; skillName: string }[]) => void
  onOpenAdvanced?: () => void
  open?: boolean
  organizationSkills: UseOrganizationSkills
  providerRecommendations: ProviderSkillRecommendation[]
  variant?: "dialog" | "inline"
}) {
  const { t } = useAppI18n()
  const isActive = variant === "inline" || open
  const [busyConfigId, setBusyConfigId] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<OrganizationSkillManageTab>("configured")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [marketCatalog, dispatchMarketCatalog] = React.useReducer(
    publicPackageCatalogReducer,
    initialPublicPackageCatalogState,
  )
  const [marketExactPackage, setMarketExactPackage] = React.useState<PublicSkillPackage | null>(null)
  const [marketExactLoading, setMarketExactLoading] = React.useState(false)
  const marketRequestIdRef = React.useRef(0)
  const marketExactRequestIdRef = React.useRef(0)
  const marketAutoLoadRequestedRef = React.useRef(false)
  const marketScrollContainerRef = React.useRef<HTMLDivElement | null>(null)
  const marketLoadMoreAnchorRef = React.useRef<HTMLDivElement | null>(null)
  const linkedPackageKeys = React.useMemo(
    () => createOrganizationSkillPackageSet(organizationSkills.skills),
    [organizationSkills.skills],
  )
  const recommendedPlan = React.useMemo(
    () => planOrganizationSkillBulkLinks(providerRecommendations, organizationSkills.skills),
    [organizationSkills.skills, providerRecommendations],
  )
  const recommendedOrganizationSkills = recommendedPlan.linkable
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const marketQuery = activeTab === "market" ? searchQuery.trim() : ""
  const filteredConfiguredSkills = React.useMemo(
    () => organizationSkills.skills.filter((skill) => organizationSkillMatchesQuery(skill, normalizedQuery)),
    [normalizedQuery, organizationSkills.skills],
  )
  const filteredRecommendedSkills = React.useMemo(
    () =>
      recommendedOrganizationSkills.filter((recommendation) =>
        providerRecommendationMatchesQuery(recommendation, normalizedQuery),
      ),
    [normalizedQuery, recommendedOrganizationSkills],
  )
  const installableConfiguredSkills = React.useMemo(
    () =>
      organizationSkills.skills.filter((skill) => {
        const state = getOrganizationSkillRuntimeStatus(groupById, skill).state
        return skill.enabled && (state === "missing" || state === "external-only")
      }),
    [groupById, organizationSkills.skills],
  )
  const marketPackages = React.useMemo(
    () => mergeMarketPackages(marketExactPackage, marketCatalog.items),
    [marketCatalog.items, marketExactPackage],
  )
  const marketLoading = marketCatalog.status === "loading" || marketCatalog.status === "refreshing"
  const marketLoadingMore = marketCatalog.status === "loading-more"
  const canLoadMoreMarket = Boolean(marketCatalog.next) && !marketLoading && !marketLoadingMore

  React.useEffect(() => {
    if (!marketLoadingMore) {
      marketAutoLoadRequestedRef.current = false
    }
  }, [marketLoadingMore, marketCatalog.next])

  React.useEffect(() => {
    if (!isActive) {
      return
    }
    setActiveTab(recommendedOrganizationSkills.length > 0 ? "recommended" : "configured")
    setSearchQuery("")
    setMarketExactPackage(null)
    setMarketExactLoading(false)
  }, [isActive, organizationSkills.organizationId, recommendedOrganizationSkills.length])

  const loadMarketPackages = React.useCallback(
    async (options: { clearItems?: boolean; forceRefresh?: boolean; next?: string | null; query?: string } = {}) => {
      const query = options.query?.trim() ?? ""
      const next = options.next?.trim() || undefined
      const append = Boolean(next && !options.forceRefresh)
      const requestId = marketRequestIdRef.current + 1
      marketRequestIdRef.current = requestId
      dispatchMarketCatalog({ append, clearItems: options.clearItems, requestId, type: "load-start" })

      try {
        const catalog = query
          ? await searchPublicSkillPackages({ next, query })
          : await listPublicSkillPackages({ next })
        dispatchMarketCatalog({ append, catalog, requestId, type: "load-success" })
      } catch (error) {
        dispatchMarketCatalog({ error: errorMessage(error), requestId, type: "load-error" })
      }
    },
    [],
  )

  React.useEffect(() => {
    if (!isActive || activeTab !== "market") {
      return
    }

    const load = () => {
      void loadMarketPackages({ clearItems: true, forceRefresh: true, query: marketQuery }).catch(() => undefined)
    }

    if (!marketQuery) {
      load()
      return
    }

    const timer = window.setTimeout(load, 300)
    return () => window.clearTimeout(timer)
  }, [activeTab, isActive, loadMarketPackages, marketQuery])

  React.useEffect(() => {
    const query = searchQuery.trim()
    const requestId = marketExactRequestIdRef.current + 1
    marketExactRequestIdRef.current = requestId
    setMarketExactPackage(null)
    setMarketExactLoading(false)

    if (!isActive || activeTab !== "market" || !looksLikeSkillPackageName(query)) {
      return
    }

    setMarketExactLoading(true)
    const timer = window.setTimeout(() => {
      void readPublicSkillPackageByName(query)
        .then((pkg) => {
          if (marketExactRequestIdRef.current === requestId) {
            setMarketExactPackage(pkg)
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (marketExactRequestIdRef.current === requestId) {
            setMarketExactLoading(false)
          }
        })
    }, 250)

    return () => window.clearTimeout(timer)
  }, [activeTab, isActive, searchQuery])

  const changeActiveTab = React.useCallback((tab: OrganizationSkillManageTab) => {
    setActiveTab(tab)
    setSearchQuery("")
  }, [])

  const requestNextMarketPage = React.useCallback(() => {
    if (!canLoadMoreMarket || marketAutoLoadRequestedRef.current) {
      return
    }

    marketAutoLoadRequestedRef.current = true
    void loadMarketPackages({ next: marketCatalog.next, query: marketQuery })
  }, [canLoadMoreMarket, loadMarketPackages, marketCatalog.next, marketQuery])

  const handleMarketScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!isNearScrollBottom(event.currentTarget)) {
        return
      }

      requestNextMarketPage()
    },
    [requestNextMarketPage],
  )

  React.useEffect(() => {
    const root = marketScrollContainerRef.current
    const target = marketLoadMoreAnchorRef.current
    if (!root || !target || !canLoadMoreMarket) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          requestNextMarketPage()
        }
      },
      { root, rootMargin: "160px 0px" },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [canLoadMoreMarket, marketPackages.length, requestNextMarketPage])

  React.useEffect(() => {
    if (marketCatalog.status !== "idle") {
      return
    }

    const element = marketScrollContainerRef.current
    if (element && isNearScrollBottom(element)) {
      requestNextMarketPage()
    }
  }, [marketCatalog.status, marketPackages.length, requestNextMarketPage])

  const updateOrganizationSkill = async (
    skill: UseOrganizationSkills["skills"][number],
    input: { enabled: boolean },
  ): Promise<void> => {
    if (!organizationSkills.canManage || busyConfigId) {
      return
    }
    setBusyConfigId(skill.id)
    try {
      await organizationSkills.updateSkill(skill.id, input)
      toast.success(input.enabled ? t("skills.organizationSkillEnabled") : t("skills.organizationSkillDisabled"))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusyConfigId(null)
    }
  }

  const removeOrganizationSkill = async (skill: UseOrganizationSkills["skills"][number]): Promise<void> => {
    if (!organizationSkills.canManage || busyConfigId) {
      return
    }
    const confirmed = window.confirm(t("skills.organizationRemoveConfirm", { name: skill.displayName }))
    if (!confirmed) {
      return
    }
    setBusyConfigId(skill.id)
    try {
      await organizationSkills.removeSkill(skill.id)
      toast.success(t("skills.organizationSkillRemoved"))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusyConfigId(null)
    }
  }

  const content = (
    <div className={cn("grid min-h-full grid-rows-[minmax(0,1fr)] gap-4", variant === "inline" && "h-full min-h-0")}>
      {!organizationSkills.apiEnabled ? (
        <OrganizationSkillDialogEmpty
          title={t("organizations.skillGuideUnavailableTitle")}
          description={t("organizations.skillGuideUnavailableDescription")}
        />
      ) : organizationSkills.error ? (
        <div className="grid gap-2">
          <ErrorNotice error={organizationSkills.error} compact />
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void organizationSkills.refresh({ forceRefresh: true })}
            >
              <RefreshCwIcon className="size-3.5" />
              {t("organizations.retry")}
            </Button>
          </div>
        </div>
      ) : organizationSkills.loading && !organizationSkills.hasLoaded ? (
        <div className="grid content-start gap-2">
          <Skeleton className="h-16 rounded-md" />
          <Skeleton className="h-16 rounded-md" />
          <Skeleton className="h-16 rounded-md" />
        </div>
      ) : (
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
          <div className="grid min-w-0 gap-2 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={activeTab}
              aria-label={t("organizations.skillManageTitle")}
              onValueChange={(value) => {
                if (value === "configured" || value === "recommended" || value === "market") {
                  changeActiveTab(value)
                }
              }}
            >
              <ToggleGroupItem value="configured">
                <span>{t("organizations.skillManageConfigured")}</span>
                <span className="oo-text-caption-compact text-muted-foreground">
                  {organizationSkills.skills.length}
                </span>
              </ToggleGroupItem>
              <ToggleGroupItem value="recommended">
                <span>{t("organizations.skillManageRecommended")}</span>
                {recommendedOrganizationSkills.length > 0 ? (
                  <span className="size-2 shrink-0 rounded-full bg-[var(--success)]" aria-hidden="true" />
                ) : null}
                <span className="oo-text-caption-compact text-muted-foreground">
                  {recommendedOrganizationSkills.length}
                </span>
              </ToggleGroupItem>
              <ToggleGroupItem value="market">
                <span>{t("organizations.skillManageMarket")}</span>
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <SearchField
                className="min-w-0 flex-1 sm:max-w-72"
                inputClassName="h-[var(--oo-control-height-compact)]"
                placeholder={
                  activeTab === "configured"
                    ? t("organizations.skillManageSearchConfigured")
                    : activeTab === "recommended"
                      ? t("organizations.skillManageSearchRecommended")
                      : t("organizations.skillManageSearchMarket")
                }
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
              />
              {activeTab === "configured" && installableConfiguredSkills.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={Boolean(busyAction)}
                  onClick={() => onInstallRuntimeSkills(installableConfiguredSkills)}
                >
                  {busyAction === "installSkillBatch" ? (
                    <RefreshCwIcon className="size-3.5 animate-spin" />
                  ) : (
                    <PackageIcon className="size-3.5" />
                  )}
                  {t("organizations.skillManageInstallMissingAll", {
                    count: installableConfiguredSkills.length,
                  })}
                </Button>
              ) : null}
              {activeTab === "recommended" &&
              organizationSkills.canManage &&
              recommendedOrganizationSkills.length > 1 ? (
                <div className="inline-flex max-w-full items-center justify-end">
                  <Button
                    type="button"
                    size="sm"
                    className="min-w-0 rounded-r-none"
                    disabled={Boolean(busyAction)}
                    onClick={() => onAddRecommendationBatch(recommendedOrganizationSkills, { installRuntime: true })}
                  >
                    {busyAction === "addSkillBatch" ? (
                      <RefreshCwIcon className="size-3.5 animate-spin" />
                    ) : (
                      <PackageIcon className="size-3.5" />
                    )}
                    <span className="truncate">
                      {t("organizations.skillManageAddInstallAll", { count: recommendedOrganizationSkills.length })}
                    </span>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        className="-ml-px w-[var(--oo-control-height-compact)] rounded-l-none border-l border-primary-foreground/25 px-0"
                        disabled={Boolean(busyAction)}
                        aria-label={t("organizations.skillManageMoreActions")}
                      >
                        <ChevronDownIcon className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() =>
                          void onAddRecommendationBatch(recommendedOrganizationSkills, { installRuntime: false })
                        }
                      >
                        {t("organizations.skillManageLinkAll", { count: recommendedOrganizationSkills.length })}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : null}
            </div>
          </div>
          {activeTab === "configured" ? (
            organizationSkills.skills.length === 0 ? (
              <OrganizationSkillDialogEmpty
                title={
                  organizationSkills.canManage
                    ? t("organizations.skillGuideEmptyCreatorTitle")
                    : t("organizations.skillGuideEmptyTitle")
                }
                description={
                  organizationSkills.canManage
                    ? t("organizations.skillGuideEmptyCreatorDescription")
                    : t("organizations.skillGuideEmptyDescription")
                }
              />
            ) : filteredConfiguredSkills.length === 0 ? (
              <OrganizationSkillDialogEmpty
                title={t("organizations.skillManageSearchEmptyTitle")}
                description={t("organizations.skillManageSearchEmptyDescription")}
              />
            ) : (
              <div className="min-h-0 overflow-y-auto rounded-md border bg-background">
                {filteredConfiguredSkills.map((skill) => (
                  <OrganizationSkillManageRow
                    key={skill.id}
                    busy={busyConfigId === skill.id || busyAction === "installSkillBatch"}
                    canManage={organizationSkills.canManage}
                    groupById={groupById}
                    installBusy={
                      busyAction === `installSkill:${skill.packageName}:${skill.skillName}` ||
                      busyAction === "installSkillBatch"
                    }
                    skill={skill}
                    onInstallRuntime={() =>
                      onInstallRuntimeSkill({ packageName: skill.packageName, skillName: skill.skillName })
                    }
                    onRemove={() => void removeOrganizationSkill(skill)}
                    onToggleEnabled={() => void updateOrganizationSkill(skill, { enabled: !skill.enabled })}
                  />
                ))}
              </div>
            )
          ) : activeTab === "recommended" ? (
            recommendedOrganizationSkills.length === 0 ? (
              <div className="oo-text-caption rounded-md border border-dashed bg-muted/20 px-3 py-4 text-muted-foreground">
                {t("organizations.skillManageRecommendedEmpty")}
              </div>
            ) : filteredRecommendedSkills.length === 0 ? (
              <OrganizationSkillDialogEmpty
                title={t("organizations.skillManageSearchEmptyTitle")}
                description={t("organizations.skillManageSearchEmptyDescription")}
              />
            ) : (
              <div className="min-h-0 overflow-y-auto rounded-md border bg-background">
                {filteredRecommendedSkills.map((recommendation) => {
                  const busyKey = `addSkill:${recommendation.packageName}:${recommendation.skillId}`
                  return (
                    <OrganizationSkillRecommendationRow
                      key={`${recommendation.service}:${recommendation.packageName}:${recommendation.skillId}`}
                      busy={busyAction === busyKey || busyAction === "addSkillBatch"}
                      canManage={organizationSkills.canManage}
                      recommendation={recommendation}
                      onAdd={() => onAddRecommendation(recommendation, { installRuntime: false })}
                      onAddAndInstall={() => onAddRecommendation(recommendation, { installRuntime: true })}
                    />
                  )
                })}
              </div>
            )
          ) : (
            <div className="flex min-h-0 flex-col gap-2">
              {marketCatalog.error ? (
                <div className="flex min-w-0 items-start gap-2">
                  <ErrorNotice
                    error={resolveUserFacingError(marketCatalog.error, { area: "skills" })}
                    compact
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={marketLoading}
                    onClick={() =>
                      void loadMarketPackages({ clearItems: true, forceRefresh: true, query: marketQuery })
                    }
                  >
                    <RefreshCwIcon className={cn("size-3.5", marketLoading && "animate-spin")} />
                    {t("organizations.retry")}
                  </Button>
                </div>
              ) : null}
              {(marketLoading || marketExactLoading) && marketPackages.length === 0 ? (
                <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-background">
                  <OrganizationSkillPackageListSkeleton />
                </div>
              ) : marketPackages.length === 0 ? (
                <OrganizationSkillDialogEmpty
                  className="min-h-0 flex-1"
                  title={t("organizations.skillManageMarketEmptyTitle")}
                  description={t("organizations.skillManageMarketEmptyDescription")}
                />
              ) : (
                <div
                  ref={marketScrollContainerRef}
                  className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-background"
                  onScroll={handleMarketScroll}
                >
                  {marketPackages.map((pkg) => (
                    <OrganizationSkillMarketRow
                      key={pkg.id}
                      busyAction={busyAction}
                      canManage={organizationSkills.canManage}
                      groupById={groupById}
                      linked={organizationSkillPackageLinked(linkedPackageKeys, pkg.name)}
                      pkg={pkg}
                      onAdd={(skillName) => onAddMarketPackage(pkg, { installRuntime: false, skillName })}
                      onAddAndInstall={(skillName) => onAddMarketPackage(pkg, { installRuntime: true, skillName })}
                      onManageLinked={() => {
                        setActiveTab("configured")
                        setSearchQuery(pkg.name)
                      }}
                    />
                  ))}
                  <div ref={marketLoadMoreAnchorRef} className="h-px" aria-hidden="true" />
                  {marketLoadingMore ? (
                    <div className="oo-border-divider flex justify-center border-t px-3 py-2">
                      <div className="oo-text-caption-compact inline-flex items-center gap-1.5 text-muted-foreground">
                        <RefreshCwIcon className="size-3.5 animate-spin" />
                        {t("skills.discoverLoadingMore")}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )

  if (variant === "inline") {
    return content
  }

  return (
    <Dialog
      open={open}
      ariaLabel={t("organizations.skillManageTitle")}
      title={t("organizations.skillManageTitle")}
      className="h-[min(44rem,85vh)] max-w-[min(60rem,calc(100vw-2rem))]"
      closeLabel={t("common.cancel")}
      footer={
        <>
          {onOpenAdvanced ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onClose()
                onOpenAdvanced()
              }}
            >
              {t("organizations.skillManageOpenAdvanced")}
            </Button>
          ) : null}
          <Button type="button" onClick={onClose}>
            {t("organizations.skillManageDone")}
          </Button>
        </>
      }
      onClose={onClose}
    >
      {content}
    </Dialog>
  )
}

function OrganizationSkillDialogEmpty({
  className,
  description,
  title,
}: {
  className?: string
  description: string
  title: string
}) {
  return (
    <div
      className={cn(
        "grid min-h-36 place-items-center rounded-md border border-dashed bg-muted/20 px-4 py-8 text-center",
        className,
      )}
    >
      <div className="grid max-w-md justify-items-center gap-2">
        <div className="grid size-10 place-items-center rounded-md border bg-background text-muted-foreground">
          <PackageIcon className="size-5" />
        </div>
        <div className="oo-text-label text-foreground">{title}</div>
        <p className="oo-text-caption text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function OrganizationSkillIconFrame({ icon }: { icon?: string }) {
  const normalizedIcon = normalizeSkillIconSource(icon)
  const frameClassName = "grid size-9 shrink-0 place-items-center rounded-md border bg-background"

  if (isImageIcon(normalizedIcon)) {
    return (
      <span className={cn(frameClassName, "overflow-hidden")}>
        <img alt="" src={normalizedIcon} className="size-full object-contain p-1.5" />
      </span>
    )
  }

  if (isEmojiIcon(normalizedIcon)) {
    return <span className={cn(frameClassName, "text-xl")}>{normalizedIcon}</span>
  }

  return (
    <span className={frameClassName}>
      <SkillIcon icon={normalizedIcon} className="size-5" />
    </span>
  )
}

function OrganizationSkillPackageListSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-9 rounded-md" />
          <div className="grid min-w-0 gap-2">
            <Skeleton className="h-4 w-40 rounded-md" />
            <Skeleton className="h-3 w-60 max-w-full rounded-md" />
          </div>
          <Skeleton className="h-[var(--oo-control-height-compact)] w-24 rounded-md" />
        </div>
      ))}
    </div>
  )
}

function OrganizationSkillMarketRow({
  busyAction,
  canManage,
  groupById,
  linked,
  onAdd,
  onAddAndInstall,
  onManageLinked,
  pkg,
}: {
  busyAction: BusyAction | null
  canManage: boolean
  groupById: ReadonlyMap<string, ManagedSkillGroup>
  linked: boolean
  onAdd: (skillName?: string) => Promise<void>
  onAddAndInstall: (skillName?: string) => Promise<void>
  onManageLinked: () => void
  pkg: PublicSkillPackage
}) {
  const { t } = useAppI18n()
  const primarySkill = getPublicPackagePrimarySkill(pkg)
  const primaryInstallSkill = getPublicPackagePrimaryInstallSkill(groupById, pkg) ?? primarySkill
  const installState = getPublicPackageInstallState(groupById, pkg)
  const canInstallRuntime = canInstallPublicSkill(installState)
  const targetSkillName = canInstallRuntime ? primaryInstallSkill?.name : primarySkill?.name
  const busy = targetSkillName ? busyAction === `addSkill:${pkg.name}:${targetSkillName}` : false
  const disabled = Boolean(busyAction && !busy)
  const canLink = canManage && Boolean(primarySkill) && !linked
  const skillDescription = primarySkill?.description ?? pkg.description
  const skillLine = primarySkill
    ? `${pkg.name} · ${primarySkill.name} · ${pkg.version}`
    : `${pkg.name} · ${pkg.version}`
  const primaryLabel = busy
    ? t("skills.organizationAdding")
    : canInstallRuntime
      ? t("organizations.skillManageAddAndInstall")
      : t("organizations.skillManageAddOnly")

  return (
    <div
      className={cn(
        "grid min-w-0 gap-3 border-b px-3 py-2.5 last:border-b-0 md:items-center",
        "md:grid-cols-[auto_minmax(0,1fr)_auto_auto]",
      )}
    >
      <OrganizationSkillIconFrame icon={pkg.icon} />
      <div className="grid min-w-0 gap-0.5">
        <div className="oo-text-label min-w-0 truncate text-foreground">{pkg.displayName}</div>
        {skillDescription ? (
          <div className="oo-text-caption line-clamp-1 text-foreground/75">{skillDescription}</div>
        ) : null}
        <div className="oo-text-caption-compact min-w-0 truncate text-muted-foreground" title={skillLine}>
          {skillLine}
        </div>
      </div>
      <Badge className="shrink-0 justify-self-start md:justify-self-end" variant={linked ? "secondary" : "outline"}>
        {linked ? t("skills.organizationAdded") : getPublicSkillInstallStateLabel(installState, t)}
      </Badge>
      <div className="flex min-w-0 flex-wrap justify-start gap-2 md:justify-end">
        {linked ? (
          <Button type="button" variant="outline" size="sm" onClick={onManageLinked}>
            {t("skills.discoverOpenManage")}
          </Button>
        ) : !canManage ? (
          <Badge variant="outline">{t("organizations.readOnly")}</Badge>
        ) : canInstallRuntime && canLink ? (
          <div className="inline-flex items-center gap-0">
            <Button
              type="button"
              size="sm"
              className="rounded-r-none"
              disabled={disabled || busy || !targetSkillName}
              onClick={() => void onAddAndInstall(targetSkillName)}
            >
              {busy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <PackageIcon className="size-3.5" />}
              {primaryLabel}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="-ml-px w-[var(--oo-control-height-compact)] rounded-l-none border-l border-primary-foreground/25 px-0"
                  disabled={disabled || busy}
                  aria-label={t("organizations.skillManageMoreActions")}
                >
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void onAdd(primarySkill?.name)}>
                  {t("organizations.skillManageLinkOnly")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={disabled || busy || !canLink}
            onClick={() => void onAdd(primarySkill?.name)}
          >
            {busy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
            {primaryLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

function OrganizationSkillManageRow({
  busy,
  canManage,
  groupById,
  installBusy,
  onInstallRuntime,
  onRemove,
  onToggleEnabled,
  skill,
}: {
  busy: boolean
  canManage: boolean
  groupById: ReadonlyMap<string, ManagedSkillGroup>
  installBusy: boolean
  onInstallRuntime: () => void
  onRemove: () => void
  onToggleEnabled: () => void
  skill: UseOrganizationSkills["skills"][number]
}) {
  const { t } = useAppI18n()
  const runtimeStatus = getOrganizationSkillRuntimeStatus(groupById, skill)
  const runtimeTone = organizationRuntimeStatusTone(runtimeStatus.state)
  const runtimeInstallable = runtimeStatus.state === "missing" || runtimeStatus.state === "external-only"

  return (
    <div className="grid min-w-0 gap-3 border-b px-3 py-2.5 last:border-b-0 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
      <OrganizationSkillIconFrame icon={skill.icon} />
      <div className="grid min-w-0 gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="oo-text-label min-w-0 truncate text-foreground">{skill.displayName}</div>
          <Badge variant={skill.enabled ? "secondary" : "outline"} className="shrink-0">
            {skill.enabled ? t("skills.organizationEnabled") : t("skills.organizationDisabled")}
          </Badge>
          <Badge className={cn("shrink-0", getSkillRowStatusBadgeClassName(runtimeTone))} variant="outline">
            {organizationRuntimeStatusLabel(runtimeStatus.state, t)}
          </Badge>
        </div>
        {skill.description ? (
          <div className="oo-text-caption line-clamp-1 text-foreground/75">{skill.description}</div>
        ) : null}
        <div
          className="oo-text-caption-compact min-w-0 truncate text-muted-foreground"
          title={`${skill.packageName} · ${skill.skillName} · ${skill.version}`}
        >
          {skill.packageName} · {skill.skillName} · {skill.version}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap justify-start gap-2 md:justify-end">
        {runtimeInstallable ? (
          <Button type="button" variant="outline" size="sm" disabled={installBusy} onClick={onInstallRuntime}>
            {installBusy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <PackageIcon className="size-3.5" />}
            {installBusy ? t("skills.registryInstalling") : t("organizations.skillManageInstallRuntime")}
          </Button>
        ) : null}
        {canManage ? (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onToggleEnabled}>
            {skill.enabled ? t("skills.organizationDisable") : t("skills.organizationEnable")}
          </Button>
        ) : null}
        {canManage ? (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRemove}>
            {busy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <Trash2Icon className="size-3.5" />}
            {t("skills.organizationRemove")}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function OrganizationSkillRecommendationRow({
  busy,
  canManage,
  onAdd,
  onAddAndInstall,
  recommendation,
}: {
  busy: boolean
  canManage: boolean
  onAdd: () => Promise<void>
  onAddAndInstall: () => Promise<void>
  recommendation: ProviderSkillRecommendation
}) {
  const { t } = useAppI18n()
  const canInstallRuntime =
    recommendation.installState === "installable" || recommendation.installState === "partially-installed"
  const skillDescription =
    recommendation.package.skills.find((skill) => skill.name === recommendation.skillId)?.description ??
    recommendation.package.description

  return (
    <div className="grid min-w-0 gap-3 border-b px-3 py-2.5 last:border-b-0 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
      <OrganizationSkillIconFrame icon={recommendation.package.icon} />
      <div className="grid min-w-0 gap-0.5">
        <div className="oo-text-label min-w-0 truncate text-foreground">{recommendation.package.displayName}</div>
        {skillDescription ? (
          <div className="oo-text-caption line-clamp-1 text-foreground/75">{skillDescription}</div>
        ) : null}
        <div
          className="oo-text-caption-compact min-w-0 truncate text-muted-foreground"
          title={recommendation.packageName}
        >
          {recommendation.providerDisplayName} · {recommendation.packageName} · {recommendation.skillId}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap justify-start gap-2 md:justify-end">
        {!canManage ? (
          <Badge variant="outline">{t("organizations.readOnly")}</Badge>
        ) : canInstallRuntime ? (
          <div className="inline-flex items-center gap-0">
            <Button
              type="button"
              size="sm"
              className="rounded-r-none"
              disabled={busy}
              onClick={() => void onAddAndInstall()}
            >
              {busy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : <PackageIcon className="size-3.5" />}
              {t("organizations.skillManageAddAndInstall")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="-ml-px w-[var(--oo-control-height-compact)] rounded-l-none border-l border-primary-foreground/25 px-0"
                  disabled={busy}
                  aria-label={t("organizations.skillManageMoreActions")}
                >
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void onAdd()}>
                  {t("organizations.skillManageLinkOnly")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <Button type="button" size="sm" disabled={busy} onClick={() => void onAdd()}>
            {busy ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
            {t("organizations.skillManageAddOnly")}
          </Button>
        )}
      </div>
    </div>
  )
}

function OrganizationManagementSkeleton() {
  return (
    <>
      <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
        <div className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="size-16 shrink-0 rounded-md" />
            <div className="grid min-h-16 min-w-0 content-center gap-1.5">
              <div className="flex min-w-0 items-baseline gap-3">
                <Skeleton className="h-5 w-28 rounded-md" />
                <Skeleton className="h-4 w-64 max-w-[48%] rounded-md" />
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <Skeleton className="h-4 w-20 rounded-md" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            </div>
          </div>
          <div className="grid min-w-0 gap-2 sm:h-16 sm:min-w-fit sm:shrink-0 sm:content-between sm:justify-items-end sm:gap-0">
            <Skeleton className="h-[var(--oo-control-height-compact)] w-full rounded-md sm:w-32" />
            <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-end">
              <Skeleton className="h-5 w-24 rounded-md" />
              <Skeleton className="h-[var(--oo-control-height-compact)] w-16 rounded-md" />
            </div>
          </div>
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
        <div className="flex min-w-0 items-center gap-3 p-3">
          <Skeleton className="size-10 shrink-0 rounded-md" />
          <div className="grid min-w-0 flex-1 gap-2">
            <Skeleton className="h-5 w-28 rounded-md" />
            <Skeleton className="h-4 w-96 max-w-full rounded-md" />
          </div>
          <Skeleton className="h-[var(--oo-control-height-compact)] w-28 rounded-md" />
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--oo-divider)] px-3 py-2">
          <div className="grid min-w-0 gap-2">
            <Skeleton className="h-5 w-24 rounded-md" />
            <Skeleton className="h-4 w-72 max-w-full rounded-md" />
            <Skeleton className="h-4 w-48 max-w-full rounded-md" />
          </div>
          <Skeleton className="h-[var(--oo-control-height)] w-28 rounded-md" />
        </div>
        <div className="grid gap-3 p-3">
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-9 w-[88%] rounded-md" />
          <Skeleton className="h-9 w-[72%] rounded-md" />
        </div>
      </section>
    </>
  )
}

function EmptyOrganizationsState({ onCreate }: { onCreate: () => void }) {
  const { t } = useAppI18n()
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="grid max-w-sm justify-items-center gap-3 text-center">
        <div className="grid size-10 place-items-center rounded-md bg-[var(--oo-inspector-surface)] text-muted-foreground">
          <Building2Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="oo-text-title text-foreground">{t("organizations.emptyOrganizations")}</div>
          <div className="oo-text-caption mt-1">{t("organizations.emptyOrganizationsDescription")}</div>
        </div>
        <Button type="button" onClick={onCreate}>
          <PlusIcon className="size-4" />
          {t("organizations.createOrganization")}
        </Button>
      </div>
    </div>
  )
}

function OrganizationDetailPanel({
  appAccessLoading,
  busyAction,
  canManage,
  grantsByUserId,
  members,
  membersError,
  membersLoading,
  onAddMember,
  onEditProviderAccess,
  onGrantProviderAccess,
  onRemoveMember,
  onRevokeProviderAccess,
  organization,
  providerAccessError,
}: {
  appAccessLoading: boolean
  busyAction: BusyAction | null
  canManage: boolean
  grantsByUserId: Map<string, ProviderGrantView>
  members: MemberView[]
  membersError: string | null
  membersLoading: boolean
  onAddMember: () => void
  onEditProviderAccess: (grant: ProviderGrantView) => void
  onGrantProviderAccess: (userId: string) => void
  onRemoveMember: (member: OrganizationMember) => void
  onRevokeProviderAccess: (grant: ProviderGrantView) => void
  organization: Organization | null
  providerAccessError: string | null
}) {
  const { t } = useAppI18n()

  if (!organization) {
    return (
      <Panel title={t("organizations.membersAndPermissions")}>
        <EmptyBlock>{t("organizations.teamNoSelectionDescription")}</EmptyBlock>
      </Panel>
    )
  }

  const memberCountLabel = membersLoading ? "..." : String(members.length)
  const permissionModeLabel = canManage ? t("organizations.canManage") : t("organizations.readOnly")

  return (
    <div className="grid min-w-0 gap-3">
      <Panel
        title={t("organizations.membersAndPermissions")}
        description={
          <div className="grid min-w-0 gap-1">
            <span className="min-w-0 truncate">{t("organizations.membersAndPermissionsDescription")}</span>
            <span className="oo-text-caption-compact flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
              <span className="flex min-w-0 items-center gap-1.5">
                <UsersIcon className="size-3.5 shrink-0" />
                <span className="truncate">
                  {t("organizations.memberCount")}: {memberCountLabel}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <ShieldCheckIcon className="size-3.5 shrink-0" />
                <span className="truncate">
                  {t("organizations.permissionMode")}: {permissionModeLabel}
                </span>
              </span>
            </span>
          </div>
        }
        action={
          canManage ? (
            <Button type="button" size="sm" disabled={busyAction === "add"} onClick={onAddMember}>
              <PlusIcon className="size-3.5" />
              {t("organizations.addMember")}
            </Button>
          ) : null
        }
      >
        <>
          {providerAccessError && !membersError ? <ProviderAccessWarning error={providerAccessError} /> : null}
          {membersLoading ? (
            <MemberRowsSkeleton canManage={canManage} />
          ) : membersError ? (
            <EmptyBlock>
              {membersError.includes("HTTP 403") ? t("organizations.membersForbidden") : membersError}
            </EmptyBlock>
          ) : members.length === 0 ? (
            <EmptyBlock>{t("organizations.emptyMembersDescription")}</EmptyBlock>
          ) : (
            <MembersTable
              appAccessLoading={appAccessLoading}
              busyAction={busyAction}
              canManage={canManage}
              grantsByUserId={grantsByUserId}
              members={members}
              providerAccessError={providerAccessError}
              onEditProviderAccess={onEditProviderAccess}
              onGrantProviderAccess={onGrantProviderAccess}
              onRemoveMember={onRemoveMember}
              onRevokeProviderAccess={onRevokeProviderAccess}
            />
          )}
        </>
      </Panel>
    </div>
  )
}

function ProviderAccessWarning({ error }: { error: string }) {
  const { t } = useAppI18n()
  return (
    <div className="mx-3 mt-3 rounded-md border border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-3 py-2">
      <div className="oo-text-label text-foreground">{t("organizations.providerAccessLoadFailed")}</div>
      <div className="oo-text-caption mt-0.5 break-words" title={error}>
        {t("organizations.providerAccessLoadFailedDescription")}
      </div>
    </div>
  )
}

function MembersTable({
  appAccessLoading,
  busyAction,
  canManage,
  grantsByUserId,
  members,
  onEditProviderAccess,
  onGrantProviderAccess,
  onRemoveMember,
  onRevokeProviderAccess,
  providerAccessError,
}: {
  appAccessLoading: boolean
  busyAction: BusyAction | null
  canManage: boolean
  grantsByUserId: Map<string, ProviderGrantView>
  members: MemberView[]
  onEditProviderAccess: (grant: ProviderGrantView) => void
  onGrantProviderAccess: (userId: string) => void
  onRemoveMember: (member: OrganizationMember) => void
  onRevokeProviderAccess: (grant: ProviderGrantView) => void
  providerAccessError: string | null
}) {
  const { t } = useAppI18n()
  const gridClassName = canManage
    ? "grid-cols-[minmax(12rem,1fr)_7rem_minmax(12rem,1fr)_auto]"
    : "grid-cols-[minmax(12rem,1fr)_7rem]"

  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="min-w-[44rem]">
        <div
          className={cn(
            "oo-text-caption-compact grid gap-3 border-b bg-muted/30 px-3 py-2 font-medium text-muted-foreground",
            gridClassName,
          )}
        >
          <div>{t("organizations.member")}</div>
          <div>{t("organizations.role")}</div>
          {canManage ? <div>{t("organizations.usableConnections")}</div> : null}
          {canManage ? <div className="text-right">{t("organizations.actions")}</div> : null}
        </div>
        <div className="divide-y">
          {members.map((member) => {
            const grant = grantsByUserId.get(member.user_id) ?? null
            const removeBusy = busyAction === `remove:${member.user_id}`
            return (
              <div key={member.user_id} className={cn("grid items-center gap-3 px-3 py-3", gridClassName)}>
                <div className="flex min-w-0 items-center gap-3">
                  <UserAvatar avatar={member.avatar} fallback={member.fallback} label={member.displayName} />
                  <div className="min-w-0">
                    <div className="oo-text-label truncate">{member.displayName}</div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="oo-text-caption-compact mt-0.5 truncate font-mono text-muted-foreground">
                          {member.secondaryLabel}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="font-mono break-all">{member.user_id}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                <div>
                  <Badge variant="secondary">
                    {member.role === "creator" ? t("organizations.roleCreator") : t("organizations.roleMember")}
                  </Badge>
                </div>
                {canManage ? (
                  <div>
                    {member.role === "creator" ? (
                      <Badge variant="secondary">{t("organizations.creatorDefaultAccess")}</Badge>
                    ) : (
                      <ProviderAccessSummary
                        allProvidersLabel={t("organizations.allProviders")}
                        grant={grant}
                        loading={appAccessLoading}
                        notAuthorizedLabel={
                          providerAccessError
                            ? t("organizations.providerAccessUnavailable")
                            : t("organizations.notAuthorized")
                        }
                      />
                    )}
                  </div>
                ) : null}
                {canManage ? (
                  <div className="flex justify-end gap-2">
                    {member.role === "creator" ? (
                      <span className="oo-text-body text-muted-foreground">{t("organizations.creatorProtected")}</span>
                    ) : (
                      <>
                        <ProviderAccessActions
                          busyAction={busyAction}
                          disabled={appAccessLoading || Boolean(providerAccessError)}
                          grant={grant}
                          memberId={member.user_id}
                          onEdit={onEditProviderAccess}
                          onGrant={onGrantProviderAccess}
                          onRevoke={onRevokeProviderAccess}
                        />
                        <ConfirmDialog>
                          <ConfirmDialogTrigger asChild>
                            <Button type="button" variant="outline" size="sm" disabled={removeBusy}>
                              <Trash2Icon className="size-4" />
                              {t("organizations.removeMember")}
                            </Button>
                          </ConfirmDialogTrigger>
                          <ConfirmDialogContent>
                            <ConfirmDialogHeader>
                              <ConfirmDialogTitle>{t("organizations.removeMemberConfirmTitle")}</ConfirmDialogTitle>
                              <ConfirmDialogDescription>
                                {t("organizations.removeMemberConfirmDescription", { name: member.displayName })}
                              </ConfirmDialogDescription>
                            </ConfirmDialogHeader>
                            <ConfirmDialogFooter>
                              <ConfirmDialogCancel>{t("common.cancel")}</ConfirmDialogCancel>
                              <ConfirmDialogAction onClick={() => onRemoveMember(member)}>
                                {t("organizations.removeMember")}
                              </ConfirmDialogAction>
                            </ConfirmDialogFooter>
                          </ConfirmDialogContent>
                        </ConfirmDialog>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ProviderAccessSummary({
  allProvidersLabel,
  grant,
  loading,
  notAuthorizedLabel,
}: {
  allProvidersLabel: string
  grant: ProviderGrantView | null
  loading: boolean
  notAuthorizedLabel: string
}) {
  if (loading) {
    return <Skeleton className="h-6 w-28 rounded-md" />
  }
  if (!grant) {
    return <span className="oo-text-body text-muted-foreground">{notAuthorizedLabel}</span>
  }
  if (grant.allProviders) {
    return <Badge variant="secondary">{allProvidersLabel}</Badge>
  }

  const visibleProviders = grant.providers.slice(0, 3)
  const hiddenProviderCount = grant.providers.length - visibleProviders.length
  return (
    <div
      className="flex min-w-0 flex-nowrap gap-2"
      title={grant.providers.map((provider) => provider.label).join(", ")}
    >
      {visibleProviders.map((provider) => (
        <Badge key={provider.service} variant="secondary" title={provider.service}>
          {provider.label}
        </Badge>
      ))}
      {hiddenProviderCount > 0 ? <Badge variant="secondary">+{hiddenProviderCount}</Badge> : null}
    </div>
  )
}

function ProviderAccessActions({
  busyAction,
  disabled,
  grant,
  memberId,
  onEdit,
  onGrant,
  onRevoke,
}: {
  busyAction: BusyAction | null
  disabled: boolean
  grant: ProviderGrantView | null
  memberId: string
  onEdit: (grant: ProviderGrantView) => void
  onGrant: (userId: string) => void
  onRevoke: (grant: ProviderGrantView) => void
}) {
  const { t } = useAppI18n()
  if (!grant) {
    return (
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onGrant(memberId)}>
        {t("organizations.grantProviderAccessAction")}
      </Button>
    )
  }

  const revokeBusy = busyAction === `revokeProviderAccess:${grant.userId}`
  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={disabled || revokeBusy} onClick={() => onEdit(grant)}>
        <PencilIcon className="size-4" />
        {t("organizations.editProviderAccessAction")}
      </Button>
      <ConfirmDialog>
        <ConfirmDialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={disabled || revokeBusy}>
            <Trash2Icon className="size-4" />
            {t("organizations.revokeProviderAccess")}
          </Button>
        </ConfirmDialogTrigger>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>{t("organizations.revokeProviderAccessConfirmTitle")}</ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t("organizations.revokeProviderAccessConfirmDescription")}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>{t("common.cancel")}</ConfirmDialogCancel>
            <ConfirmDialogAction onClick={() => onRevoke(grant)}>
              {t("organizations.revokeProviderAccess")}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}

function CreateOrganizationDialog({
  avatar,
  busy,
  name,
  nameError,
  onAvatarChange,
  onClose,
  onNameChange,
  onSubmit,
  open,
}: {
  avatar: string
  busy: boolean
  name: string
  nameError: string | null
  onAvatarChange: (value: string) => void
  onClose: () => void
  onNameChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  open: boolean
}) {
  const { t } = useAppI18n()
  const disabled = organizationNameValidation(name.trim()) !== "valid" || Boolean(nameError) || busy

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("organizations.createOrganization")}
      description={t("organizations.createOrganizationDescription")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="create-organization-form" disabled={disabled}>
            {busy ? t("organizations.creatingOrganization") : t("organizations.create")}
          </Button>
        </>
      }
    >
      <form id="create-organization-form" className="grid gap-4" onSubmit={onSubmit}>
        <div className="grid gap-2">
          <Label htmlFor="organization-name">{t("organizations.organizationName")}</Label>
          <Input
            id="organization-name"
            value={name}
            maxLength={maxOrganizationNameLength}
            aria-invalid={Boolean(nameError)}
            autoFocus
            onChange={(event) => onNameChange(event.currentTarget.value)}
          />
          {nameError ? (
            <p className="oo-text-caption-compact text-destructive">{nameError}</p>
          ) : (
            <p className="oo-text-caption-compact text-muted-foreground">
              {t("organizations.organizationNameDescription")}
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="organization-avatar">{t("organizations.organizationAvatar")}</Label>
          <Input
            id="organization-avatar"
            value={avatar}
            maxLength={maxOrganizationAvatarLength}
            placeholder={t("organizations.organizationAvatarPlaceholder")}
            onChange={(event) => onAvatarChange(event.currentTarget.value)}
          />
        </div>
      </form>
    </Dialog>
  )
}

function AddMemberDialog({
  busy,
  input,
  onClose,
  onInputChange,
  onSearchSelect,
  onSubmit,
  open,
  search,
}: {
  busy: boolean
  input: string
  onClose: () => void
  onInputChange: (value: string) => void
  onSearchSelect: (user: MemberSearchState["items"][number]) => void
  onSubmit: (event: React.FormEvent) => void
  open: boolean
  search: MemberSearchState
}) {
  const { t } = useAppI18n()
  const canSubmit = input.trim().length > 0 && !busy

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("organizations.addMember")}
      description={t("organizations.addMemberDescription")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="add-organization-member-form" disabled={!canSubmit}>
            <PlusIcon className="size-4" />
            {busy ? t("organizations.addingMember") : t("organizations.addMember")}
          </Button>
        </>
      }
    >
      <form id="add-organization-member-form" className="grid gap-4" autoComplete="off" onSubmit={onSubmit}>
        <div className="grid gap-2">
          <Label htmlFor="organization-member-search">{t("organizations.memberIdentifier")}</Label>
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              id="organization-member-search"
              type="search"
              value={input}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              data-1p-ignore="true"
              data-form-type="other"
              data-lpignore="true"
              disabled={busy}
              placeholder={t("organizations.userSearchPlaceholder")}
              spellCheck={false}
              onChange={(event) => onInputChange(event.currentTarget.value)}
            />
          </InputGroup>
          <MemberSearchResults search={search} onSelect={onSearchSelect} />
        </div>
      </form>
    </Dialog>
  )
}

function MemberSearchResults({
  onSelect,
  search,
}: {
  onSelect: (user: MemberSearchState["items"][number]) => void
  search: MemberSearchState
}) {
  const { t } = useAppI18n()
  const showInitial = search.query.length < minimumMemberSearchLength
  const showEmpty =
    search.query.length >= minimumMemberSearchLength && !search.loading && !search.error && search.items.length === 0

  return (
    <div className="min-h-28 overflow-hidden rounded-md border">
      {search.items.length > 0 ? (
        <div className="max-h-64 overflow-y-auto p-1">
          {search.items.map((user) => (
            <button
              type="button"
              key={user.userId}
              className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground"
              onClick={() => onSelect(user)}
            >
              <UserAvatar avatar={user.avatar} fallback={user.fallback} label={user.displayName} />
              <span className="min-w-0">
                <span className="oo-text-label block truncate">{user.displayName}</span>
                <span className="oo-text-caption-compact block truncate font-mono text-muted-foreground">
                  {user.username}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {search.loading ? <DialogHint>{t("organizations.loading")}</DialogHint> : null}
      {showInitial ? <DialogHint>{t("organizations.searchUsersInitial")}</DialogHint> : null}
      {showEmpty ? <DialogHint>{t("organizations.noUsersFoundCanAddId")}</DialogHint> : null}
      {search.error ? <DialogHint danger>{search.error}</DialogHint> : null}
    </div>
  )
}

function ProviderAccessDialog({
  busy,
  form,
  memberOptions,
  onClose,
  onFormChange,
  onSubmit,
  providerOptions,
}: {
  busy: boolean
  form: ProviderAccessForm
  memberOptions: MemberView[]
  onClose: () => void
  onFormChange: React.Dispatch<React.SetStateAction<ProviderAccessForm>>
  onSubmit: (event: React.FormEvent) => void
  providerOptions: OrganizationProviderOption[]
}) {
  const { t } = useAppI18n()

  return (
    <Dialog
      open={form.open}
      onClose={onClose}
      title={form.mode === "create" ? t("organizations.grantProviderAccess") : t("organizations.editProviderAccess")}
      description={t("organizations.providerAccessDescription")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="provider-access-form" disabled={busy}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id="provider-access-form" className="grid gap-4" onSubmit={onSubmit}>
        <div className="grid gap-2">
          <Label htmlFor="provider-access-member">{t("organizations.member")}</Label>
          {form.mode === "create" && !form.userId ? (
            <Select
              value={form.userId}
              onValueChange={(value) => onFormChange((current) => ({ ...current, userId: value ?? "" }))}
            >
              <SelectTrigger id="provider-access-member" className="w-full">
                <SelectValue placeholder={t("organizations.memberRequired")} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {memberOptions.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.displayName}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <MemberDisplay userId={form.userId} members={memberOptions} />
          )}
        </div>
        <div className="grid gap-2">
          <Label>{t("organizations.connectionScope")}</Label>
          <ProviderSelect
            allProviders={form.allProviders}
            allProvidersLabel={t("organizations.allProviders")}
            emptyLabel={t("organizations.emptyProviders")}
            options={providerOptions}
            selectLabel={t("organizations.selectProviders")}
            selectedProviders={form.providers}
            onAllProvidersChange={(allProviders) =>
              onFormChange((current) => ({
                ...current,
                allProviders,
                providers: allProviders ? [] : current.providers,
              }))
            }
            onToggleProvider={(service) =>
              onFormChange((current) => ({
                ...current,
                allProviders: false,
                providers: current.providers.includes(service)
                  ? current.providers.filter((item) => item !== service)
                  : [...current.providers, service].sort(),
              }))
            }
          />
        </div>
      </form>
    </Dialog>
  )
}

function ProviderSelect({
  allProviders,
  allProvidersLabel,
  emptyLabel,
  onAllProvidersChange,
  onToggleProvider,
  options,
  selectLabel,
  selectedProviders,
}: {
  allProviders: boolean
  allProvidersLabel: string
  emptyLabel: string
  onAllProvidersChange: (value: boolean) => void
  onToggleProvider: (service: string) => void
  options: OrganizationProviderOption[]
  selectLabel: string
  selectedProviders: string[]
}) {
  const [open, setOpen] = React.useState(false)
  const labelsByService = React.useMemo(
    () => new Map(options.map((option) => [option.service, option.label])),
    [options],
  )
  const label = allProviders
    ? allProvidersLabel
    : selectedProviders.map((service) => labelsByService.get(service) ?? service).join(", ")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between">
          <span className="min-w-0 truncate text-left">{label || selectLabel}</span>
          {allProviders ? null : <span className="shrink-0 text-muted-foreground">{selectedProviders.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[min(26rem,calc(100vw-2rem))] p-1">
        <button
          type="button"
          className="oo-text-body flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            onAllProvidersChange(true)
            setOpen(false)
          }}
        >
          <span className="truncate">{allProvidersLabel}</span>
          {allProviders ? <CheckIcon className="size-4" /> : null}
        </button>
        <div className="my-1 h-px bg-border" />
        {options.length === 0 ? (
          <div className="oo-text-body px-2 py-6 text-center text-muted-foreground">{emptyLabel}</div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {options.map((provider) => {
              const selected = !allProviders && selectedProviders.includes(provider.service)
              return (
                <button
                  type="button"
                  key={provider.service}
                  className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    onToggleProvider(provider.service)
                    setOpen(false)
                  }}
                >
                  <span className="min-w-0">
                    <span className="oo-text-body block truncate">{provider.label}</span>
                    <span className="oo-text-caption-compact block truncate font-mono text-muted-foreground">
                      {provider.service}
                    </span>
                  </span>
                  {selected ? <CheckIcon className="size-4 shrink-0" /> : null}
                </button>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function Panel({
  action,
  children,
  description,
  title,
}: {
  action?: React.ReactNode
  children: React.ReactNode
  description?: React.ReactNode
  title: React.ReactNode
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--oo-divider)] px-3 py-2">
        <div className="min-w-0">
          <h2 className="oo-text-title truncate text-foreground">{title}</h2>
          {description ? <div className="oo-text-caption mt-0.5 min-w-0">{description}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

function OrganizationAvatar({ className, organization }: { className?: string; organization: Organization }) {
  return (
    <span
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--oo-frame-border)] bg-background text-xs font-medium text-foreground",
        className,
      )}
      style={organizationAvatarStyle(organization.id || organization.name)}
    >
      <span aria-hidden="true">{organizationInitials(organization.name)}</span>
      <CachedAvatarImage src={organization.avatar} alt="" className="absolute inset-0 size-full object-cover" />
    </span>
  )
}

function AccountWorkspaceAvatar({
  avatarUrl,
  className,
  name,
}: {
  avatarUrl?: string
  className?: string
  name?: string
}) {
  const label = name?.trim() || "User"

  return (
    <span
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--oo-frame-border)] bg-background text-xs font-medium text-foreground",
        className,
      )}
    >
      <span aria-hidden="true">{userFallback(label)}</span>
      <CachedAvatarImage src={avatarUrl} alt="" className="absolute inset-0 size-full object-cover" />
    </span>
  )
}

function UserAvatar({ avatar, fallback }: { avatar: string; fallback: string }) {
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-foreground">
      <span aria-hidden="true">{fallback}</span>
      <CachedAvatarImage src={avatar} alt="" className="absolute inset-0 size-full object-cover" />
    </span>
  )
}

function MemberDisplay({ members, userId }: { members: MemberView[]; userId: string }) {
  const member = members.find((item) => item.user_id === userId)
  const label = member?.displayName ?? userId
  const secondary = member?.secondaryLabel ?? userId
  return (
    <div className="flex min-h-9 min-w-0 items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
      <UserAvatar avatar={member?.avatar ?? ""} fallback={member?.fallback ?? userFallback(label)} />
      <span className="min-w-0">
        <span className="oo-text-label block truncate">{label}</span>
        <span className="oo-text-caption-compact block truncate font-mono text-muted-foreground">{secondary}</span>
      </span>
    </div>
  )
}

function MemberRowsSkeleton({ canManage }: { canManage: boolean }) {
  return (
    <div className="divide-y">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className={cn(
            "grid items-center gap-3 px-3 py-3",
            canManage ? "md:grid-cols-[1fr_7rem_1fr_18rem]" : "md:grid-cols-[1fr_7rem]",
          )}
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
          </div>
          <Skeleton className="h-6 w-20 rounded-md" />
          {canManage ? (
            <>
              <Skeleton className="h-6 w-32 rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
            </>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="oo-text-body flex min-h-32 items-center justify-center px-4 py-8 text-center text-muted-foreground">
      {children}
    </div>
  )
}

function ErrorBlock({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useAppI18n()
  return (
    <div className="flex min-h-32 flex-col items-start justify-center gap-3 px-4 py-5">
      <div className="oo-text-body text-muted-foreground">{error || t("organizations.loadFailed")}</div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <RefreshCwIcon className="size-4" />
        {t("organizations.retry")}
      </Button>
    </div>
  )
}

function DialogHint({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div className={cn("oo-text-body px-2 py-6 text-center text-muted-foreground", danger && "text-destructive")}>
      {children}
    </div>
  )
}
