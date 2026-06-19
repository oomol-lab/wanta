import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export type OrganizationRole = "creator" | "member"

export interface Organization {
  id: string
  name: string
  avatar: string
  creator_user_id: string
}

export interface OrganizationMember {
  user_id: string
  role: OrganizationRole
}

export type OrganizationAppAccess = Record<string, Record<string, unknown>>

export interface OrganizationUserSummary {
  nickname: string
  role?: string
  url?: string
  username: string
}

export interface OrganizationUserSearchResult {
  avatar: string
  nickname: string
  user_id: string
  username: string
}

export interface OrganizationProviderOption {
  label: string
  service: string
}

export interface OrganizationOverview {
  accountId: string
  created: Organization[]
  joined: Organization[]
  updatedAt: string
}

export interface CreateOrganizationRequest {
  avatar?: string
  orgName: string
}

export interface OrganizationIdRequest {
  orgId: string
}

export interface OrganizationMemberRequest {
  orgId: string
  userId: string
}

export interface UpdateOrganizationAppAccessRequest {
  access: OrganizationAppAccess
  orgId: string
}

export interface OrganizationProviderOptionsRequest {
  organizationName: string
}

export interface OrganizationUsersRequest {
  userIds: string[]
}

export interface OrganizationUserSearchRequest {
  keyword: string
}

export interface OrganizationChangedEvent {
  updatedAt: string
}

export type OrganizationsService = typeof OrganizationsService
export const OrganizationsService = serviceName("organizations-service") as ServiceName<{
  ServerEvents: {
    organizationChanged: OrganizationChangedEvent
  }
  ClientInvokes: {
    addOrganizationMember(req: OrganizationMemberRequest): Promise<void>
    createOrganization(req: CreateOrganizationRequest): Promise<Organization>
    getOrganizationAppAccess(req: OrganizationIdRequest): Promise<OrganizationAppAccess>
    getOrganizationOverview(): Promise<OrganizationOverview>
    isReady(): Promise<boolean>
    listCreatedOrganizations(): Promise<Organization[]>
    listMyOrganizations(): Promise<Organization[]>
    listOrganizationMembers(req: OrganizationIdRequest): Promise<OrganizationMember[]>
    listOrganizationProviderOptions(req: OrganizationProviderOptionsRequest): Promise<OrganizationProviderOption[]>
    listUserSummaries(req: OrganizationUsersRequest): Promise<Record<string, OrganizationUserSummary>>
    removeOrganizationMember(req: OrganizationMemberRequest): Promise<void>
    searchUsers(req: OrganizationUserSearchRequest): Promise<OrganizationUserSearchResult[]>
    updateOrganizationAppAccess(req: UpdateOrganizationAppAccessRequest): Promise<OrganizationAppAccess>
  }
}>
