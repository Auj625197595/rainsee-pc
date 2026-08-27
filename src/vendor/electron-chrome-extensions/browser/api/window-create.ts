import { ExtensionEvent } from '../router'

const POSITION_KEYS: (keyof chrome.windows.CreateData)[] = [
  'left',
  'top',
  'width',
  'height',
]

const WINDOW_STATES = new Set(['normal', 'minimized', 'maximized', 'fullscreen'])

const normalizeUrl = (value: string, event: ExtensionEvent) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invalid URL')
  }

  let resolved: string
  try {
    resolved = new URL(value, event.extension.url).href
  } catch {
    throw new Error('Invalid URL')
  }

  if (resolved.startsWith('javascript:') || resolved.startsWith('chrome:')) {
    throw new Error('Invalid URL')
  }
  return resolved
}

export const normalizeWindowCreateData = (
  event: ExtensionEvent,
  value: chrome.windows.CreateData | undefined,
): chrome.windows.CreateData => {
  const details = value && typeof value === 'object' ? { ...value } : {}
  const type = details.type || 'normal'
  if (type !== 'normal' && type !== 'popup' && type !== 'panel') {
    throw new Error(`Invalid window type: ${String(type)}`)
  }
  details.type = type

  if (details.state !== undefined && !WINDOW_STATES.has(details.state)) {
    throw new Error(`Invalid window state: ${String(details.state)}`)
  }
  if (
    details.focused === false &&
    (details.state === 'minimized' || details.state === 'fullscreen')
  ) {
    throw new Error(`The '${details.state}' state cannot be combined with focused: false`)
  }

  for (const key of POSITION_KEYS) {
    const current = details[key]
    if (current === undefined) continue
    if (typeof current !== 'number' || !Number.isFinite(current)) {
      throw new Error(`Invalid value for ${key}`)
    }
    if ((key === 'width' || key === 'height') && current <= 0) {
      throw new Error(`Invalid value for ${key}`)
    }
  }

  const hasBounds = POSITION_KEYS.some((key) => details[key] !== undefined)
  if (details.state && details.state !== 'normal' && hasBounds) {
    throw new Error(
      "The 'minimized', 'maximized' and 'fullscreen' states cannot be combined with bounds",
    )
  }

  const urls = Array.isArray(details.url)
    ? details.url
    : typeof details.url === 'string'
      ? [details.url]
      : []
  if (details.tabId !== undefined && urls.length > 0) {
    throw new Error("'tabId' cannot be combined with 'url'")
  }
  if (
    details.tabId !== undefined &&
    (!Number.isInteger(details.tabId) || details.tabId < 0)
  ) {
    throw new Error('Invalid tabId')
  }

  if (urls.length > 0) {
    const normalized = urls.map((url) => normalizeUrl(url, event))
    details.url = Array.isArray(details.url) ? normalized : normalized[0]
  } else {
    delete details.url
  }

  return details
}
