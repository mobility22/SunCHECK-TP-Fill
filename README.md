# SunCHECK-TP-Fill

Tampermonkey userscript **TP Fill** v1.1 for SunCHECK temperature and pressure on the Peace machine.

The script only starts when the visible page shows "Peace" (for example the machine name in the top bar). It waits for the SunCHECK SPA to load, re-evaluates when you navigate in the app, and does nothing if that text never appears.

## Install

https://raw.githubusercontent.com/mobility22/SunCHECK-TP-Fill/refs/heads/main/suncheck-tp-fill.user.js

In Tampermonkey, choose Install from URL and paste that link, or open it after Tampermonkey is installed. Auto-update uses the same raw URL on `main`. After a first install, use Tampermonkey's Check for updates (or reinstall from that URL) to get v1.1.

## What it does

On a routine Execution page, the floating **TP Fill v1.1** button opens a panel. Enter a temperature and a pressure — or paste a pair such as `22.3 101.2` — then click Fill. The same two values are written into the Environmentals Temperature and Pressure boxes on all 10 target energies:

- Photon constancy: 6 MV, 10 MV, 15 MV, 6 FFF, 10 FFF
- Electron constancy: 6, 9, 12, 16, 20 MeV

Groups named "Photon/Electron constancy with quad wedges (ICP)" are not used. Navigation prefers the left-tree energy child rows and uses the top energy tabs only as a fallback. Values entered today are remembered in localStorage and offered again the same day. A run reports `X of 10 filled` and any failures by energy name, with a count of how many inputs were scanned if a field could not be found.

## Safety

- Never clicks Pass/Fail All, Submit, Complete, Approve, Delete, Save, or any control other than the left-tree constancy items and energy rows (or a tab if no tree row is found).
- Never changes fields other than Temperature and Pressure. PTP, readonly, and disabled inputs are left alone.
- Uses the same native value setter plus input, change, and blur events as the HDR Daily script (blur/autosave only; no final Submit).
- Logs are PHI-free: step summaries and numeric counts only, never page text or field values.

## Tests

`node --check` on the extracted script, and `node test/tp-fill.test.js` for the Peace gate, paste parser, label matching, ICP exclusion, forbidden-click rules, and DOM fixtures for the input matcher (uses `jsdom` when installed).

## Selector assumptions to verify live

- Tree **group** items are found by a short visible label of exactly **Photon constancy** or **Electron constancy**. A label that also says "quad wedge" or "ICP" is ignored.
- Tree **energy rows** under that group are the primary way to open each energy (for example **6 MV** or **6 MeV**; a bare **6** is accepted only for an MeV energy). Top-of-pane energy tabs are used only if no tree row is found.
- Temperature and Pressure inputs are found without requiring an "Environmentals" heading: by `aria-label`, `placeholder`, `title`, `name`, `id`, or `formcontrolname`, or by nearby text / unit suffix (`C` vs `kPa/mmHg`), inside the **Dosimetry - Photon/Electron constancy** section for the selected energy. The script scrolls that section into view and waits up to about 5 seconds for lazy rendering.
