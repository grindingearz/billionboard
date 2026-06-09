let _sessionId: string | null = null

function getSessionId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    if (!_sessionId) {
      _sessionId = sessionStorage.getItem('bb_sid')
      if (!_sessionId) {
        _sessionId = (Math.random().toString(36) + Math.random().toString(36)).replace(/\./g, '').slice(2, 18)
        sessionStorage.setItem('bb_sid', _sessionId)
      }
    }
    return _sessionId
  } catch {
    return null
  }
}

export function trackEvent(type: 'PAGE_VIEW' | 'BOARD_VIEW', path: string): void {
  if (typeof window === 'undefined') return
  try {
    fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        path,
        sessionId: getSessionId(),
        referrer: document.referrer || null,
      }),
      keepalive: true,
    }).catch(() => {})
  } catch {}
}
