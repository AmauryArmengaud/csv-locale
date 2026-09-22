# Changelog

## 1.3.0
- Interface in French or English depending on the browser language (settings page, notifications, history, console messages, extension name).
- Default suffix of the converted file: `_fr` in French, `_converted` in English.

## 1.2.0
- Page script registered on the whole origin of each site and injected into already open tabs: no reload needed.
- Status badge on the extension icon (**ON** active, **!** inactive).
- Version and activation status shown in the settings.

## 1.1.0
- Oracle APEX one-time downloads (interactive reports and grids): intercepted through navigation, `apex.navigation.redirect`, `window.open` and hidden iframes.
- Diagnostic block in the history when a one-time download cannot be intercepted.
- Oracle dates (`DD-MON-YYYY`, `DD-MON-RR`, `TIMESTAMP`) in English and French.

## 1.0.0
- First version: delimiter, decimal, thousands and date conversion, original file kept, settings page with file test and history.
