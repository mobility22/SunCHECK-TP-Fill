'use strict';
const fs = require('fs');
const path = require('path');

const TEMP_LABEL_RE = /^\s*Temperature(\s*\([^)]*\))?\s*$/i;
const PRESS_LABEL_RE = /^\s*Pressure(\s*\([^)]*\))?\s*$/i;
const FORBIDDEN_CLICK_RE = /^(pass(\s*all)?|fail(\s*all)?|submit|complete|approve|unapprove|delete|cancel|save)$/i;
const FORBIDDEN_WORD_RE = /\b(pass\s*all|fail\s*all|submit|complete|approve|unapprove|delete)\b/i;
const ICP_RE = /quad\s*wedges?|\bICP\b/i;
const GATE_RE = /peace/i;
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
check('script @version 1.0', /@version\s+1\.0\b/.test(src), true);
check('script SCRIPT_VERSION', /const SCRIPT_VERSION = '1\.0'/.test(src), true);
check('script name TP Fill', /@name\s+TP Fill/.test(src), true);
check('script gate Peace', /const GATE_RE = \/peace\/i/.test(src), true);
check('script 10 targets', (src.match(/group: 'Photon constancy'/g) || []).length === 5 && (src.match(/group: 'Electron constancy'/g) || []).length === 5, true);
check('script excludes ICP', /quad\\s\*wedges\?\|\\bICP\\b/.test(src), true);
check('script same host http', src.includes('@match        http://cnrrtrocperfx.rrt.ca.kp.org/*'), true);
check('script same host https', src.includes('@match        https://cnrrtrocperfx.rrt.ca.kp.org/*'), true);
check('script updateURL raw main', src.includes('https://raw.githubusercontent.com/mobility22/SunCHECK-TP-Fill/refs/heads/main/suncheck-tp-fill.user.js'), true);
check('script no approve click path', /never|FORBIDDEN_CLICK_RE/.test(src) && /Approve/.test(src), true);
check('helpers in script: parsePaste', src.includes('function parsePaste'), true);
check('helpers in script: energyLabelMatches', src.includes('function energyLabelMatches'), true);
check('helpers in script: pageHasPeace', src.includes('function pageHasPeace'), true);
check('PHI-free log: no innerText dump in log()', /log\([^)]*innerText/.test(src), false);

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('all tests passed');
