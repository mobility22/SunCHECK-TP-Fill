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

function parsePaste(text) {
  const m = norm(text).match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/)
    || norm(text).match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);
  return m ? { temperature: m[1], pressure: m[2] } : null;
}
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
function energyLabelMatches(text, energy) {
  const a = norm(text), b = norm(energy);
  if (!a || isIcpLabel(a)) return false;
  if (new RegExp('^' + b.replace(/\s+/g, '\\s*') + '$', 'i').test(a)) return true;
  const m = /^(\d+(?:\.\d+)?)\s*MeV$/i.exec(b);
  return !!(m && new RegExp('^' + m[1] + '$').test(a));
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
function kindFromAttrs(blob) {
  if (!blob) return null;
  if (PTP_RE.test(blob)) return 'ptp';
  const hasTemp = /temperature/i.test(blob);
  const hasPress = /pressure/i.test(blob);
  if (hasTemp && !hasPress) return 'temperature';
  if (hasPress && !hasTemp) return 'pressure';
  return null;
}
function kindFromNearby(texts, units) {
  const exactTemp = texts.some(temperatureLabelMatches);
  const exactPress = texts.some(pressureLabelMatches);
  if (exactTemp && !exactPress) return 'temperature';
  if (exactPress && !exactTemp) return 'pressure';
  if (exactTemp && exactPress) {
    for (const s of texts) {
      if (temperatureLabelMatches(s)) return 'temperature';
      if (pressureLabelMatches(s)) return 'pressure';
    }
  }
  const hasTemp = texts.some(s => TEMP_WORD_RE.test(s));
  const hasPress = texts.some(s => PRESS_WORD_RE.test(s));
  const hasC = units.some(u => UNIT_C_RE.test(u));
  const hasKpa = units.some(u => UNIT_PRESS_RE.test(u));
  if (hasTemp && !hasPress) return 'temperature';
  if (hasPress && !hasTemp) return 'pressure';
  if (hasKpa && !hasTemp) return 'pressure';
  if (hasC && hasTemp && !hasPress) return 'temperature';
  return null;
}

let failed = 0;
function check(name, got, expected) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + ' got ' + JSON.stringify(got) + ' expected ' + JSON.stringify(expected));
}

check('paste spaces', parsePaste('22.3 101.2'), { temperature: '22.3', pressure: '101.2' });
check('paste comma', parsePaste('22.3, 101.2'), { temperature: '22.3', pressure: '101.2' });
check('paste semicolon', parsePaste('22.3;101.2'), { temperature: '22.3', pressure: '101.2' });
check('paste extra spaces', parsePaste('  22.3    101.2  '), { temperature: '22.3', pressure: '101.2' });
check('paste one number', parsePaste('22.3'), null);
check('paste empty', parsePaste(''), null);
check('paste words', parsePaste('warm high'), null);

check('values equal strings', valuesEqual('22.3', '22.3'), true);
check('values equal numeric', valuesEqual('22.3', '22.300'), true);
check('values different', valuesEqual('22.3', '22.4'), false);
check('values empty', valuesEqual('', '22.3'), false);

check('group photon', isGroupLabel('Photon constancy', 'Photon constancy'), true);
check('group photon case', isGroupLabel('photon  constancy', 'Photon constancy'), true);
check('group rejects ICP photon', isGroupLabel('Photon constancy with quad wedges (ICP)', 'Photon constancy'), false);
check('group rejects ICP electron', isGroupLabel('Electron constancy with quad wedges (ICP)', 'Electron constancy'), false);
check('group electron', isGroupLabel('Electron constancy', 'Electron constancy'), true);
check('isIcp', isIcpLabel('Photon constancy with quad wedges (ICP)'), true);
check('not icp', isIcpLabel('Photon constancy'), false);

check('energy 6 MV exact', energyLabelMatches('6 MV', '6 MV'), true);
check('energy 6 MV vs 6 FFF', energyLabelMatches('6 FFF', '6 MV'), false);
check('energy 6 MV vs 16', energyLabelMatches('16 MV', '6 MV'), false);
check('energy 10 FFF', energyLabelMatches('10 FFF', '10 FFF'), true);
check('energy 6 MeV exact', energyLabelMatches('6 MeV', '6 MeV'), true);
check('energy bare 6 for MeV', energyLabelMatches('6', '6 MeV'), true);
check('energy bare 16 for 16 MeV', energyLabelMatches('16', '16 MeV'), true);
check('energy bare 6 does not match 16 MeV', energyLabelMatches('6', '16 MeV'), false);
check('energy 16 MeV does not match 6 MeV', energyLabelMatches('16 MeV', '6 MeV'), false);
check('energy ICP tab ignored', energyLabelMatches('6 MV ICP', '6 MV'), false);

check('temp label', temperatureLabelMatches('Temperature'), true);
check('temp label unit', temperatureLabelMatches('Temperature (C)'), true);
check('temp not room sentence', temperatureLabelMatches('Room Temperature coefficient'), false);
check('press label', pressureLabelMatches('Pressure'), true);
check('press label units', pressureLabelMatches('Pressure (kPa or mmHg)'), true);
check('press not other', pressureLabelMatches('Pressure coefficient'), false);

check('attr temperature', kindFromAttrs('temperature'), 'temperature');
check('attr aria Temperature', kindFromAttrs('Temperature'), 'temperature');
check('attr pressure name', kindFromAttrs('pressureKpa'), 'pressure');
check('attr ptp excluded', kindFromAttrs('ptp'), 'ptp');
check('attr empty', kindFromAttrs(''), null);
check('near temp label', kindFromNearby(['Temperature'], ['C']), 'temperature');
check('near press label', kindFromNearby(['Pressure (kPa or mmHg)'], ['kPa/mmHg']), 'pressure');
check('near unit only kPa', kindFromNearby(['Setup'], ['kPa/mmHg']), 'pressure');

check('forbid Pass All', isForbiddenClickText('Pass All'), true);
check('forbid Submit', isForbiddenClickText('Submit'), true);
check('forbid Complete', isForbiddenClickText('Complete'), true);
check('forbid Approve', isForbiddenClickText('Approve'), true);
check('forbid Delete', isForbiddenClickText('Delete'), true);
check('forbid Save', isForbiddenClickText('Save'), true);
check('allow Photon constancy', isForbiddenClickText('Photon constancy'), false);
check('allow 6 MV', isForbiddenClickText('6 MV'), false);

check('gate header HDR_Peace', pageHasPeace('Daily | 12 NOV 2026 | HDR_Peace', ''), true);
check('gate body fallback', pageHasPeace('', 'Machine: Peace'), true);
check('gate case', pageHasPeace('PEACE', ''), true);
check('gate absent', pageHasPeace('Daily | Other Machine', 'Safety Checks'), false);
check('gate not Bravos', pageHasPeace('Daily | HDR_Bravos', 'HDR Daily'), false);

const src = fs.readFileSync(path.join(__dirname, '..', 'suncheck-tp-fill.user.js'), 'utf8');
check('script @version 1.1', /@version\s+1\.1\b/.test(src), true);
check('script SCRIPT_VERSION', /const SCRIPT_VERSION = '1\.1'/.test(src), true);
check('script name TP Fill', /@name\s+TP Fill/.test(src), true);
check('script gate Peace', /const GATE_RE = \/peace\/i/.test(src), true);
check('script 10 targets', (src.match(/group: 'Photon constancy'/g) || []).length === 5 && (src.match(/group: 'Electron constancy'/g) || []).length === 5, true);
check('script excludes ICP', /quad\\s\*wedges\?\|\\bICP\\b/.test(src), true);
check('script same host http', src.includes('@match        http://cnrrtrocperfx.rrt.ca.kp.org/*'), true);
check('script same host https', src.includes('@match        https://cnrrtrocperfx.rrt.ca.kp.org/*'), true);
check('script updateURL raw main', src.includes('https://raw.githubusercontent.com/mobility22/SunCHECK-TP-Fill/refs/heads/main/suncheck-tp-fill.user.js'), true);
check('helpers in script: parsePaste', src.includes('function parsePaste'), true);
check('helpers in script: energyLabelMatches', src.includes('function energyLabelMatches'), true);
check('helpers in script: pageHasPeace', src.includes('function pageHasPeace'), true);
check('PHI-free log: no innerText dump in log()', /log\([^)]*innerText/.test(src), false);
check('failure reason template', src.includes('no temperature input (') && src.includes(' inputs scanned)'), true);
check('debug counts only', src.includes('debug input scan') && src.includes('inputsScanned'), true);

const goTo = src.indexOf('async function goToTarget');
const treeCall = src.indexOf('findEnergyTreeRow', goTo);
const tabCall = src.indexOf('findEnergyTab', goTo);
check('tree row nav is primary (before tab fallback)', goTo !== -1 && treeCall !== -1 && tabCall !== -1 && treeCall < tabCall, true);

function loadJsdom() {
  const tries = ['jsdom', '/tmp/jsdom-root/node_modules/jsdom', path.join(__dirname, '../node_modules/jsdom')];
  for (const p of tries) {
    try { return require(p); } catch (e) { /* next */ }
  }
  return null;
}

const jsdom = loadJsdom();
if (!jsdom) {
  console.log('SKIP DOM fixture tests (jsdom not installed)');
} else {
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

  const target6 = { group: 'Photon constancy', energy: '6 MV' };

  // Sibling text labels + unit suffixes, no Environmentals heading, no <label for>
  {
    const { api } = loadApi(`
      <div class="content">
        <div class="head">Dosimetry - Photon constancy <span>6 MV</span></div>
        <div class="row"><div>Temperature</div><input id="t1" type="text"><span>C</span></div>
        <div class="row"><div>Pressure (kPa or mmHg)</div><input id="p1" type="text"><span>kPa/mmHg</span></div>
        <div class="row"><div>PTP</div><input id="ptp1" type="text" readonly value="1.00"></div>
      </div>`);
    const found = api.findTempAndPressure(target6);
    check('dom sibling labels: temp', found.temperature && found.temperature.id, 't1');
    check('dom sibling labels: press', found.pressure && found.pressure.id, 'p1');
    check('dom sibling labels: not ptp', found.temperature && found.temperature.id !== 'ptp1' && found.pressure.id !== 'ptp1', true);
  }

  // aria-label / placeholder / formcontrolname
  {
    const { api } = loadApi(`
      <div class="content">
        <div>Dosimetry - Photon constancy</div><div>6 MV</div>
        <input id="t2" aria-label="Temperature" type="text">
        <input id="p2" placeholder="Pressure (kPa or mmHg)" type="text">
      </div>`);
    const found = api.findTempAndPressure(target6);
    check('dom aria/placeholder: temp', found.temperature && found.temperature.id, 't2');
    check('dom aria/placeholder: press', found.pressure && found.pressure.id, 'p2');
  }
  {
    const { api } = loadApi(`
      <div class="content">
        <h3>Dosimetry - Photon constancy 6 MV</h3>
        <input id="t3" name="temperature" type="text">
        <input id="p3" formcontrolname="pressure" type="text">
      </div>`);
    const found = api.findTempAndPressure(target6);
    check('dom name/formcontrolname: temp', found.temperature && found.temperature.id, 't3');
    check('dom name/formcontrolname: press', found.pressure && found.pressure.id, 'p3');
  }

  // Exclude our panel inputs and PTP / disabled
  {
    const { api } = loadApi(`
      <div id="suncheck-tp-panel">
        <input class="sc-tp-temp" id="panel-t" aria-label="Temperature" type="text">
        <input class="sc-tp-press" id="panel-p" aria-label="Pressure" type="text">
      </div>
      <div class="content">
        <div>Dosimetry - Photon constancy 6 MV</div>
        <input id="t4" aria-label="Temperature" type="text">
        <input id="p4" aria-label="Pressure" type="text">
        <input id="bad" aria-label="Temperature" type="text" disabled>
        <input id="ptp2" aria-label="PTP" type="text">
      </div>`);
    const found = api.findTempAndPressure(target6);
    check('dom excludes panel temp', found.temperature && found.temperature.id, 't4');
    check('dom excludes panel press', found.pressure && found.pressure.id, 'p4');
  }

  // Two energy sections: pick the 6 MV pair, not 10 MV
  {
    const { api } = loadApi(`
      <div class="content">
        <section>
          <div class="h">Dosimetry - Photon constancy <b>10 MV</b></div>
          <div>Temperature</div><input id="t-10" type="text"><span>C</span>
          <div>Pressure (kPa or mmHg)</div><input id="p-10" type="text"><span>kPa/mmHg</span>
        </section>
        <section>
          <div class="h">Dosimetry - Photon constancy <b>6 MV</b></div>
          <div>Temperature</div><input id="t-6" type="text"><span>C</span>
          <div>Pressure (kPa or mmHg)</div><input id="p-6" type="text"><span>kPa/mmHg</span>
        </section>
      </div>`);
    const found = api.findTempAndPressure(target6);
    check('dom scopes to 6 MV temp', found.temperature && found.temperature.id, 't-6');
    check('dom scopes to 6 MV press', found.pressure && found.pressure.id, 'p-6');
  }

  // Left-tree energy row preferred; ICP group row ignored
  {
    const { api, document } = loadApi(`
      <nav class="tree">
        <div>
          <div>Photon constancy</div>
          <div class="child">6 MV</div>
          <div class="child">10 MV</div>
        </div>
        <div>
          <div>Photon constancy with quad wedges (ICP)</div>
          <div class="child">6 MV</div>
        </div>
      </nav>
      <main>
        <div role="tablist"><button>6 MV</button></div>
      </main>`);
    const row = api.findEnergyTreeRow('6 MV', 'Photon constancy');
    check('tree row found under Photon constancy', !!(row && row.className === 'child' && row.textContent.trim() === '6 MV' && row.closest('.tree')), true);
    check('tree row is not the ICP child', !!(row && !/ICP/.test(row.parentElement.innerText) || (row && row.parentElement.querySelector('div') && row.parentElement.querySelector('div').textContent.trim() === 'Photon constancy')), true);
    const tab = api.findEnergyTab('6 MV');
    check('tab fallback still finds a tab', !!(tab && tab.closest('main')), true);
  }
}

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('all tests passed');
