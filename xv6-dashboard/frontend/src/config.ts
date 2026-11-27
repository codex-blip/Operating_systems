export type RuntimeSettings = {
  useMock: boolean
  apiBase: string
  simulateFailure: boolean
  simulateOffline: boolean
}

const STORAGE_KEY = 'xv6-dashboard-settings'
const envBase = import.meta.env.VITE_API_BASE_URL?.trim()
const envMock = import.meta.env.VITE_USE_MOCK

export const DEFAULT_SETTINGS: RuntimeSettings = {
  useMock: envMock === undefined ? false : !['false', '0', 'no'].includes(envMock.toLowerCase()),
  apiBase: (envBase || 'http://127.0.0.1:5000/api').replace(/\/+$/, ''),
  simulateFailure: false,
  simulateOffline: false,
}

export function loadSettings(): RuntimeSettings {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (!value) return DEFAULT_SETTINGS
    const saved = JSON.parse(value) as Partial<RuntimeSettings>
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      apiBase: (saved.apiBase || DEFAULT_SETTINGS.apiBase).replace(/\/+$/, ''),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: RuntimeSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (error) {
    console.warn('Could not persist dashboard settings.', error)
  }
}
