---
title: Privacy Policy
permalink: /privacy/
---

# Privacy Policy

_Last updated: 6 November 2026_

Silhouette ("the app") is an open-source desktop application that copies events from your work calendars into a Google Calendar you own, as detail-free busy blocks. This policy explains what data the app handles and where that data goes.

**In short:** Silhouette runs entirely on your computer. It has no server, and its developers never receive, see or store any of your data.

## What the app accesses

### Your work calendar feeds

You give Silhouette the private ICS ("iCal") links of your work calendars. The app downloads these feeds directly from your calendar provider, such as Google or Microsoft, to find out when you are busy. Feed contents are processed in memory on your computer and aren't sent anywhere else.

### Your Google account

When you click **Connect Google account**, you sign in with Google and grant the app these permissions:

| Permission                                                    | Why the app needs it                                                                                                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your email address (`openid`, `email`)                        | To show which Google account is connected, and to notice if you reconnect with a different account.                                                                                                 |
| Manage calendars the app created (`calendar.app.created`)     | To create a dedicated calendar and add, update and remove busy blocks in it. This is the default.                                                                                                   |
| See your list of calendars (`calendar.calendarlist.readonly`) | To let you pick the target calendar from a list. The app does not read the events in these calendars.                                                                                               |
| Manage all your calendars (`calendar`)                        | Only if you choose **All my calendars** in settings, to sync into a calendar you already have. The app still only reads and changes events it created itself, which it identifies by a private tag. |

The app uses this access only to provide its calendar-syncing feature. Specifically, it:

- lists your calendars so you can choose where busy blocks go
- creates a calendar if you ask it to
- creates, updates and deletes the busy blocks it manages, each containing only a title (for example `Work - Acme`), a start and end time, and a private tag that marks the event as the app's own
- reads back only the events that carry that tag, to keep them in sync

It never reads, copies or changes any other events in your Google Calendar.

## Where your data is stored

Everything is stored locally on your computer, in the app's settings folder:

- your settings and sync rules
- your feed links, Google OAuth client secret and Google sign-in token, encrypted with your operating system's keychain (macOS Keychain or Windows DPAPI)
- activity logs, which may include your Google account email and calendar names

None of this is sent to the developers or to any third party.

## Who the app talks to

The app only connects to:

- **your calendar providers**, to download the ICS feeds you added
- **Google**, to sign you in and to use the Google Calendar API, as described above
- **GitHub**, to check for and download app updates, if automatic updates are on. GitHub sees your IP address and app version, like any download.

Silhouette has no analytics, telemetry, advertising or tracking of any kind.

## Sharing and selling

Your data is never sold, shared, rented or transferred to anyone. The developers have no access to it.

## Google API Services User Data Policy

Silhouette's use and transfer of information received from Google APIs to any other app will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

Information obtained through Google APIs is used only to provide the calendar-syncing feature described above. It is not used for advertising, is not used to train AI or machine-learning models, and is not read by humans.

## Deleting your data

You stay in control and can remove everything at any time:

1. **Disconnect** your Google account in the app, or revoke its access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
2. **Delete the calendar** Silhouette created in Google Calendar. This removes every busy block it added.
3. **Uninstall the app** and delete its settings folder:
   - macOS: `~/Library/Application Support/Calendar Sync`
   - Windows: `%APPDATA%\Calendar Sync`

## Children

Silhouette is not directed at children under 13 and does not knowingly process their data.

## Changes to this policy

If this policy changes, the updated version will be published at this address with a new "Last updated" date. The full history is visible in the project's [GitHub repository](https://github.com/shnek/Calendar-Sync).

## Contact

For questions about this policy, [open an issue on GitHub](https://github.com/shnek/Calendar-Sync/issues).
