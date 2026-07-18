export type OrganizationRole = "creator" | "member"

export interface Organization {
  id: string
  name: string
  avatar: string
  creator_user_id: string
  role?: OrganizationRole
  writable?: boolean
}

export interface OrganizationMember {
  disable?: boolean
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

export interface UpdateOrganizationRequest {
  avatar: string
  orgId: string
  orgName: string
}

export interface UploadOrganizationAvatarResponse {
  avatar: string
}

export interface OrganizationMemberRequest {
  orgId: string
  userId: string
}

export interface UpdateOrganizationMembersStatusRequest {
  orgId: string
  userIds: string[]
}
