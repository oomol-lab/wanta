import type {
  Organization,
  OrganizationAppAccess,
  OrganizationMember,
  OrganizationOverview,
  OrganizationProviderOption,
  OrganizationUserSearchResult,
  OrganizationUserSummary,
} from "../../../electron/organizations/common.ts"

import {
  Building2Icon,
  CheckIcon,
  ChevronsUpDownIcon,
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
import { parseProviderGrants, removeProviderGrant, setProviderGrant } from "./organization-provider-access.ts"
import { useOrganizationsService } from "@/components/AppContext"
import { useAuthStateResource } from "@/components/AppDataHooks"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAppI18n } from "@/i18n"
import { cn } from "@/lib/utils"

type OrganizationRole = "creator" | "member"
type BusyAction = "add" | "create" | "saveProviderAccess" | `remove:${string}` | `revokeProviderAccess:${string}`
type LoadStatus = "idle" | "loading" | "ready" | "error"
type ProviderAccessMode = "create" | "edit"

interface LoadState<T> {
  data: T
  error: string | null
  status: LoadStatus
}

interface MemberView extends OrganizationMember {
  avatar: string
  displayName: string
  fallback: string
  secondaryLabel: string
}

interface ProviderGrantView {
  allProviders: boolean
  member: MemberView | null
  providers: OrganizationProviderOption[]
  userId: string
}

interface ProviderAccessForm {
  allProviders: boolean
  mode: ProviderAccessMode
  open: boolean
  providers: string[]
  userId: string
}

interface MemberSearchState {
  error: string | null
  items: Array<OrganizationUserSearchResult & { displayName: string; fallback: string; userId: string }>
  loading: boolean
  query: string
}

interface OrganizationManagementSnapshot {
  appAccessState: LoadState<OrganizationAppAccess | null>
  detailsOrganizationId: string | null
  membersState: LoadState<OrganizationMember[]>
  overviewState: LoadState<OrganizationOverview | null>
  providerOptionsState: LoadState<OrganizationProviderOption[]>
  savedAt: number
  selectedOrganizationId: string | null
  summariesState: LoadState<Record<string, OrganizationUserSummary>>
}

const maxOrganizationNameLength = 100
const maxOrganizationAvatarLength = 4095
const organizationNamePattern = /^[A-Za-z0-9._-]+$/
const minimumMemberSearchLength = 2
const organizationPageSnapshotTtlMs = 30_000
const selectedOrganizationStorageKeyPrefix = "lumo:organization-management:selected-organization:"

const initialProviderAccessForm: ProviderAccessForm = {
  allProviders: false,
  mode: "create",
  open: false,
  providers: [],
  userId: "",
}

const organizationManagementSnapshotsByAccountId = new Map<string, OrganizationManagementSnapshot>()

function loadState<T>(data: T): LoadState<T> {
  return { data, error: null, status: "idle" }
}

function loadingState<T>(current: LoadState<T>): LoadState<T> {
  return { ...current, error: null, status: "loading" }
}

function errorState<T>(current: LoadState<T>, error: unknown): LoadState<T> {
  return { ...current, error: errorMessage(error), status: "error" }
}

function readyState<T>(data: T): LoadState<T> {
  return { data, error: null, status: "ready" }
}

function readOrganizationManagementSnapshot(accountId: string | undefined): OrganizationManagementSnapshot | undefined {
  if (!accountId) {
    return undefined
  }

  const snapshot = organizationManagementSnapshotsByAccountId.get(accountId)
  if (!snapshot) {
    return undefined
  }

  if (Date.now() - snapshot.savedAt > organizationPageSnapshotTtlMs) {
    organizationManagementSnapshotsByAccountId.delete(accountId)
    return undefined
  }

  return snapshot
}

function selectedOrganizationStorageKey(accountId: string): string {
  return `${selectedOrganizationStorageKeyPrefix}${accountId}`
}

function readSelectedOrganizationId(accountId: string): string | null {
  try {
    return window.localStorage.getItem(selectedOrganizationStorageKey(accountId))
  } catch {
    return null
  }
}

function writeSelectedOrganizationId(accountId: string, organizationId: string): void {
  try {
    window.localStorage.setItem(selectedOrganizationStorageKey(accountId), organizationId)
  } catch {
    // 本地记录只是体验优化，失败不影响组织管理功能。
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isConflictError(error: unknown): boolean {
  return errorMessage(error).includes("HTTP 409")
}

function uniqueOrganizations(organizations: Organization[]): Organization[] {
  const seen = new Set<string>()
  return organizations.filter((organization) => {
    if (seen.has(organization.id)) {
      return false
    }
    seen.add(organization.id)
    return true
  })
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

function organizationInitials(name: string): string {
  return name.trim().slice(0, 2).toLocaleUpperCase() || "OR"
}

function userFallback(value: string): string {
  return value.trim().slice(0, 2).toLocaleUpperCase() || "U"
}

function shortUserId(userId: string): string {
  return userId.length > 16 ? `${userId.slice(0, 8)}...${userId.slice(-6)}` : userId
}

function organizationNameValidation(name: string): "empty" | "invalid" | "too-long" | "valid" {
  if (!name) {
    return "empty"
  }
  if (name.length > maxOrganizationNameLength) {
    return "too-long"
  }
  if (!organizationNamePattern.test(name)) {
    return "invalid"
  }
  return "valid"
}

function allOrganizations(overview: OrganizationOverview | null): Organization[] {
  return overview ? uniqueOrganizations([...overview.created, ...overview.joined]) : []
}

function organizationRole(
  overview: OrganizationOverview | null,
  organization: Organization | null,
): OrganizationRole | null {
  if (!overview || !organization) {
    return null
  }
  if (
    organization.creator_user_id === overview.accountId ||
    overview.created.some((item) => item.id === organization.id)
  ) {
    return "creator"
  }
  return "member"
}

function buildMemberViews(
  members: OrganizationMember[],
  summaries: Record<string, OrganizationUserSummary>,
): MemberView[] {
  return members.map((member) => {
    const summary = summaries[member.user_id]
    const displayName = summary ? summary.nickname || summary.username || member.user_id : member.user_id
    return {
      ...member,
      avatar: summary?.url ?? "",
      displayName,
      fallback: userFallback(displayName),
      secondaryLabel: summary ? shortUserId(member.user_id) : member.user_id,
    }
  })
}

function buildGrantViews(
  appAccess: OrganizationAppAccess | null,
  members: MemberView[],
  providerOptions: OrganizationProviderOption[],
): { error: string | null; grants: ProviderGrantView[] } {
  if (!appAccess) {
    return { error: null, grants: [] }
  }

  const parsed = parseProviderGrants(appAccess)
  if (!parsed.ok) {
    return { error: parsed.error.message, grants: [] }
  }

  const labelByService = new Map(providerOptions.map((provider) => [provider.service, provider.label]))
  return {
    error: null,
    grants: parsed.grants.map((grant) => ({
      allProviders: grant.allProviders,
      member: members.find((member) => member.user_id === grant.userId) ?? null,
      providers: grant.providers.map((service) => ({ service, label: labelByService.get(service) ?? service })),
      userId: grant.userId,
    })),
  }
}

function providerOptionsWithSelected(
  options: OrganizationProviderOption[],
  selectedProviders: string[],
): OrganizationProviderOption[] {
  const seen = new Set(options.map((option) => option.service))
  const unknown = selectedProviders
    .filter((service) => !seen.has(service))
    .map((service) => ({ service, label: service }))
  return [...options, ...unknown].sort((left, right) => left.label.localeCompare(right.label))
}

export function OrganizationManagementRoute() {
  const { t } = useAppI18n()
  const organizationService = useOrganizationsService()
  const authResource = useAuthStateResource()
  const activeAccountId = authResource.data?.status === "authenticated" ? authResource.data.account?.id : undefined
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
  const memberSearchRequestId = React.useRef(0)

  const organizations = React.useMemo(() => allOrganizations(overviewState.data), [overviewState.data])
  const selectedOrganization = React.useMemo(() => {
    return selectedOrganizationId ? (organizations.find((item) => item.id === selectedOrganizationId) ?? null) : null
  }, [organizations, selectedOrganizationId])
  const selectedRole = React.useMemo(
    () => organizationRole(overviewState.data, selectedOrganization),
    [overviewState.data, selectedOrganization],
  )
  const canManage = selectedRole === "creator"
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

  const loadOrganizations = React.useCallback(
    async (options: { forceRefresh?: boolean } = {}) => {
      const requestId = overviewRequestId.current + 1
      overviewRequestId.current = requestId
      setOverviewState((current) => loadingState(current))
      try {
        const overview = await organizationService.invoke("getOrganizationOverview", {
          forceRefresh: options.forceRefresh,
        })
        if (overviewRequestId.current !== requestId) {
          return
        }
        setOverviewState(readyState(overview))
        setSelectedOrganizationId((current) => {
          const listedOrganizations = allOrganizations(overview)
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
    [organizationService],
  )

  const loadSelectedDetails = React.useCallback(
    async (organization: Organization, role: OrganizationRole | null, options: { forceRefresh?: boolean } = {}) => {
      const requestId = detailsRequestId.current + 1
      detailsRequestId.current = requestId
      detailsOrganizationIdRef.current = null
      setMembersState((current) => loadingState(current))
      setSummariesState((current) => loadingState(current))
      setProviderOptionsState(role === "creator" ? (current) => loadingState(current) : loadState([]))
      setAppAccessState(role === "creator" ? (current) => loadingState(current) : loadState(null))

      try {
        const members = await organizationService.invoke("listOrganizationMembers", {
          forceRefresh: options.forceRefresh,
          orgId: organization.id,
        })
        if (detailsRequestId.current !== requestId) {
          return
        }
        setMembersState(readyState(members))

        const userIds = uniqueStrings(members.map((member) => member.user_id))
        const summaries =
          userIds.length > 0
            ? await organizationService.invoke("listUserSummaries", {
                forceRefresh: options.forceRefresh,
                userIds,
              })
            : {}
        if (detailsRequestId.current !== requestId) {
          return
        }
        setSummariesState(readyState(summaries))

        if (role !== "creator") {
          setProviderOptionsState(loadState([]))
          setAppAccessState(loadState(null))
          detailsOrganizationIdRef.current = organization.id
          return
        }

        const [providerOptions, appAccess] = await Promise.all([
          organizationService.invoke("listOrganizationProviderOptions", {
            forceRefresh: options.forceRefresh,
            organizationName: organization.name,
          }),
          organizationService.invoke("getOrganizationAppAccess", {
            forceRefresh: options.forceRefresh,
            orgId: organization.id,
          }),
        ])
        if (detailsRequestId.current !== requestId) {
          return
        }
        setProviderOptionsState(readyState(providerOptions))
        setAppAccessState(readyState(appAccess))
        detailsOrganizationIdRef.current = organization.id
      } catch (error) {
        if (detailsRequestId.current !== requestId) {
          return
        }
        setMembersState((current) => (current.status === "loading" ? errorState(current, error) : current))
        setSummariesState((current) => (current.status === "loading" ? errorState(current, error) : current))
        if (role === "creator") {
          setProviderOptionsState((current) => (current.status === "loading" ? errorState(current, error) : current))
          setAppAccessState((current) => (current.status === "loading" ? errorState(current, error) : current))
        }
      }
    },
    [organizationService],
  )

  React.useEffect(() => {
    const snapshot = readOrganizationManagementSnapshot(activeAccountId)
    if (!activeAccountId || !snapshot || overviewState.data?.accountId === activeAccountId) {
      return
    }

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
  }, [activeAccountId, overviewState.data?.accountId])

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
    if (skipInitialOrganizationsLoadRef.current) {
      skipInitialOrganizationsLoadRef.current = false
      return
    }

    void loadOrganizations()
  }, [loadOrganizations])

  React.useEffect(() => {
    const handleWindowFocus = () => {
      void loadOrganizations()
    }
    window.addEventListener("focus", handleWindowFocus)
    return () => window.removeEventListener("focus", handleWindowFocus)
  }, [loadOrganizations])

  React.useEffect(() => {
    return organizationService.serverEvents.on("organizationChanged", () => {
      void loadOrganizations()
    })
  }, [loadOrganizations, organizationService.serverEvents])

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
    void loadSelectedDetails(selectedOrganization, selectedRole)
  }, [loadSelectedDetails, selectedOrganization?.id, selectedOrganization?.name, selectedRole])

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
      void organizationService
        .invoke("searchUsers", { keyword: query })
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
  }, [addMemberOpen, memberInput, membersState.data, organizationService])

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
        const organization = await organizationService.invoke("createOrganization", {
          orgName,
          ...(createAvatar.trim() ? { avatar: createAvatar.trim() } : {}),
        })
        toast.success(t("organizations.createOrganizationSuccess"))
        setCreateOpen(false)
        setCreateName("")
        setCreateAvatar("")
        setCreateDuplicated(false)
        setSelectedOrganizationId(organization.id)
        await loadOrganizations({ forceRefresh: true })
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
    [createAvatar, createName, loadOrganizations, organizationService, t],
  )

  const reloadMembersAndAccess = React.useCallback(async () => {
    if (selectedOrganization) {
      await loadSelectedDetails(selectedOrganization, selectedRole, { forceRefresh: true })
    }
  }, [loadSelectedDetails, selectedOrganization, selectedRole])

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
        await organizationService.invoke("addOrganizationMember", { orgId: selectedOrganization.id, userId })
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
    [
      canManage,
      memberInput,
      organizationService,
      reloadMembersAndAccess,
      selectedOrganization,
      selectedSearchUserId,
      t,
    ],
  )

  const handleRemoveMember = React.useCallback(
    async (member: OrganizationMember) => {
      if (!selectedOrganization || !canManage) {
        return
      }

      setBusyAction(`remove:${member.user_id}`)
      try {
        await organizationService.invoke("removeOrganizationMember", {
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
    [canManage, organizationService, reloadMembersAndAccess, selectedOrganization, t],
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
        const latest = await organizationService.invoke("getOrganizationAppAccess", {
          forceRefresh: true,
          orgId: selectedOrganization.id,
        })
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
        const updated = await organizationService.invoke("updateOrganizationAppAccess", {
          access: nextAccess,
          orgId: selectedOrganization.id,
        })
        setAppAccessState(readyState(updated))
        setProviderAccessForm(initialProviderAccessForm)
        toast.success(t("organizations.providerAccessSaveSuccess"))
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        setBusyAction(null)
      }
    },
    [canManage, organizationService, providerAccessError, providerAccessForm, selectedOrganization, t],
  )

  const handleRevokeProviderAccess = React.useCallback(
    async (grant: ProviderGrantView) => {
      if (!selectedOrganization || !canManage || providerAccessError) {
        return
      }

      setBusyAction(`revokeProviderAccess:${grant.userId}`)
      try {
        const latest = await organizationService.invoke("getOrganizationAppAccess", {
          forceRefresh: true,
          orgId: selectedOrganization.id,
        })
        const parsed = parseProviderGrants(latest)
        if (!parsed.ok) {
          toast.error(t("organizations.providerAccessLoadFailed"))
          return
        }
        const updated = await organizationService.invoke("updateOrganizationAppAccess", {
          access: removeProviderGrant(parsed.access, grant.userId),
          orgId: selectedOrganization.id,
        })
        setAppAccessState(readyState(updated))
        toast.success(t("organizations.providerAccessRevokeSuccess"))
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        setBusyAction(null)
      }
    },
    [canManage, organizationService, providerAccessError, selectedOrganization, t],
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
                  organizations={organizations}
                  overview={overviewState.data}
                  selectedOrganization={selectedOrganization}
                  selectedOrganizationId={selectedOrganizationId}
                  onCreate={() => setCreateOpen(true)}
                  onSelect={setSelectedOrganizationId}
                />
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
  onCreate,
  onSelect,
  organizations,
  overview,
  selectedOrganization,
  selectedOrganizationId,
}: {
  onCreate: () => void
  onSelect: (organizationId: string) => void
  organizations: Organization[]
  overview: OrganizationOverview | null
  selectedOrganization: Organization | null
  selectedOrganizationId: string | null
}) {
  const { t } = useAppI18n()
  const countLabel = t("organizations.organizationCount", { count: organizations.length })
  const selectedRole = selectedOrganization ? organizationRole(overview, selectedOrganization) : null

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="grid min-h-20 min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-4 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-rows-[var(--oo-control-height)_var(--oo-control-height)] sm:items-center">
        <div className="row-span-2 self-center">
          {selectedOrganization ? (
            <OrganizationAvatar organization={selectedOrganization} className="size-16 rounded-md text-lg" />
          ) : (
            <div className="grid size-16 place-items-center rounded-md bg-muted text-muted-foreground">
              <Building2Icon className="size-5" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 items-baseline gap-3 self-end sm:self-center">
          {selectedOrganization ? (
            <>
              <span className="min-w-0 truncate text-base font-semibold text-foreground">
                {selectedOrganization.name}
              </span>
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {selectedOrganization.id}
              </span>
            </>
          ) : (
            <span className="min-w-0 truncate text-sm text-muted-foreground">
              {t("organizations.selectOrganization")}
            </span>
          )}
        </div>

        <div className="flex min-w-0 items-center gap-2 self-start sm:self-center">
          <span className="oo-text-caption shrink-0">{t("organizations.selectedOrganization")}</span>
          {selectedRole ? (
            <Badge variant="secondary" className="shrink-0">
              {selectedRole === "creator" ? t("organizations.roleCreator") : t("organizations.roleMember")}
            </Badge>
          ) : null}
        </div>

        <Button
          type="button"
          variant="outline"
          className="col-span-2 w-full sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:w-auto sm:justify-self-end"
          onClick={onCreate}
        >
          <PlusIcon className="size-4" />
          {t("organizations.createOrganization")}
        </Button>
        <div className="col-span-2 flex min-w-0 items-center justify-between gap-2 sm:col-span-1 sm:col-start-3 sm:row-start-2 sm:justify-self-end">
          <span className="shrink-0 text-sm text-muted-foreground">{countLabel}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" className="px-2">
                {t("organizations.switchOrganization")}
                <ChevronsUpDownIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-[min(36rem,calc(100vw-2rem))]">
              <DropdownMenuLabel>{t("organizations.selectOrganization")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {organizations.map((organization) => {
                const role = organizationRole(overview, organization)
                const selected = organization.id === selectedOrganizationId
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
                        <span className="truncate text-sm leading-5 font-medium">{organization.name}</span>
                        {selected ? (
                          <span className="size-2 shrink-0 rounded-full bg-[var(--success)]" aria-hidden="true" />
                        ) : null}
                      </span>
                      <span className="block truncate font-mono text-xs leading-5 text-muted-foreground">
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
    </section>
  )
}

function OrganizationManagementSkeleton() {
  return (
    <>
      <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
        <div className="grid min-h-20 min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-4 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-rows-[var(--oo-control-height)_var(--oo-control-height)] sm:items-center">
          <Skeleton className="row-span-2 size-16 self-center rounded-md" />
          <div className="flex min-w-0 items-baseline gap-3 self-end sm:self-center">
            <Skeleton className="h-5 w-28 rounded-md" />
            <Skeleton className="h-4 w-64 max-w-[48%] rounded-md" />
          </div>
          <div className="flex min-w-0 items-center gap-2 self-start sm:self-center">
            <Skeleton className="h-4 w-20 rounded-md" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="col-span-2 h-[var(--oo-control-height)] w-full rounded-md sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:w-32 sm:justify-self-end" />
          <div className="col-span-2 flex min-w-0 items-center justify-between gap-2 sm:col-span-1 sm:col-start-3 sm:row-start-2 sm:justify-self-end">
            <Skeleton className="h-5 w-24 rounded-md" />
            <Skeleton className="h-[var(--oo-control-height)] w-16 rounded-md" />
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-20 rounded-md" />
        <Skeleton className="h-20 rounded-md" />
      </div>

      <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--oo-divider)] px-3 py-2">
          <div className="grid min-w-0 gap-2">
            <Skeleton className="h-5 w-24 rounded-md" />
            <Skeleton className="h-4 w-72 max-w-full rounded-md" />
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

  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <MiniStat
          icon={<UsersIcon className="size-4" />}
          label={t("organizations.memberCount")}
          value={String(members.length)}
        />
        <MiniStat
          icon={<ShieldCheckIcon className="size-4" />}
          label={t("organizations.permissionMode")}
          value={canManage ? t("organizations.canManage") : t("organizations.readOnly")}
        />
      </div>

      <Panel
        title={t("organizations.membersAndPermissions")}
        description={t("organizations.membersAndPermissionsDescription")}
        action={
          canManage ? (
            <Button type="button" size="sm" disabled={busyAction === "add"} onClick={onAddMember}>
              <PlusIcon className="size-4" />
              {t("organizations.addMember")}
            </Button>
          ) : null
        }
      >
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
      </Panel>
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
            "grid gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground",
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
                    <div className="truncate text-sm font-medium">{member.displayName}</div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
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
                        notAuthorizedLabel={providerAccessError ?? t("organizations.notAuthorized")}
                      />
                    )}
                  </div>
                ) : null}
                {canManage ? (
                  <div className="flex justify-end gap-2">
                    {member.role === "creator" ? (
                      <span className="text-sm text-muted-foreground">{t("organizations.creatorProtected")}</span>
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
    return <span className="text-sm text-muted-foreground">{notAuthorizedLabel}</span>
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
            <p className="text-xs text-destructive">{nameError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t("organizations.organizationNameDescription")}</p>
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
                <span className="block truncate text-sm font-medium">{user.displayName}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">{user.username}</span>
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
          className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
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
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</div>
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
                    <span className="block truncate text-sm">{provider.label}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{provider.service}</span>
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
          {description ? <p className="oo-text-caption mt-0.5 truncate">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 rounded-md bg-[var(--oo-inspector-surface)] px-3 py-2.5">
      <div className="oo-text-caption flex min-w-0 items-center gap-1.5">
        <span className="oo-icon-muted shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="oo-text-value truncate text-foreground">{value}</div>
    </div>
  )
}

function OrganizationAvatar({ className, organization }: { className?: string; organization: Organization }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--oo-frame-border)] bg-background text-xs font-medium text-foreground",
        className,
      )}
    >
      {organization.avatar ? (
        <img src={organization.avatar} alt={organization.name} className="size-full object-cover" />
      ) : (
        organizationInitials(organization.name)
      )}
    </span>
  )
}

function UserAvatar({ avatar, fallback, label }: { avatar: string; fallback: string; label: string }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-foreground">
      {avatar ? <img src={avatar} alt={label} className="size-full object-cover" /> : fallback}
    </span>
  )
}

function MemberDisplay({ members, userId }: { members: MemberView[]; userId: string }) {
  const member = members.find((item) => item.user_id === userId)
  const label = member?.displayName ?? userId
  const secondary = member?.secondaryLabel ?? userId
  return (
    <div className="flex min-h-9 min-w-0 items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
      <UserAvatar avatar={member?.avatar ?? ""} fallback={member?.fallback ?? userFallback(label)} label={label} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="block truncate font-mono text-xs text-muted-foreground">{secondary}</span>
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
    <div className="flex min-h-32 items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function ErrorBlock({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useAppI18n()
  return (
    <div className="flex min-h-32 flex-col items-start justify-center gap-3 px-4 py-5">
      <div className="text-sm text-muted-foreground">{error || t("organizations.loadFailed")}</div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <RefreshCwIcon className="size-4" />
        {t("organizations.retry")}
      </Button>
    </div>
  )
}

function DialogHint({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div className={cn("px-2 py-6 text-center text-sm text-muted-foreground", danger && "text-destructive")}>
      {children}
    </div>
  )
}
