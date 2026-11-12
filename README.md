# SunCHECK-TP-Fill

Tampermonkey userscript **TP Fill** v1.0 for SunCHECK temperature and pressure on the Peace machine.

The script only starts when the visible page shows "Peace" (for example the machine name in the top bar). It waits for the SunCHECK SPA to load, re-evaluates when you navigate in the app, and does nothing if that text never appears.

## Install

https://raw.githubusercontent.com/mobility22/SunCHECK-TP-Fill/refs/heads/main/suncheck-tp-fill.user.js

In Tampermonkey, choose Install from URL and paste that link, or open it after Tampermonkey is installed. Auto-update uses the same raw URL on `main`.

## What it does

On a routine Execution page, the floating **TP Fill v1.0** button opens a panel. Enter a temperature and a pressure — or paste a pair such as `22.3 101.2` — then click Fill. The same two values are written into the Environmentals Temperature and Pressure boxes on all 10 target energies:

- Photon constancy: 6 MV, 10 MV, 15 MV, 6 FFF, 10 FFF
- Electron constancy: 6, 9, 12, 16, 20 MeV

Groups named "Photon/Electron constancy with quad wedges (ICP)" are not used. Values entered today are remembered in localStorage and offered again the same day. A run reports `X of 10 filled` and any failures by energy name.

## Safety

- Never clicks Pass/Fail All, Submit, Complete, Approve, Delete, Save, or any control other than the left-tree constancy items and energy tabs.
- Never changes fields other than Temperature and Pressure.
- Uses the same native value setter plus input, change, and blur events as the HDR Daily script (blur/autosave only; no final Submit).
- Logs are PHI-free: step summaries only, never page text or field values.

## Tests

`node --check` on the extracted script, and `node test/tp-fill.test.js` for the Peace gate, paste parser, label matching, ICP exclusion, and forbidden-click rules.

## Selector assumptions to verify live

These are the rules the script uses to find things on the page. Please confirm them on a real Execution page:

- Tree items are found by a short visible label of exactly **Photon constancy** or **Electron constancy** in a sidebar/tree. A label that also says "quad wedge" or "ICP" is ignored.
- The energy is then selected by a tab in the main panel (falling back to a tree child) whose label is **6 MV**, **10 MV**, **15 MV**, **6 FFF**, **10 FFF**, or **6/9/12/16/20 MeV**. A bare **6** is accepted only for an MeV energy, so it will not match 16.
- Temperature and Pressure inputs are found from a visible label of **Temperature** (optional unit in parentheses) or **Pressure** / **Pressure (kPa or mmHg)** inside an **Environmentals** section.
- The script only offers the button on a `#/Routine/Execution` hash, same as HDR Daily.
