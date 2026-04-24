/** Ephemeral debug logging: local ingest + stdout (Heroku captures stdout). */
export function debugSessionLog(payload: {
  hypothesisId: string
  location: string
  message: string
  data?: Record<string, unknown>
  runId?: string
}): void {
  const body = {
    sessionId: '84a19b',
    timestamp: Date.now(),
    ...payload
  }
  const headers = new Headers()
  headers.set('Content-Type', 'application/json')
  headers.set('X-Debug-Session-Id', '84a19b')
  // #region agent log
  fetch('http://127.0.0.1:7841/ingest/96583079-93df-4c4e-95ed-e3e352350fef', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  }).catch(() => {
    /* noop */
  })
  // #endregion
}
