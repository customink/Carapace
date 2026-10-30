import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { createHash } from 'crypto'
import { execFile, spawn } from 'child_process'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { app, net } from 'electron'

/**
 * In-place updater for the packaged app.
 *
 * Electron's autoUpdater (Squirrel.Mac) refuses ad-hoc signed builds — it requires the
 * update's signature to satisfy the running app's designated requirement, and ad-hoc
 * signatures differ per build. So this downloads the release .zip, verifies it, and
 * hands the bundle swap to a detached script that runs once this process has exited.
 */

export interface ReleaseAsset {
  name: string
  size: number
  digest?: string // "sha256:<hex>" — GitHub computes this for every release asset
  browser_download_url: string
}

const BUNDLE_ID = 'com.carapace.app'

function execFileAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf-8', timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message))
      else resolve(stdout)
    })
  })
}

/** `Carapace.app` that contains the running executable, or null when running from source. */
export function currentBundlePath(): string | null {
  if (!app.isPackaged) return null
  // <bundle>/Contents/MacOS/Carapace
  const bundle = path.resolve(app.getPath('exe'), '..', '..', '..')
  return bundle.endsWith('.app') ? bundle : null
}

/** Why an in-place update can't run here, or null if it can. */
export function updateBlocker(): string | null {
  const bundle = currentBundlePath()
  if (!bundle) return 'Updating in place only works in the packaged app.'
  // A quarantined app launched from a disk image or Downloads runs from a randomized
  // read-only path (App Translocation) — replacing it there does nothing.
  if (bundle.includes('/AppTranslocation/')) {
    return 'Carapace is running from a temporary location. Move it to Applications, open it from there, then update.'
  }
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK)
  } catch {
    return `No write access to ${path.dirname(bundle)}.`
  }
  return null
}

/** The macOS .zip for this machine's architecture (x64 builds carry no arch suffix). */
export function pickMacZip(assets: ReleaseAsset[]): ReleaseAsset | undefined {
  const suffix = process.arch === 'arm64' ? '-arm64-mac.zip' : '-mac.zip'
  return assets.find(a => a.name.endsWith(suffix) && (process.arch === 'arm64' || !a.name.includes('-arm64-')))
}

async function download(asset: ReleaseAsset, dest: string): Promise<void> {
  const response = await net.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Carapace' } })
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), fs.createWriteStream(dest))

  const size = fs.statSync(dest).size
  if (size !== asset.size) throw new Error(`Download incomplete (${size} of ${asset.size} bytes).`)

  if (asset.digest?.startsWith('sha256:')) {
    const hash = createHash('sha256')
    await pipeline(fs.createReadStream(dest), hash)
    if (hash.digest('hex') !== asset.digest.slice('sha256:'.length)) {
      throw new Error('Downloaded file does not match the release checksum.')
    }
  }
}

/** Sanity-check the extracted bundle before it's allowed anywhere near the real one. */
async function verifyBundle(bundle: string, expectedVersion: string): Promise<void> {
  const plist = path.join(bundle, 'Contents', 'Info.plist')
  const read = (key: string) => execFileAsync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]).then(s => s.trim())
  const id = await read('CFBundleIdentifier')
  if (id !== BUNDLE_ID) throw new Error(`Unexpected bundle identifier "${id}".`)
  const version = await read('CFBundleShortVersionString')
  if (version !== expectedVersion) throw new Error(`Archive contains v${version}, expected v${expectedVersion}.`)
  await execFileAsync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
}

/**
 * Download + verify the update and stage the swap script. Resolves once it's ready;
 * the caller then quits the app, and the script installs and relaunches.
 */
export async function prepareUpdate(asset: ReleaseAsset, version: string): Promise<void> {
  const target = currentBundlePath()
  if (!target) throw new Error('Not running from a packaged app.')

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carapace-update-'))
  const zip = path.join(workDir, asset.name)
  await download(asset, zip)

  const extractDir = path.join(workDir, 'extracted')
  await execFileAsync('/usr/bin/ditto', ['-x', '-k', zip, extractDir])
  const staged = path.join(extractDir, 'Carapace.app')
  if (!fs.existsSync(staged)) throw new Error('Archive does not contain Carapace.app.')
  await verifyBundle(staged, version)
  fs.rmSync(zip)

  // Runs after this process exits: swap bundles (keeping the old one until the new one
  // is in place, so a failed move can be rolled back), then relaunch.
  const script = path.join(workDir, 'install.sh')
  fs.writeFileSync(script, `#!/bin/bash
PID="$1"; TARGET="$2"; STAGED="$3"; WORK="$4"
exec >>"$WORK/install.log" 2>&1
for _ in $(seq 1 120); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
if kill -0 "$PID" 2>/dev/null; then echo "app still running after 60s; not replacing it"; exit 1; fi
BACKUP="$TARGET.old-$$"
if ! mv "$TARGET" "$BACKUP"; then echo "could not move old app aside"; open "$TARGET"; exit 1; fi
if ! mv "$STAGED" "$TARGET"; then echo "could not move new app in; restoring"; mv "$BACKUP" "$TARGET"; open "$TARGET"; exit 1; fi
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$TARGET"
rm -rf "$BACKUP"
open "$TARGET"
echo "installed"
`, { mode: 0o755 })

  pendingInstall = { script, args: [String(process.pid), target, staged, workDir] }
}

let pendingInstall: { script: string; args: string[] } | null = null

/** Launch the staged swap script, detached so it outlives this process. Call right before quitting. */
export function launchPendingInstall(): void {
  if (!pendingInstall) return
  spawn('/bin/bash', [pendingInstall.script, ...pendingInstall.args], { detached: true, stdio: 'ignore' }).unref()
  pendingInstall = null
}
