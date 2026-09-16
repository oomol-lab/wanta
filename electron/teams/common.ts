export type TeamRole = "creator" | "admin" | "member"
export type TeamStatus = "normal" | "paused"
export type TeamMemberRole = TeamRole | "guest"
export type EditableTeamMemberRole = Exclude<TeamMemberRole, "creator" | "guest">
export type TeamMemberType = "user" | "service-account"

export interface Team {
  id: string
  name: string
  avatar: string
  creator_user_id: string
  status?: TeamStatus
  role?: TeamRole
  system_created?: boolean
  writable?: boolean
}

export interface TeamMember {
  disable?: boolean
  user_id: string
  role: TeamMemberRole
  user_type?: TeamMemberType
  name?: string
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

export interface ServiceAccount {
  id: string
  name: string
  creator_user_id: string
  status: string
  created_at: string
  updated_at: string
}
