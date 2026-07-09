import { Permission } from '../../common/application-event.js'

/**
 * Maps tournament actions to required permission levels.
 * This allows granular control without changing the global Permission enum.
 */
export const TournamentPermissions = {
  create: Permission.Admin,
  cancel: Permission.Admin,
  start: Permission.Admin,
  'open-checkin': Permission.Admin,
  confirm: Permission.Officer,
  extend: Permission.Officer,
  substitute: Permission.Officer,
  audit: Permission.Admin,
  test: Permission.Admin,
  join: Permission.Anyone,
  leave: Permission.Anyone,
  status: Permission.Anyone,
  bracket: Permission.Anyone,
  report: Permission.Anyone,
  checkin: Permission.Anyone,
  forfeit: Permission.Anyone,
  schedule: Permission.Anyone,
  proof: Permission.Anyone
} as const

export type TournamentAction = keyof typeof TournamentPermissions

export function getRequiredPermission(action: TournamentAction): Permission {
  return TournamentPermissions[action] ?? Permission.Admin
}
