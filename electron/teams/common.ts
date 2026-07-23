export type TeamRole = "creator" | "admin" | "member"
export type EditableTeamMemberRole = Exclude<TeamRole, "creator">

export interface Team {
  id: string
  name: string
  avatar: string
  creator_user_id: string
  role?: TeamRole
  system_created?: boolean
  writable?: boolean
}

export interface TeamMember {
  disable?: boolean
  user_id: string
  role: TeamRole
}

export type TeamAppAccess = Record<string, Record<string, unknown>>

export interface TeamUserSummary {
  nickname: string
  role?: string
  url?: string
  username: string
}

export interface TeamUserSearchResult {
  avatar: string
  nickname: string
  user_id: string
  username: string
}

export interface TeamProviderOption {
  label: string
  service: string
}

export interface TeamOverview {
  accountId: string
  created: Team[]
  joined: Team[]
  updatedAt: string
}

export interface CreateTeamRequest {
  avatar?: string
  teamName: string
}

export interface UpdateTeamRequest {
  avatar: string
  teamId: string
  teamName: string
}

export interface UploadTeamAvatarResponse {
  avatar: string
}

export interface TeamMemberRequest {
  teamId: string
  userId: string
}

export interface UpdateTeamMembersStatusRequest {
  teamId: string
  userIds: string[]
}

export interface UpdateTeamMemberRoleRequest {
  role: EditableTeamMemberRole
  teamId: string
  userId: string
}
