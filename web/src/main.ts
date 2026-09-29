// App entry: resolve display mode, mount the App, register the service
// worker, and nudge iOS users to add to home screen.

import './theme/tokens.css'
import './ui/styles.css'
import { getPlatform } from './platform/index'
import { initDisplayMode } from './theme/mode'
import { App } from './ui/app'
import { registerServiceWorker } from './ui/pwa'
import { showInstallHintIfNeeded } from './ui/install-hint'
import { initStats } from './ui/stats'

const root = document.getElementById('app')
if (root) {
  const platform = getPlatform()
  void Promise.all([initDisplayMode(platform), initStats(platform)]).finally(() => {
    new App().mount(root)
    registerServiceWorker()
    showInstallHintIfNeeded()
  })
}
