# Calendar Sync

A small tray app for Windows and macOS that copies your **work calendars** (Google Workspace, Outlook / Microsoft 365, or any ICS feed) into **one private Google Calendar** as detail-free busy blocks. You can share that calendar with family, so they can see when you're in meetings without seeing what the meetings are about.

```
Acme (Google)    "Q3 roadmap with CFO"   ─┐
Globex (Outlook) "1:1 with Dana"          ├─▶  Personal "Work" calendar:  Work - Acme
Initech (Google) "Focus time"  (skipped) ─┘                               Work - Globex
```

## Features

- **Reads any number of work calendars** through their private ICS/iCal links. Access is read-only and needs no admin approval.
- **Writes only the bare minimum.** Each event gets a title such as `Work - Acme` plus its start and end time. Nothing else is copied: no description, attendees, location or meeting links.
- **Rules** decide which events to skip or rename. You can match on:
  - title or description (regex)
  - busy/free/tentative/out-of-office status
  - cancelled events, or invites you declined
  - all-day or recurring events
  - duration, weekday and time of day
  - which source calendar it came from
- **Preview** shows every upcoming event, and for each one whether it will sync or which rule skips it.
- **Safe to re-run:**
  - Each run updates the target to match the sources.
  - Edits and cancellations in the source are applied to the target.
  - If a feed fails to download, its events are not deleted.
  - Running it on two computers does not create duplicates.
- **Lives in the tray:** starts at login, syncs every 15 minutes (configurable), catches up after sleep, and shows a notification when something needs attention.
- **Secrets stay local.** Feed links and Google tokens are encrypted with the OS keychain (DPAPI or Keychain), and no server is involved.

## Install

Download the latest installer from the [Releases](../../releases) page:

| Platform | File                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------- |
| Windows  | `calendar-sync-<version>-setup.exe`                                                                 |
| macOS    | `calendar-sync-<version>-mac.dmg` (universal: Apple Silicon + Intel). Drag the app to Applications. |

Builds are currently **unsigned**, so each OS warns the first time you open the app:

- **Windows SmartScreen:** click "More info", then "Run anyway".
- **macOS:**
  1. Right-click the app and choose "Open", then click "Open" again.
  2. If that doesn't work, run `xattr -dr com.apple.quarantine "/Applications/Calendar Sync.app"`.

## Setup (about 10 minutes)

1. **Add your work calendars** (Work calendars page): paste each calendar's secret ICS link and give it a project name.
2. **Google OAuth client** (Google calendar page): create a free "Desktop app" OAuth client in Google Cloud. Release builds may already include one.
3. **Connect** your personal Google account.
4. **Create the target calendar.** The default name is "Work".
5. **Check Preview**, adjust Rules (for example, turn on "Skip focus blocks"), then press **Sync now**.
6. **Share the calendar** in Google Calendar settings with the people who should see it.

Step-by-step instructions with screenshots-worth of detail: **[docs/SETUP.md](docs/SETUP.md)**.

## How it works

```
 ICS feeds ──fetch──▶ parse + expand recurrences ──▶ rules ──▶ desired events
                                                                    │ diff
 Google Calendar ◀── create / update / delete ◀── planner ◀── existing tagged events
```

**Tagging and IDs**

- Every event the app writes carries a private tag, and the app only ever lists, changes or deletes events with that tag.
- Each event's ID is derived from a hash of the source calendar and the occurrence. That's why the diff is deterministic and two machines can't create duplicates.

**What gets synced**

- Recurring events are expanded within the sync window: 7 days back and 60 ahead by default.
- Exceptions (moved or cancelled occurrences) and time zones are honoured, including the Windows zone names Outlook uses.

**Delete safety**

- If a feed fails, the planner deletes nothing from that source.
- Removing or disabling a source cleans up its events.

### Known limitations

- **Feed delay:** ICS feeds are not real-time. Google's secret address usually updates within minutes, but Outlook's published calendar can trail by several hours.
- **Admin settings:** some organisations disable calendar publishing (Google Workspace: "secret address"; Microsoft 365: calendar publishing). That calendar can't be read without an OAuth-based source, which is on the roadmap.
- **Read-only:** the app never writes to work calendars.

## Development

Requires Node.js 20+ (24 recommended).

```bash
npm install
npm run dev          # Electron app with hot reload
npm test             # unit tests (vitest)
npm run lint && npm run typecheck
```

> Running inside VS Code's terminal? If Electron starts as plain Node ("Cannot read properties of undefined"), unset `ELECTRON_RUN_AS_NODE`.

**Headless CLI** (same engine; useful for debugging feeds and rules):

```bash
npm run cli -- init                 # writes calendar-sync.config.json (git-ignored, unencrypted)
npm run cli -- preview              # what would sync, and which rule skips what
npm run cli -- auth                 # connect Google
npm run cli -- create-calendar Work
npm run cli -- sync --dry-run
```

**Local installers:** `npm run build:win` or `npm run build:mac`. Output goes to `release/<version>/`. The macOS build has to run on a Mac.

**Icons** are generated from code: `npm run icons`.

### Project layout

```
src/core/      sync engine - pure TypeScript, no Electron (ICS parsing, rules, planner, Google target)
src/main/      Electron main process: tray, scheduler, encrypted config store, IPC, auto-update
src/preload/   typed bridge exposed to the UI as window.api
src/renderer/  React settings UI
src/cli/       headless CLI around src/core
test/          vitest suites + ICS fixtures (Google & Outlook flavoured)
```

## Releasing

1. Bump `version` in `package.json` and commit.
2. Tag the commit and push the tag: `git tag v0.2.0 && git push --tags`.
3. The **Release** workflow:
   1. checks that the tag matches the version
   2. runs the tests
   3. builds the Windows `.exe` and the macOS `.dmg`/`.zip` on GitHub runners
   4. attaches them to a **draft** release
4. Review the draft and publish it. Installed apps update themselves from published releases (Windows; macOS needs signing).

Optional repository secrets:

| Secret                                                     | Purpose                                                        |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                 | Bake a default OAuth client into release builds (see SETUP.md) |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`                     | Windows code signing (base64 `.pfx`)                           |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`                     | macOS Developer ID certificate (base64 `.p12`)                 |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization                                             |

## Roadmap

- Cross-client busy blocking: put a "Busy" hold on client B's calendar while you're in a client A meeting. This needs OAuth write access to the work calendars, and the `CalendarTarget` interface already allows for it.
- OAuth-based sources (Google / Microsoft Graph) for organisations that block ICS publishing.
- Code signing and notarization.

## Privacy

Calendar Sync has no backend and collects no telemetry. The only data that leaves your machine:

- requests to your ICS feed URLs
- calls to the Google Calendar API, carrying the minimal events described above

## License

[MIT](LICENSE)
