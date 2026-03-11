import type { CarapaceAPI } from '../preload/index'

declare global {
  interface Window {
    carapace: CarapaceAPI
  }
}
