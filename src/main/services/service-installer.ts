import { execFile } from 'child_process'
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const SERVICES_DIR = join(homedir(), 'Library', 'Services')

/** Bumped when any workflow's contents change, so installed copies get refreshed. */
const VERSION = '3'

/**
 * Extracts a GitHub PR link from the selected text and hands it to Carapace.
 *
 * `open` starts Carapace if it isn't running, which is the whole point — the engineer
 * doesn't have to have it open to pick up a review.
 *
 * The scheme is optional in the match: Slack renders links as `github.com/owner/repo/pull/1`,
 * so the selected text usually has no `https://` on it. Requiring one made the menu item
 * silently do nothing.
 *
 * When no link is found we still hand the selection to Carapace rather than firing a
 * notification — the app shows a real dialog, and a notification is far too easy to miss.
 */
function reviewScript(extraParams: string): string {
  return `input=$(cat)
url=$(printf '%s' "$input" | /usr/bin/grep -oiE '(https?://)?(www\\.)?github\\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/pull/[0-9]+' | /usr/bin/head -1)
if [ -n "$url" ]; then
  case "$url" in
    http*) ;;
    *) url="https://$url" ;;
  esac
  /usr/bin/open "carapace://review?pr=$url${extraParams}"
else
  msg=$(printf '%s' "$input" | /usr/bin/head -c 400 | /usr/bin/base64 | /usr/bin/tr -d '\\n')
  /usr/bin/open "carapace://review?msg=$msg${extraParams}"
fi`
}

interface ServiceDef {
  name: string
  script: string
}

const SERVICES: ServiceDef[] = [
  // Opens the dialog so the prompt can be edited before anything runs
  { name: 'Review in Carapace', script: reviewScript('') },
  // Skips the dialog and runs the quick preset immediately
  { name: 'Quick Review in Carapace', script: reviewScript('&quick=1') },
  // Ignores the selection — it's here so the quick prompt is editable from the same menu
  { name: 'Edit Quick Review Prompt', script: 'cat > /dev/null\n/usr/bin/open "carapace://quick-prompt"' },
]

function infoPlist(serviceName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>${serviceName}</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSSendTypes</key>
			<array>
				<string>NSStringPboardType</string>
				<string>public.utf8-plain-text</string>
				<string>public.url</string>
				<string>NSURLPboardType</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`
}

function documentWflow(script: string): string {
  const escaped = script
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>521</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>${escaped}</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>0</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>4A1B0C2D-3E4F-5A6B-7C8D-9E0F1A2B3C4D</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
					<string>Command</string>
					<string>Run</string>
					<string>Unix</string>
				</array>
				<key>OutputUUID</key>
				<string>5B2C1D3E-4F5A-6B7C-8D9E-0F1A2B3C4D5E</string>
				<key>UUID</key>
				<string>6C3D2E4F-5A6B-7C8D-9E0F-1A2B3C4D5E6F</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict/>
				<key>isViewVisible</key>
				<integer>1</integer>
				<key>location</key>
				<string>309.000000:253.000000</string>
				<key>nibPath</key>
				<string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.text</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<integer>0</integer>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
`
}

function isCurrent(contentsDir: string): boolean {
  try {
    return readFileSync(join(contentsDir, '.carapace-version'), 'utf-8').trim() === VERSION
  } catch {
    return false
  }
}

function installOne(service: ServiceDef): boolean {
  const workflowDir = join(SERVICES_DIR, `${service.name}.workflow`)
  const contentsDir = join(workflowDir, 'Contents')

  if (existsSync(workflowDir) && isCurrent(contentsDir)) return false

  if (existsSync(workflowDir)) rmSync(workflowDir, { recursive: true, force: true })
  mkdirSync(contentsDir, { recursive: true })
  writeFileSync(join(contentsDir, 'Info.plist'), infoPlist(service.name))
  writeFileSync(join(contentsDir, 'document.wflow'), documentWflow(service.script))
  writeFileSync(join(contentsDir, '.carapace-version'), VERSION)
  return true
}

/**
 * Installs the Carapace entries into the macOS Services menu, so selecting a PR link anywhere
 * and right-clicking offers a review. Idempotent — safe to call every launch.
 *
 * Slack does surface the Services submenu (verified). Some apps that draw their own context
 * menu don't — the ⌥⌘R global shortcut in index.ts covers those.
 */
export function installReviewService(): void {
  if (process.platform !== 'darwin') return

  try {
    const installed = SERVICES.filter(installOne).map(s => s.name)
    if (installed.length === 0) return

    // Tell the pasteboard server to re-scan, otherwise items won't appear until logout
    execFile('/System/Library/CoreServices/pbs', ['-flush'], () => {})
    console.log(`[services] installed: ${installed.join(', ')}`)
  } catch (err) {
    console.warn('[services] Could not install Services menu items:', (err as Error).message)
  }
}

