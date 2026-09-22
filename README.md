# CSV Locale

*[Version française](README.fr.md)*

Chrome extension (Manifest V3) that converts CSV files downloaded from a list of sites to the computer's regional conventions: column delimiter, decimal separator, thousands separator and date format. The original file is kept, the converted copy (`export_converted.csv`, or `export_fr.csv` in French) is downloaded next to it.

No dependencies, no network calls for the conversion: everything runs locally in plain JavaScript.

## Installation

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. The settings page opens: add the start of the URL of the pages that generate your exports (e.g. `https://app.example.com/reports`). Chrome asks for access to the site: accept.
4. Check the extension icon on the site's tab: the **ON** badge means the extension is active there. A red **!** badge means access is missing.

Also works in Edge and Brave (Chromium 116+).

## What the conversion does

Example with a US export converted for a French computer:

| Item | Source | Output |
|---|---|---|
| Delimiter | `,` | `;` |
| Number | `"1,234.50"` | `1234,50` |
| Date | `03/15/2024` | `15/03/2024` |
| Date-time | `2024-03-15T14:05:09` | `15/03/2024 14:05:09` |
| Oracle date | `28-FEB-25`, `28-FÉVR.-2025` | `28/02/2025` |
| Oracle timestamp | `28-FEB-25 02.30.15.000000 PM` | `28/02/2025 14:30:15` |
| Text containing `;` | `Paris; Lyon` | `"Paris; Lyon"` |
| Encoding | UTF-8 or Windows-1252 | UTF-8 with BOM |

Safety rules:

- **A column is only changed if 100% of its values** (excluding the header and null values such as `N/A`, `null`, `-`) share the same type. A mixed column is left untouched.
- **No floating-point arithmetic**: digits are rewritten as text, with no loss of precision.
- Integers without separators (IDs, employee numbers, `00123`) never change.
- Dates are checked against the calendar (Feb 31 is rejected). Day/month order is inferred from values above 12; if the whole column is ambiguous, the hint comes from the export format (comma + point = US) or from the setting, and a warning is shown.
- `1.2.3`, `10-A`, `20240301` are treated neither as numbers nor as dates.
- The conversion is idempotent: a file already in the target format is not copied.
- On error (unclosed quote, expired session…), no copy is created and a notification explains why. The original file is never touched.

The default output thousands separator is "none", so Excel always reads the value as a number.

## Privacy

- **No data leaves the computer.** The conversion is local: no server, no telemetry, no third-party library.
- The extension only reads downloads coming from the sites you added.
- The history (last 30 conversions) holds file names and summaries, never file contents. It stays in the browser's local storage and can be cleared from the settings.
- The diagnostic only contains URL paths, without parameters or session tokens.

## Permissions

| Permission | Purpose |
|---|---|
| `downloads` | Detect downloaded CSV files and save the converted copy |
| `storage` | Keep settings and history |
| `scripting` | Inject the page script on the sites you added |
| `offscreen` | Create the converted file (not possible from a service worker) |
| `notifications` | Show the result of each conversion |
| Site access (optional) | Requested site by site, only for the sites you add |

## Architecture

```
manifest.json
_locales/                localized extension name and description
src/
  background.js          service worker: listens to chrome.downloads, orchestrates
  content/page-hook.js   MAIN world: keeps Blobs from JS exports, handles
                         one-time downloads (Oracle APEX)
  offscreen/             creates the blob URLs of the copies (not possible in a service worker)
  options/               settings, file test, history
  lib/
    csv.js               decoding, RFC 4180 parser, delimiter detection
    numbers.js           decimal conventions by voting, strict parser
    dates.js             date formats, D/M order, time zones
    converter.js         column typing and rewriting (pure, testable)
    capture.js           retrieval of the downloaded bytes
    i18n.js              interface texts in French and English
    settings.js, locale.js, urls.js, report.js, output.js
```

An extension cannot read a file from disk, so the content is retrieved depending on the source:

- **Export generated in JavaScript (`blob:`)**: sites often revoke the URL right after the click. The `page-hook.js` script, injected only on the configured sites, keeps a reference to the Blob and delays its revocation by 5 minutes. The extension reads it as soon as the download is created.
- **Direct link (`https:`)**: the file is fetched again by the service worker with the session cookies, or from the site's tab as a fallback.
- **`data:`**: decoded directly.
- **One-time download (Oracle APEX)**: the server prepares the file (`POST wwv_flow.ajax`) then serves it only once (`GET wwv_flow.ajax?...downloadFileId=...`); fetching it again returns 404. `page-hook.js` intercepts the file request, makes the single request itself, then hands the file to the user unchanged (same bytes, same name). Covered mechanisms: navigation (`location.href`, links), `apex.navigation.redirect`, `window.open`, hidden iframe (`src`, `setAttribute`, HTML or jQuery insertion).

### Diagnostic

The icon badge shows the status on the current tab (**ON** active, **!** inactive). The page script is registered on the whole origin of each site and also injected into tabs that are already open. It logs to the page console (filter `CSV Locale`): `hook active` on load, then `interception` and `file delivered` on each export. If a one-time download still fails, the settings history shows a "Diagnostic" block (hook status in each frame of the tab, latest events, URLs reduced to their path, no session token) with a copy button.

## Interface language

The interface (settings, notifications, history, console messages) is in French when Chrome is in French (`fr`, `fr-FR`, `fr-CA`…), and in English otherwise. The extension name follows the same rule ("CSV Locale FR" or "CSV Locale") through `_locales/`. Texts live in `src/lib/i18n.js`; a test checks that both languages have exactly the same keys.

## Regional settings

An extension has no access to the operating system's regional settings. The "Follow the browser language" mode uses Chrome's locale (`fr-FR` gives `;`, `,` and `DD/MM/YYYY`; `en-US` gives `,`, `.` and `MM/DD/YYYY`). If Chrome's language differs from the system's, switch to manual mode.

## Known limitations

- Exports triggered by a **POST** form cannot be replayed: the extension reports it and creates no copy.
- **One-time URLs** other than Oracle APEX may fail on refetch (new rules go into `isOneTimeDownloadUrl`, in both `page-hook.js` and `urls.js`).
- The copy is saved to the default download folder, even if the original was saved elsewhere with "Save as".
- Two-digit years: `00-49` → `20xx`, `50-99` → `19xx` (Oracle `RR` rule for dates with month names).
- Month names recognised: Oracle abbreviations in English (`JAN`…`DEC`) and French (`JANV.`…`DÉC.`). Other NLS languages leave the column untouched.
- A fraction of a second made only of zeros (`.000000`) is dropped in the output.

## Contributing

1. Add a test to `tests/engine.test.js` reproducing the case (no real data, no token).
2. Fix, then check that `npm test` and `npm run check` pass. GitHub Actions runs them on every push.
3. Any new interface text goes into `src/lib/i18n.js`, in French **and** English.

## Tests

```bash
npm test                      # 42 unit tests of the engine (Node 18+)
npm run check                 # syntax check
python tests/e2e/e2e.py       # end to end in Chromium (requires Playwright)
```

The end-to-end test starts a local site with a `blob:` export revoked immediately, an `https:` export in Windows-1252 and a simulated Oracle APEX one-time download through each covered mechanism. It checks the produced copies byte by byte, and that the APEX file is requested only once from the server.

## License

[MIT](LICENSE). You may use, modify and redistribute this code freely, including commercially, as long as the copyright notice is kept. The software is provided without warranty.
