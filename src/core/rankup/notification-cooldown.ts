export function isNotificationDue(notifiedAtSeconds: number | undefined, cooldownMs: number, nowMs: number): boolean {
  if (notifiedAtSeconds === undefined) return true
  return nowMs - notifiedAtSeconds * 1000 > cooldownMs
}
