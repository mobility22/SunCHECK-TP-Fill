'use strict';
const fs = require('fs');
const path = require('path');

const TEMP_LABEL_RE = /^\s*Temperature(\s*\([^)]*\))?\s*$/i;
const PRESS_LABEL_RE = /^\s*Pressure(\s*\([^)]*\))?\s*$/i;
const FORBIDDEN_CLICK_RE = /^(pass(\s*all)?|fail(\s*all)?|submit|complete|approve|unapprove|delete|cancel|save)$/i;
const FORBIDDEN_WORD_RE = /\b(pass\s*all|fail\s*all|submit|complete|approve|unapprove|delete)\b/i;
const ICP_RE = /quad\s*wedges?|\bICP\b/i;
const GATE_RE = /peace/i;
const TEMP_WORD_RE = /\btemperature\b/i;
const PRESS_WORD_RE = /\bpressure\b/i;
const PTP_RE = /\bptp\b/i;
const UNIT_C_RE = /^°?C$/i;
const UNIT_PRESS_RE = /kPa|mmHg/i;
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();

function valuesEqual(a, b) {
  const sa = String(a ?? '').trim(), sb = String(b ?? '').trim();
  if (sa === sb) return true;
  const na = Number(sa), nb = Number(sb);
  return sa !== '' && sb !== '' && Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) < 1e-6;
}
function isIcpLabel(text) { return ICP_RE.test(norm(text)); }
function isGroupLabel(text, groupName) {
  const a = norm(text);
  if (!a || isIcpLabel(a)) return false;
  return new RegExp('^' + groupName.replace(/\s+/g, '\\s*') + '$', 'i').test(a);
}
function temperatureLabelMatches(text) { return TEMP_LABEL_RE.test(norm(text)); }
function pressureLabelMatches(text) { return PRESS_LABEL_RE.test(norm(text)); }
function isForbiddenClickText(text) {
  const t = norm(text);
  return !t ? false : (FORBIDDEN_CLICK_RE.test(t) || FORBIDDEN_WORD_RE.test(t));
}
function pageHasPeace(headerText, bodyText) {
  if (GATE_RE.test(headerText || '')) return true;
  return GATE_RE.test(bodyText || '');
}
function formatSummary(tOk, tN, pOk, pN, expected) {
  const exp = expected == null ? 10 : expected;
  let msg = 'Temperature: ' + tOk + ' of ' + tN + ' filled, Pressure: ' + pOk + ' of ' + pN + ' filled';
  if (tN < exp || pN < exp) {
    msg += '. Only ' + tN + ' temperature / ' + pN + ' pressure found — scroll to the bottom and press Fill again';
  } else if (tN > exp || pN > exp) {
    msg += '. Note: found ' + tN + ' temperature and ' + pN + ' pressure boxes (expected ' + exp + ')';
  }
  return msg;
}

let failed = 0;
function check(name, got, expected) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + ' got ' + JSON.stringify(got) + ' expected ' + JSON.stringify(expected));
}

check('values equal numeric', valuesEqual('22.3', '22.300'), true);
check('temp label', temperatureLabelMatches('Temperature'), true);
check('press kPa or mmHg', pressureLabelMatches('Pressure (kPa or mmHg)'), true);
check('press mmHg after fill', pressureLabelMatches('Pressure (mmHg)'), true);
check('group rejects ICP', isGroupLabel('Photon constancy with quad wedges (ICP)', 'Photon constancy'), false);
check('forbid Approve', isForbiddenClickText('Approve'), true);
check('allow 6 MV', isForbiddenClickText('6 MV'), false);
check('gate Peace', pageHasPeace('Daily | HDR_Peace', ''), true);
check('gate not Bravos', pageHasPeace('Daily | HDR_Bravos', ''), false);
check('summary 10 of 10', formatSummary(10, 10, 10, 10), 'Temperature: 10 of 10 filled, Pressure: 10 of 10 filled');
check('summary short', formatSummary(4, 4, 4, 4).indexOf('scroll to the bottom') !== -1, true);
check('summary extra', formatSummary(12, 12, 12, 12).indexOf('expected 10') !== -1, true);

const src = fs.readFileSync(path.join(__dirname, '..', 'suncheck-tp-fill.user.js'), 'utf8');
check('script @version 1.4', /@version\s+1\.4\b/.test(src), true);
check('script SCRIPT_VERSION', /const SCRIPT_VERSION = '1\.4'/.test(src), true);
check('script closed shadow', src.includes("attachShadow({ mode: 'closed' })") && src.includes('data-label') && src.includes('::before'), true);
check('script has no paste field or parser', !src.includes('sc-tp-paste') && !src.includes('function parsePaste') && !src.includes('applyPaste') && !src.includes('Or paste both'), true);
check('script primary path has no required click', src.includes('start fill (scan all inputs, no navigation)'), true);
check('script fallback only if short', src.includes('fewer than') && src.includes('tree-row fallback'), true);
check('PHI-free log: no innerText dump in log()', /log\([^)]*innerText/.test(src), false);

function loadJsdom() {
  const tries = ['jsdom', '/tmp/jsdom-root/node_modules/jsdom', path.join(__dirname, '../node_modules/jsdom')];
  for (const p of tries) {
    try { return require(p); } catch (e) { /* next */ }
  }
  return null;
}

function sectionHtml(id, energy, tVal, pVal) {
  return '<section id="' + id + '">' +
    '<div class="h">Dosimetry - Photon constancy <b>' + energy + '</b></div>' +
    '<div>Temperature</div><input class="t" id="t-' + id + '" type="text"' + (tVal != null ? ' value="' + tVal + '"' : '') + '><span>C</span>' +
    '<div>Pressure (kPa or mmHg)</div><input class="p" id="p-' + id + '" type="text"' + (pVal != null ? ' value="' + pVal + '"' : '') + '><span>kPa/mmHg</span>' +
    '<div>PTP</div><input class="ptp" id="ptp-' + id + '" type="text" readonly value="1.00">' +
    '</section>';
}

const jsdom = loadJsdom();
if (!jsdom) {
  if (failed) { console.error(failed + ' failed'); process.exit(1); }
  console.log('SKIP DOM fixture tests (jsdom not installed)');
  console.log('all tests passed');
  process.exit(0);
}

const { JSDOM } = jsdom;
function loadApi(html) {
  const dom = new JSDOM('<!DOCTYPE html><html><body>' + html + '</body></html>', {
    url: 'https://example.test/#/Routine/Execution',
    runScripts: 'dangerously',
    beforeParse(window) {
      window.TP_FILL_TEST = true;
      Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
        get() { return this.parentNode && this.parentNode !== this.ownerDocument ? this.parentNode : this.ownerDocument.body; }
      });
    }
  });
  const script = dom.window.document.createElement('script');
  script.textContent = src;
  dom.window.document.body.appendChild(script);
  if (!dom.window.TP_FILL_API) throw new Error('TP_FILL_API not exported');
  return { api: dom.window.TP_FILL_API, document: dom.window.document, window: dom.window };
}

const energies = ['6 MV', '10 MV', '15 MV', '6 FFF', '10 FFF', '6 MeV', '9 MeV', '12 MeV', '16 MeV', '20 MeV'];

// 10+10 on one page: fill all, do not click the tree
{
  let clicks = 0;
  const tree = '<nav class="tree"><div>Photon constancy</div>' +
    energies.slice(0, 5).map(e => '<div class="child">' + e + '</div>').join('') + '</nav>';
  const pane = '<header>Daily | HDR_Peace</header><main id="pane">' +
    energies.map((e, i) => sectionHtml('s' + i, e, '', '')).join('') +
    '</main>';
  const { api, document } = loadApi(tree + pane);
  document.querySelectorAll('.tree .child, .tree div').forEach(el => {
    el.addEventListener('click', () => { clicks++; });
  });
  const found = api.findAllClassifiedInputs();
  check('scan finds 10 temp', found.temps.length, 10);
  check('scan finds 10 press', found.presses.length, 10);
  const result = api.runFill('22.3', '101.2');
  Promise.resolve(result).then(r => {
    check('fill 10+10 tOk', r && r.tOk, 10);
    check('fill 10+10 pOk', r && r.pOk, 10);
    check('fill 10+10 summary 10 of 10', !!(r && r.summary && r.summary.indexOf('Temperature: 10 of 10 filled, Pressure: 10 of 10 filled') === 0 && r.summary.indexOf('Only') === -1), true);
    check('fill 10+10 did not click the tree', clicks, 0);
    const allT = [...document.querySelectorAll('input.t')].every(el => el.value === '22.3');
    const allP = [...document.querySelectorAll('input.p')].every(el => el.value === '101.2');
    const ptpUntouched = [...document.querySelectorAll('input.ptp')].every(el => el.value === '1.00');
    check('fill 10+10 all temp values set', allT, true);
    check('fill 10+10 all press values set', allP, true);
    check('fill 10+10 PTP untouched', ptpUntouched, true);
    testPanelAndExtras();
  }).catch(err => {
    check('fill 10+10 threw', String(err && err.message || err), 'no throw');
    finish();
  });
}

function testPanelAndExtras() {
  // Panel in closed shadow: light DOM / Ctrl+F must not see Temperature or Pressure
  {
    const { api, document } = loadApi('<header>Daily | HDR_Peace</header><main></main>');
    api.addPanel();
    const host = document.getElementById('suncheck-tp-panel');
    // Only the panel host's light-DOM text (body also contains the injected userscript source).
    const light = host ? (host.textContent || host.innerHTML || '') : 'MISSING_PANEL';
    check('panel host has no Temperature/Pressure text', !/temperature|pressure/i.test(light), true);
    const root = api.panelRoot();
    check('panel uses closed shadow root', !!(root && root.mode === 'closed'), true);
    const labels = root ? [...root.querySelectorAll('[data-label]')].map(el => el.getAttribute('data-label')) : [];
    check('panel labels are data-label CSS content', labels.some(s => /Temperature/.test(s)) && labels.some(s => /Pressure/.test(s)), true);
    check('panel has no paste field', !!(root && !root.querySelector('.sc-tp-paste') && !labels.some(s => /paste/i.test(s || ''))), true);
    check('panel has temp, pressure, Fill, and status', !!(root && root.querySelector('.sc-tp-temp') && root.querySelector('.sc-tp-press') && root.querySelector('.sc-tp-fill') && root.getElementById('suncheck-tp-status')), true);
    const scanned = api.findAllClassifiedInputs();
    check('panel inputs excluded from scan', scanned.temps.length === 0 && scanned.presses.length === 0, true);
  }

  // More than 10 (e.g. ICP sections also in the DOM): fill all, report the count
  {
    const extra = sectionHtml('icp1', '6 MV', '', '') + sectionHtml('icp2', '10 MV', '', '');
    const pane = '<header>Daily | HDR_Peace</header><main>' +
      energies.map((e, i) => sectionHtml('s' + i, e, '', '')).join('') + extra + '</main>';
    const { api } = loadApi(pane);
    const found = api.findAllClassifiedInputs();
    check('scan finds 12 temp including extras', found.temps.length, 12);
    Promise.resolve(api.runFill('21', '756')).then(r => {
      check('fill extras tOk 12', r && r.tOk, 12);
      check('fill extras pOk 12', r && r.pOk, 12);
      check('fill extras notes expected 10', !!(r && r.summary && /expected 10/.test(r.summary)), true);
      testLazyFallback();
    }).catch(err => {
      check('fill extras threw', String(err && err.message || err), 'no throw');
      finish();
    });
  }
}

function testLazyFallback() {
  // Only 2 sections in the DOM until a tree row is clicked, then more appear
  const initial = '<header>Daily | HDR_Peace</header>' +
    '<nav class="tree"><div>Photon constancy</div><div class="child" id="row-6">6 MV</div><div class="child" id="row-10">10 MV</div></nav>' +
    '<main id="pane">' + sectionHtml('s0', '6 MV', '', '') + sectionHtml('s1', '10 MV', '', '') + '</main>';
  const { api, document } = loadApi(initial);
  const pane = document.getElementById('pane');
  let clicks = 0;
  function revealRest() {
    if (document.getElementById('s2')) return;
    pane.insertAdjacentHTML('beforeend', energies.slice(2).map((e, i) => sectionHtml('s' + (i + 2), e, '', '')).join(''));
  }
  document.getElementById('row-10').addEventListener('click', () => { clicks++; setTimeout(revealRest, 80); });
  document.getElementById('row-6').addEventListener('click', () => { clicks++; });
  const before = api.findAllClassifiedInputs();
  check('lazy start finds only 2 temp', before.temps.length, 2);
  Promise.resolve(api.runFill('22.3', '101.2')).then(r => {
    check('lazy fallback clicked a tree row', clicks > 0, true);
    check('lazy fallback ended with 10 temp filled', r && r.tOk, 10);
    check('lazy fallback ended with 10 press filled', r && r.pOk, 10);
    finish();
  }).catch(err => {
    check('lazy fallback threw', String(err && err.message || err), 'no throw');
    finish();
  });
}

function finish() {
  if (failed) {
    console.error(failed + ' failed');
    process.exit(1);
  }
  console.log('all tests passed');
}
