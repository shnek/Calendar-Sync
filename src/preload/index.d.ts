import type { RendererApi } from '../shared/ipc'

declare global {
  interface Window {
    api: RendererApi
    platform: string
    onNavigate: (listener: (page: string) => void) => void
  }
}

export {}
