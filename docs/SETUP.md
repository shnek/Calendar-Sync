# Setup guide

This guide walks you through setting up Calendar Sync once.

1. [Get the ICS link for each work calendar](#1-work-calendar-ics-links)
2. [Create a Google OAuth client](#google-oauth-client) (skip this if your build includes one)
3. [Connect Google and create the target calendar](#3-connect-google-and-create-the-target-calendar)
4. [Tune rules and share](#4-rules-and-sharing)

## 1. Work calendar ICS links

Each work calendar is read through its private ICS ("iCal") link. Anyone who has the link can read that calendar, so **treat it like a password**. Calendar Sync stores it encrypted.

### Google Workspace calendar

1. Sign in to Google Calendar with your **work** account.
2. Open ⚙ **Settings**. In the left sidebar under **Settings for my calendars**, select the calendar (usually your own name).
3. Scroll to **Integrate calendar**.
4. Copy **Secret address in iCal format**. It ends in `/basic.ics`.

If you don't see "Secret address", your Workspace admin has turned off external sharing of secret addresses. You can ask them to enable _"Share all information, but outsiders cannot change calendars"_ for secret addresses. If they won't, that calendar can't be synced with ICS.

### Outlook / Microsoft 365

1. Open Outlook on the web (outlook.office.com) with your work account.
2. Go to ⚙ **Settings → Calendar → Shared calendars**.
3. Under **Publish a calendar**, choose the calendar and a permission level:
   - **"Can view all details"** lets Calendar Sync read titles, so your title-based rules work.
   - **"Can view titles and locations"** also works.
   - **"Can view when I'm busy"** works too, but every event then has the same title, so title rules won't match.
4. Click **Publish** and copy the **ICS** link (not the HTML one).

Outlook publishes changes with a delay, sometimes several hours.

### In the app

Open **Work calendars → Add work calendar** and fill in:

- **Name:** only shown in this app.
- **Project / client:** used in the synced title, for example `Work - Acme`.
- **ICS URL:** the link you copied.

Click **Test link** to check that the feed loads. For Google feeds, your email is detected automatically, which lets the default rule skip invites you declined. For Outlook feeds you can enter it under **Advanced**.

<a id="google-oauth-client"></a>

## 2. Google OAuth client

Calendar Sync talks to Google Calendar through an OAuth client that **you** own, so nothing passes through anyone else's server. This takes about five minutes and is free.

1. Open the [Google Cloud console](https://console.cloud.google.com/projectcreate) and create a project, for example "Calendar Sync". Use your **personal** Google account.
2. Enable the [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) for that project.
3. Open [Google Auth Platform → Branding / Overview](https://console.cloud.google.com/auth/overview) and click **Get started**:
   - App name: `Calendar Sync`. Support email: your address.
   - Audience: **External**.
   - Contact email: your address. Agree and **Create**.
4. Go to **Audience** and click **Publish app**, then confirm.
   - This matters. While the app is in _Testing_, Google expires your sign-in every 7 days.
   - Publishing doesn't make anything public. It only lifts that limit.
   - You don't need to submit the app for verification.
5. Go to [Clients](https://console.cloud.google.com/auth/clients) → **Create client** and set:
   - Application type: **Desktop app**.
   - Name: anything.
6. Copy the **Client ID** and **Client secret** into the app under **Google calendar → OAuth client**, then click **Save client**.

> **Is the client secret really secret?** For desktop apps, no. Google documents that installed apps can't keep a secret, and security comes from the redirect to your own machine plus PKCE. It is still stored encrypted.

### Permission level

| Setting                                               | Scope                                            | Use when                                                  |
| ----------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| **Only calendars created by Calendar Sync** (default) | `calendar.app.created` + read-only calendar list | You let the app create a dedicated calendar. Recommended. |
| **All my calendars**                                  | `calendar`                                       | You want to sync into a calendar you already have.        |

In both modes Calendar Sync only edits events it created itself. These are identified by a private tag.

## 3. Connect Google and create the target calendar

1. Click **Connect Google account**. Your browser opens, and you sign in with the **personal** account.
2. Google warns _"Google hasn't verified this app"_. That's expected because it's your own client. Click **Advanced → Go to Calendar Sync (unsafe)**, then **Continue**.
3. On the next screen, **tick every checkbox** ("Select all"). Google lists each permission separately, and Calendar Sync needs all of them. If you leave any unticked, the app refuses the sign-in and asks you to try again.
4. Back in the app, under **Target calendar**, click **Create** to make a calendar called "Work", or choose one you already have.
5. Optionally, change the **title template**. You can use these placeholders:
   - `{project}`: the project or client name of the source
   - `{source}`: the source's display name
   - `{title}`: the original title, which reveals meeting names, so use it with care

## 4. Rules and sharing

**Rules** are applied in order, and the first matching _skip_ rule wins. The defaults skip:

- cancelled events
- invites you declined
- events marked _free_

A disabled example rule skips titles that contain "focus". Turn it on, or add your own, for example:

| Goal                             | Rule                                                      |
| -------------------------------- | --------------------------------------------------------- |
| Skip focus/hold blocks           | Title matches `focus\|hold\|blocked` → Skip               |
| Skip all-day reminders           | All-day: only all-day → Skip                              |
| Skip early-morning auto-blocks   | Starts before `08:00` → Skip                              |
| Only one calendar's lunch blocks | Title matches `lunch`, only for "Acme" → Skip             |
| Label 1:1s differently           | Title matches `^1:1` → Use title `Work - {project} (1:1)` |

Use **Preview** to see every upcoming event, whether it syncs, and which rule skipped it.

**Sharing:** in Google Calendar, open ⚙ Settings → your new calendar → **Share with specific people or groups** → add their address → **See all event details**. They'll see only the `Work - …` blocks.

## Troubleshooting

- **"Google sign-in expired or was revoked"**
  - Reconnect on the Google calendar page.
  - If it happens every week, your OAuth app is still in _Testing_. See step 2.4.
- **A feed shows "HTTP 401/403/404"**
  - The secret link was reset or publishing was turned off. Copy a fresh link.
- **"Response is not an iCalendar feed"**
  - You probably copied the HTML link (Outlook) or the public address (Google).
- **An event shows at the wrong time**
  - Check that it looks right in the source calendar.
  - Then open an issue with the event's `DTSTART` line from the feed. Redact the details.
- **Logs**
  - Activity → **Open log folder**, or look in:
    - Windows: `%APPDATA%\Calendar Sync\logs`
    - macOS: `~/Library/Application Support/Calendar Sync/logs`

## Removing Calendar Sync

1. Delete the target calendar in Google Calendar. That removes every synced event.
2. Revoke the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
3. Uninstall the app.
