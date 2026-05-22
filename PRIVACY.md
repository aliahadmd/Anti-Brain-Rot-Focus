# Privacy Policy for Anti-Brain Rot Focus

Effective date: May 22, 2026

Anti-Brain Rot Focus is a Microsoft Edge browser extension that helps users stay focused by blocking user-selected distracting websites, showing a local motivational block page, tracking local aggregate focus statistics, and awarding local focus medals.

## Summary

Anti-Brain Rot Focus is designed to keep your data on your device.

- The extension does not create an account.
- The extension does not collect your name, email address, payment information, health information, messages, passwords, or precise location.
- The extension does not sell, rent, or transfer user data to third parties.
- The extension does not use remote code.
- The extension stores settings, blocklists, aggregate analytics, pause history, and reward progress locally in Microsoft Edge extension storage.

## Data the Extension Processes

The extension may process the following data locally in your browser:

### Blocked Site Domains

You can add domains to your blocklist, such as `youtube.com` or `example.com`. The extension uses this list to decide whether a visited website should be blocked.

### Website Hostnames for Blocking

When you navigate to a webpage, the extension checks the top-level website hostname against your local blocklist. For example, it may compare `youtube.com` against your blocked domains.

The extension does not store full URLs, page content, search queries, form data, or browsing history logs.

### Local Aggregate Statistics

The extension stores aggregate counts such as:

- Total number of blocked redirects.
- Per-domain redirect counts.
- Daily aggregate redirect counts.
- Recent trend data for the dashboard.

These statistics are stored locally and are used only to show your dashboard analytics.

### Focus Settings and Rewards

The extension stores local settings and reward data such as:

- Whether Focus Mode is enabled.
- Whether Focus Mode is paused and when the pause ends.
- Your custom motivational message.
- Reward progress days.
- Pause penalty events.
- Earned medal records.
- Local date keys used for reward and analytics calculations.

This data is used only to provide the extension's focus, analytics, and reward features.

## How Data Is Used

Anti-Brain Rot Focus uses local data to:

- Block distracting domains selected by the user.
- Redirect blocked visits to the extension's local focus page.
- Show local dashboard analytics.
- Manage import and export of blocklists.
- Track reward progress and earned medals.
- Apply pause penalties when the user chooses to pause Focus Mode.
- Remember the user's settings and motivational message.

## Data Sharing

Anti-Brain Rot Focus does not sell, rent, share, or transfer user data to third parties.

The extension does not send your blocklist, browsing activity, analytics, reward data, or settings to any external server.

## Remote Code

Anti-Brain Rot Focus does not use remote code. All JavaScript, HTML, CSS, and assets are packaged with the extension. The extension does not load external scripts, remote modules, external WebAssembly, or code through `eval`.

## Permissions

The extension requests only the permissions needed for its single purpose:

- `storage`: saves the blocklist, settings, local analytics, pause state, and rewards in Microsoft Edge local extension storage.
- `webNavigation`: checks top-level navigations against the local blocklist.
- `tabs`: redirects blocked tabs to the extension's local block page and supports closing that blocked tab when requested.
- `alarms`: periodically reconciles local reward progress.

## Data Retention and Deletion

Data is stored locally in Microsoft Edge extension storage for as long as the extension remains installed, unless the user changes or clears it.

Users can:

- Remove blocked domains from the dashboard.
- Reset local statistics from the dashboard settings.
- Export their blocklist as a JSON file.
- Uninstall the extension to remove extension-managed local storage from Microsoft Edge.

Reward day logs and pause events are pruned to recent history to avoid unbounded local storage growth.

## Children's Privacy

Anti-Brain Rot Focus is a general productivity tool and is not directed to children. The extension does not knowingly collect personal information from children.

## Changes to This Policy

This privacy policy may be updated when the extension's functionality changes. Updates will be published in this repository.

## Contact

For privacy questions or support, please open an issue on GitHub:

https://github.com/aliahadmd/Anti-Brain-Rot-Focus/issues
