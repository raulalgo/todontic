/// <reference types="vite/client" />

import type { TodonticApi } from '../preload/index'

declare global {
  interface Window {
    todontic?: TodonticApi
  }
}
