# SunCHECK-TP-Fill

Tampermonkey userscript **TP Fill** v1.4 for SunCHECK temperature and pressure on the Peace machine.

The script only starts when the visible page shows "Peace" (for example the machine name in the top bar). It waits for the SunCHECK SPA to load, re-evaluates when you navigate in the app, and does nothing if that text never appears.

## Install

https://raw.githubusercontent.com/mobility22/SunCHECK-TP-Fill/refs/heads/main/suncheck-tp-fill.user.js

In Tampermonkey, choose Install from URL and paste that link, or open it after Tampermonkey is installed. Auto-update uses the same raw URL on `main`. After a first install, use Tampermonkey's Check for updates (or reinstall from that URL) to get v1.4.

## What it does

On a routine Execution page, the floating **TP Fill v1.4** button opens a panel. Enter a temperature and a pressure, then click Fill.

The script does not click the left tree first. It looks through the whole page for every Temperature and Pressure input already in the DOM (the same boxes you would reach with Ctrl+F for "temp" or "pressure") and fills them all with the same values. The result is reported as `Temperature: X of N filled, Pressure: Y of M filled`. If N or M is not 10, it warns but still fills what it found. If fewer than 10 are in the DOM (lazy rendering), it then clicks left-tree energy rows only as a fallback, waits for each section to settle, and fills any new boxes that appear. If it is still short, the panel says to scroll to the bottom and press Fill again.

The panel itself lives in a closed shadow root, and its field captions are CSS `::before` text, so a Ctrl+F search for "temp" or "pressure" does not hit the panel.

## Safety

- The primary fill path does not click anything on the page. The fallback, if used, clicks only left-tree constancy items and energy rows. It never clicks Pass/Fail All, Submit, Complete, Approve, Delete, or Save.
- Never changes fields other than Temperature and Pressure. PTP, readonly, disabled, and the panel's own inputs are left alone.
- Uses the same native value setter plus input, change, and blur events as the HDR Daily script (blur/autosave only; no final Submit).
- Logs are PHI-free: step summaries and numeric counts only, never page text or field values.

## Tests

`node --check` on the extracted script, and `node test/tp-fill.test.js` for the Peace gate, label matching, fill-all-on-one-page behavior, the lazy-render tree-row fallback, and the panel being hidden from find-in-page (uses `jsdom` when installed).
