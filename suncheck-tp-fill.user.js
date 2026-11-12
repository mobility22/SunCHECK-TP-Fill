// ==UserScript==
// @name         TP Fill
// @namespace    https://github.com/mobility22/SunCHECK-TP-Fill
// @version      1.4
// @description  Fill SunCHECK Peace temperature and pressure on Photon/Electron constancy (never Approve/Submit)
// @match        http://cnrrtrocperfx.rrt.ca.kp.org/*
// @match        https://cnrrtrocperfx.rrt.ca.kp.org/*
// @updateURL    https://raw.githubusercontent.com/mobility22/SunCHECK-TP-Fill/refs/heads/main/suncheck-tp-fill.user.js
// @downloadURL  https://raw.githubusercontent.com/mobility22/SunCHECK-TP-Fill/refs/heads/main/suncheck-tp-fill.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  const TAG = '[TP Fill]';
  const SCRIPT_VERSION = '1.4';
  const log = (...a) => console.log(TAG, ...a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const GATE_RE = /peace/i;
  const GATE_TIMEOUT_MS = 30000;
  const EXPECTED_COUNT = 10;
  const STABLE_MS = 300;
  const NAV_WAIT_MS = 8000;
  const HEADER_SEL = 'header,[role="banner"],[class*="title" i],[class*="header" i],[class*="toolbar" i],[class*="navbar" i],[class*="appbar" i],[class*="app-bar" i],[class*="topbar" i],[class*="top-bar" i],h1,h2';
  const STORE_KEY = 'suncheck-tp-fill-v1';
  const BTN_ID = 'suncheck-tp-btn';
  const PANEL_ID = 'suncheck-tp-panel';
  const TEMP_LABEL_RE = /^\s*Temperature(\s*\([^)]*\))?\s*$/i;
  const PRESS_LABEL_RE = /^\s*Pressure(\s*\([^)]*\))?\s*$/i;
  const TEMP_WORD_RE = /\btemperature\b/i;
  const PRESS_WORD_RE = /\bpressure\b/i;
  const PTP_RE = /\bptp\b/i;
  const UNIT_C_RE = /^°?C$/i;
  const UNIT_PRESS_RE = /kPa|mmHg/i;
  const ATTR_KEYS = ['aria-label', 'placeholder', 'title', 'name', 'id', 'formcontrolname', 'formControlName', 'ng-reflect-name', 'ng-reflect-form-control-name'];
  const FORBIDDEN_CLICK_RE = /^(pass(\s*all)?|fail(\s*all)?|submit|complete|approve|unapprove|delete|cancel|save)$/i;
  const FORBIDDEN_WORD_RE = /\b(pass\s*all|fail\s*all|submit|complete|approve|unapprove|delete)\b/i;
  const ICP_RE = /quad\s*wedges?|\bICP\b/i;
  const TREE_SEL = 'nav,aside,[class*="tree"],[class*="sidebar"],[class*="menu"],[class*="nav"],[role="tree"]';
  const CLICKABLE_SEL = 'a,button,[role="treeitem"],[role="tab"],[role="button"],li,span,div,label';
  const SKIP_INPUT_TYPES = /^(button|submit|reset|checkbox|radio|file|hidden|image|color|range)$/i;

  const TARGETS = [
    { group: 'Photon constancy', energy: '6 MV' },
    { group: 'Photon constancy', energy: '10 MV' },
    { group: 'Photon constancy', energy: '15 MV' },
    { group: 'Photon constancy', energy: '6 FFF' },
    { group: 'Photon constancy', energy: '10 FFF' },
    { group: 'Electron constancy', energy: '6 MeV' },
    { group: 'Electron constancy', energy: '9 MeV' },
    { group: 'Electron constancy', energy: '12 MeV' },
    { group: 'Electron constancy', energy: '16 MeV' },
    { group: 'Electron constancy', energy: '20 MeV' }
  ];

  const isExec = () => location.hash.includes('#/Routine/Execution');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
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
  function energyLabelMatches(text, energy) {
    const a = norm(text), b = norm(energy);
    if (!a || isIcpLabel(a)) return false;
    if (new RegExp('^' + b.replace(/\s+/g, '\\s*') + '$', 'i').test(a)) return true;
    const m = /^(\d+(?:\.\d+)?)\s*MeV$/i.exec(b);
    return !!(m && new RegExp('^' + m[1] + '$').test(a));
  }
  function energyInText(text, energy) {
    const a = norm(text), b = norm(energy);
    if (!a || !b) return false;
    if (new RegExp('(^|[^A-Za-z0-9])' + b.replace(/\s+/g, '\\s*') + '([^A-Za-z0-9]|$)', 'i').test(a)) return true;
    const m = /^(\d+(?:\.\d+)?)\s*MeV$/i.exec(b);
    return !!(m && new RegExp('(^|[^0-9])' + m[1] + '([^0-9]|$)').test(a) && /MeV/i.test(a));
  }
  function temperatureLabelMatches(text) { return TEMP_LABEL_RE.test(norm(text)); }
  function pressureLabelMatches(text) { return PRESS_LABEL_RE.test(norm(text)); }
  function isForbiddenClickText(text) {
    const t = norm(text);
    return !t ? false : (FORBIDDEN_CLICK_RE.test(t) || FORBIDDEN_WORD_RE.test(t));
  }
  function groupKind(groupName) { return /photon/i.test(groupName) ? 'Photon' : 'Electron'; }

  function headerHasPeace() {
    try {
      const nodes = document.querySelectorAll(HEADER_SEL);
      for (const el of nodes) {
        if (GATE_RE.test(el.innerText || el.textContent || '')) return true;
      }
    } catch (e) { /* selector not supported; fall through to body text */ }
    return false;
  }
  function pageHasPeace() {
    if (headerHasPeace()) return true;
    const t = (document.body && (document.body.innerText || document.body.textContent)) || '';
    return GATE_RE.test(t);
  }

  function setVal(input, v) {
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  let panelShadow = null;
  function panelRoot() { return panelShadow; }
  function ourUi(el) {
    if (!el) return false;
    if (el.closest && el.closest('#' + PANEL_ID + ',#' + BTN_ID)) return true;
    if (panelShadow && (el === panelShadow.host || panelShadow.contains(el))) return true;
    return false;
  }
  function vis(el) {
    if (!el || ourUi(el) || el.hidden) return false;
    if (el.offsetParent !== null) return true;
    try {
      const st = el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.getComputedStyle(el);
      if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
      if (st && st.position === 'fixed' && st.display !== 'none') return true;
    } catch (e) { /* ignore */ }
    return false;
  }
  function isPresentInDom(el) {
    if (!el || ourUi(el) || el.hidden) return false;
    try {
      const st = el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.getComputedStyle(el);
      if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
    } catch (e) { /* ignore */ }
    return el.isConnected !== false;
  }
  function ownLabel(el) {
    if (!el || ourUi(el)) return '';
    const aria = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '';
    if (aria.trim()) return aria.trim();
    const texts = [];
    for (const n of el.childNodes) {
      if (n.nodeType === 3) {
        const t = (n.textContent || '').trim();
        if (t) texts.push(t);
      } else if (n.nodeType === 1 && n.children.length === 0) {
        const t = norm(n.innerText || n.textContent || '');
        if (t && t.length < 80) texts.push(t);
      }
    }
    if (texts.length) return texts[0];
    if (el.children && el.children.length > 1) return '';
    const t = norm(el.innerText || el.textContent || '');
    if (!t) return '';
    return t.split('\n')[0].trim();
  }

  function attrMap(el) {
    const out = {};
    for (const k of ATTR_KEYS) {
      const v = el.getAttribute && el.getAttribute(k);
      if (v) out[k] = v;
    }
    return out;
  }
  function attrBlob(el) { return norm(Object.values(attrMap(el)).join(' ')); }
  function isPtpInput(el, nearbyTexts) {
    if (PTP_RE.test(attrBlob(el))) return true;
    return (nearbyTexts || []).some(t => /^PTP$/i.test(norm(t)));
  }
  function isUnitToken(t) {
    const s = norm(t);
    return !!(s && (UNIT_C_RE.test(s) || UNIT_PRESS_RE.test(s) && s.length <= 16));
  }
  function isInputish(node) {
    if (!node || node.nodeType !== 1) return false;
    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return true;
    return !!(node.querySelector && node.querySelector('input,textarea'));
  }
  function firstLineOf(el) {
    if (!el || el.nodeType !== 1) return '';
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return '';
    return norm((el.innerText || el.textContent || '').split('\n')[0]);
  }
  function isFieldLabel(t) {
    const s = norm(t);
    if (!s || s.length > 80) return false;
    return temperatureLabelMatches(s) || pressureLabelMatches(s) || /^PTP$/i.test(s) ||
      (TEMP_WORD_RE.test(s) && !PRESS_WORD_RE.test(s)) ||
      (PRESS_WORD_RE.test(s) && !TEMP_WORD_RE.test(s));
  }
  function collectNearby(el) {
    const texts = [];
    const units = [];
    const add = raw => {
      const t = norm(raw);
      if (!t || t.length > 80) return;
      if (isUnitToken(t)) units.push(t);
      texts.push(t);
    };
    if (el.id) {
      try {
        const esc = (window.CSS && CSS.escape) ? CSS.escape(el.id) : el.id.replace(/"/g, '');
        const lab = el.ownerDocument.querySelector('label[for="' + esc + '"]');
        if (lab && !ourUi(lab)) add(lab.innerText || lab.textContent);
      } catch (e) { /* ignore */ }
    }
    if (el.labels) for (const lab of el.labels) if (!ourUi(lab)) add(lab.innerText || lab.textContent);
    const prev = [];
    let sib = el.previousElementSibling;
    while (sib) {
      if (isInputish(sib)) break;
      prev.push(sib);
      sib = sib.previousElementSibling;
    }
    for (const s of prev) {
      const t = firstLineOf(s);
      add(t);
      if (isFieldLabel(t)) break;
    }
    sib = el.nextElementSibling;
    while (sib) {
      if (isInputish(sib)) break;
      const t = firstLineOf(sib);
      if (isFieldLabel(t) && !isUnitToken(t)) break;
      add(t);
      sib = sib.nextElementSibling;
    }
    if (texts.some(isFieldLabel)) return { texts, units };
    let n = el;
    for (let i = 0; i < 4 && n && n !== document.body && !ourUi(n); i++) {
      const p = n.parentElement;
      if (!p || ourUi(p)) break;
      const pTag = (p.tagName || '').toLowerCase();
      if (pTag === 'script' || pTag === 'style' || pTag === 'html') break;
      for (const child of p.childNodes) {
        if (child === n) continue;
        if (child.nodeType === 3) add(child.textContent);
        else if (child.nodeType === 1 && child.children.length === 0 && !isInputish(child)) {
          const tag = (child.tagName || '').toLowerCase();
          if (tag !== 'script' && tag !== 'style') add(child.innerText || child.textContent);
        }
      }
      if (texts.some(isFieldLabel)) break;
      if (p.querySelectorAll('input,textarea').length > 2) break;
      n = p;
    }
    return { texts, units };
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
  function classifyInput(el) {
    const nearby = collectNearby(el);
    if (isPtpInput(el, nearby.texts)) return { kind: 'ptp', nearby };
    const fromAttr = kindFromAttrs(attrBlob(el));
    if (fromAttr === 'ptp') return { kind: 'ptp', nearby };
    if (fromAttr) return { kind: fromAttr, nearby, via: 'attr' };
    const fromNear = kindFromNearby(nearby.texts, nearby.units);
    if (fromNear) return { kind: fromNear, nearby, via: 'near' };
    return { kind: null, nearby };
  }
  function isEditableInput(el) {
    if (!el || ourUi(el)) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return false;
    if (el.disabled || el.readOnly) return false;
    if (SKIP_INPUT_TYPES.test(el.type || '')) return false;
    return true;
  }

  function findAllClassifiedInputs() {
    const temps = [];
    const presses = [];
    const debug = {
      inputsScanned: 0,
      editable: 0,
      readonlyOrDisabled: 0,
      excludedUi: 0,
      excludedPtp: 0,
      hiddenType: 0,
      tempFound: 0,
      pressFound: 0
    };
    const list = [...document.querySelectorAll('input,textarea')];
    debug.inputsScanned = list.length;
    for (const el of list) {
      if (ourUi(el)) { debug.excludedUi++; continue; }
      const typ = (el.type || '').toLowerCase();
      if (SKIP_INPUT_TYPES.test(typ)) { debug.hiddenType++; continue; }
      if (el.disabled || el.readOnly) { debug.readonlyOrDisabled++; continue; }
      if (!isPresentInDom(el) || !isEditableInput(el)) continue;
      debug.editable++;
      const cls = classifyInput(el);
      if (cls.kind === 'ptp') { debug.excludedPtp++; continue; }
      if (cls.kind === 'temperature') { temps.push(el); debug.tempFound++; }
      if (cls.kind === 'pressure') { presses.push(el); debug.pressFound++; }
    }
    return { temps, presses, debug };
  }
  function logInputDebug(debug, extra) {
    log('debug input scan',
      'scanned=' + debug.inputsScanned,
      'editable=' + debug.editable,
      'readonlyOrDisabled=' + debug.readonlyOrDisabled,
      'excludedUi=' + debug.excludedUi,
      'excludedPtp=' + debug.excludedPtp,
      'hiddenType=' + debug.hiddenType,
      'tempFound=' + debug.tempFound,
      'pressFound=' + debug.pressFound,
      extra || ''
    );
  }

  async function setAndVerify(inp, value) {
    if (!inp) return false;
    if (valuesEqual(inp.value, value)) return true;
    inp.focus();
    setVal(inp, value);
    await sleep(200);
    if (valuesEqual(inp.value, value)) return true;
    inp.focus();
    setVal(inp, value);
    await sleep(200);
    return valuesEqual(inp.value, value);
  }
  async function fillInputs(list, value) {
    let ok = 0;
    for (const inp of list) {
      if (await setAndVerify(inp, value)) ok++;
    }
    return ok;
  }
  function formatSummary(tOk, tN, pOk, pN) {
    let msg = 'Temperature: ' + tOk + ' of ' + tN + ' filled, Pressure: ' + pOk + ' of ' + pN + ' filled';
    const short = tN < EXPECTED_COUNT || pN < EXPECTED_COUNT;
    const extra = tN > EXPECTED_COUNT || pN > EXPECTED_COUNT;
    if (short) {
      msg += '. Only ' + tN + ' temperature / ' + pN + ' pressure found — scroll to the bottom and press Fill again';
    } else if (extra) {
      msg += '. Note: found ' + tN + ' temperature and ' + pN + ' pressure boxes (expected ' + EXPECTED_COUNT + ')';
    } else if (tN !== EXPECTED_COUNT || pN !== EXPECTED_COUNT) {
      msg += '. Warning: expected ' + EXPECTED_COUNT + ' of each';
    }
    return msg;
  }

  // --- Fallback only: click left-tree energy rows if fewer than 10 are in the DOM ---
  function candidates(root, sel) {
    return [...(root || document).querySelectorAll(sel || CLICKABLE_SEL)].filter(el => vis(el) && !ourUi(el));
  }
  function treeRoots() {
    const nodes = [...document.querySelectorAll(TREE_SEL)].filter(el => vis(el) && !ourUi(el));
    return nodes.length ? nodes : [];
  }
  function pickShortest(hits) {
    hits.sort((a, b) => {
      const la = ownLabel(a).length, lb = ownLabel(b).length;
      if (la !== lb) return la - lb;
      return (a.textContent || '').length - (b.textContent || '').length;
    });
    return hits[0] || null;
  }
  function isUnderIcp(el) {
    let n = el;
    for (let i = 0; i < 16 && n && n !== document.body; i++, n = n.parentElement) {
      if (isIcpLabel(ownLabel(n))) return true;
    }
    return false;
  }
  function nearestGroupName(el) {
    let n = el;
    for (let i = 0; i < 16 && n && n !== document.body; i++, n = n.parentElement) {
      const lab = ownLabel(n);
      if (isIcpLabel(lab)) return null;
      if (isGroupLabel(lab, 'Photon constancy')) return 'Photon constancy';
      if (isGroupLabel(lab, 'Electron constancy')) return 'Electron constancy';
    }
    return null;
  }
  function findGroupItem(groupName) {
    const hits = [];
    const roots = treeRoots();
    for (const root of (roots.length ? roots : [document.body])) {
      for (const el of candidates(root)) {
        if (isGroupLabel(ownLabel(el), groupName)) hits.push(el);
      }
    }
    return pickShortest(hits);
  }
  function findEnergyTreeRows(energy, groupName) {
    const groupEl = findGroupItem(groupName);
    const hits = [];
    const seen = new Set();
    const roots = [];
    if (groupEl) {
      roots.push(groupEl);
      if (groupEl.parentElement) roots.push(groupEl.parentElement);
    }
    roots.push(...treeRoots());
    for (const root of roots) {
      if (!root) continue;
      for (const el of candidates(root)) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (!energyLabelMatches(ownLabel(el), energy)) continue;
        if (isUnderIcp(el)) continue;
        const g = nearestGroupName(el);
        if (g && g !== groupName) continue;
        if (!g && groupEl && !(groupEl.contains(el) || (groupEl.parentElement && groupEl.parentElement.contains(el)))) continue;
        hits.push(el);
      }
    }
    if (hits.length) pickShortest(hits);
    return hits;
  }
  function mainRoot() {
    const main = document.querySelector('main,[role="main"],[class*="content"],[class*="detail"],[class*="workspace"]');
    if (main && isPresentInDom(main) && !ourUi(main)) return main;
    return document.body;
  }
  function dosimetryRe(groupName) {
    return new RegExp('Dosimetry\\s*[-–—]\\s*' + groupKind(groupName) + '\\s*constancy', 'i');
  }
  function knownEnergies(groupName) {
    return groupKind(groupName) === 'Photon'
      ? ['10 FFF', '6 FFF', '15 MV', '10 MV', '6 MV']
      : ['20 MeV', '16 MeV', '12 MeV', '9 MeV', '6 MeV'];
  }
  function extractEnergyFromText(text, groupName) {
    const a = norm(text);
    if (!a) return '';
    for (const e of knownEnergies(groupName)) {
      if (energyInText(a, e) || energyLabelMatches(a, e)) return e;
    }
    return '';
  }
  function readPaneEnergy(groupName) {
    const re = dosimetryRe(groupName);
    const headers = [...document.querySelectorAll('h1,h2,h3,h4,h5,div,span,a,p,strong,b,legend')].filter(el => {
      if (!isPresentInDom(el) || ourUi(el) || (el.closest && el.closest(TREE_SEL))) return false;
      const t = norm((el.innerText || el.textContent || '').split('\n')[0]);
      return t.length < 120 && re.test(t);
    });
    for (const h of headers) {
      const bits = [norm((h.innerText || h.textContent || '').split('\n').slice(0, 4).join(' '))];
      const kids = h.parentElement ? [...h.parentElement.children] : [];
      for (const sib of kids) {
        const t = norm((sib.innerText || sib.textContent || '').split('\n')[0]);
        if (t && t.length < 40) bits.push(t);
      }
      try {
        for (const child of h.querySelectorAll('span,div,b,strong,em,p')) {
          const t = norm((child.innerText || child.textContent || '').split('\n')[0]);
          if (t && t.length < 24) bits.push(t);
        }
      } catch (e) { /* ignore */ }
      const found = extractEnergyFromText(bits.join(' | '), groupName);
      if (found) return found;
    }
    return '';
  }
  function paneShowsEnergy(target) {
    const e = readPaneEnergy(target.group);
    return !!(e && energyLabelMatches(e, target.energy));
  }
  function paneScrollTop() {
    const pane = mainRoot();
    if (!pane) return 0;
    if (typeof pane.scrollTop === 'number' && pane.scrollHeight > pane.clientHeight + 4) return pane.scrollTop;
    const win = pane.ownerDocument && pane.ownerDocument.defaultView;
    if (win && win.scrollY != null) return win.scrollY;
    return 0;
  }
  function layoutSignature(target) {
    const parts = [readPaneEnergy(target.group) || '', 's' + Math.round(paneScrollTop())];
    const found = findAllClassifiedInputs();
    const el = found.temps[found.temps.length - 1] || found.presses[found.presses.length - 1];
    if (el) {
      try {
        const r = el.getBoundingClientRect();
        parts.push([Math.round(r.top), Math.round(r.left), found.temps.length, found.presses.length].join(','));
      } catch (e) { parts.push('x'); }
    } else {
      parts.push(found.temps.length + ',' + found.presses.length);
    }
    return parts.join('|');
  }
  function dispatchPointerClick(el) {
    const doc = el.ownerDocument || document;
    const win = doc.defaultView || window;
    let x = 0, y = 0;
    try {
      const r = el.getBoundingClientRect();
      x = r.left + (r.width || 1) / 2;
      y = r.top + (r.height || 1) / 2;
    } catch (e) { /* ignore */ }
    const base = { bubbles: true, cancelable: true, view: win, button: 0, buttons: 1, clientX: x, clientY: y, screenX: x, screenY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    const fire = (type, kind) => {
      try {
        if (kind === 'pointer' && win.PointerEvent) el.dispatchEvent(new win.PointerEvent(type, base));
        else if (kind === 'mouse' && (win.MouseEvent || win.Event)) el.dispatchEvent(new (win.MouseEvent || win.Event)(type, base));
        else el.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: true }));
      } catch (err) {
        try { el.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: true })); } catch (e2) { /* ignore */ }
      }
    };
    fire('pointerdown', 'pointer');
    fire('mousedown', 'mouse');
    fire('pointerup', 'pointer');
    fire('mouseup', 'mouse');
    fire('click', 'mouse');
    try { if (typeof el.click === 'function') el.click(); } catch (e) { /* ignore */ }
  }
  function clickableChain(el, energy) {
    const chain = [];
    const add = n => { if (n && !ourUi(n) && !chain.includes(n)) chain.push(n); };
    if (!el) return chain;
    try {
      for (const n of el.querySelectorAll('a,button,[role="treeitem"],[role="tab"],[role="button"]')) add(n);
      for (const n of el.querySelectorAll('span,div,label,p,b,strong,i')) {
        const lab = ownLabel(n) || norm(n.textContent || '').split('\n')[0];
        if (energy && (energyLabelMatches(lab, energy) || energyLabelMatches(ownLabel(n), energy))) add(n);
      }
    } catch (e) { /* ignore */ }
    add(el);
    let p = el.parentElement;
    for (let i = 0; i < 3 && p && p !== document.body; i++, p = p.parentElement) {
      const role = (p.getAttribute && p.getAttribute('role')) || '';
      const tag = p.tagName || '';
      if (role === 'treeitem' || role === 'option' || role === 'tab' || tag === 'A' || tag === 'BUTTON' || tag === 'LI') add(p);
    }
    return chain;
  }
  function canActivate(el) {
    if (!el || ourUi(el)) return false;
    const t = norm(el.innerText || el.value || (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '');
    if (isForbiddenClickText(t)) return false;
    return true;
  }
  function safeActivate(el, what, energy) {
    const targets = clickableChain(el, energy);
    if (!targets.length && el) targets.push(el);
    for (const node of targets) {
      if (!canActivate(node)) {
        if (node && isForbiddenClickText(norm(node.innerText || ''))) log('REFUSED to click', what || 'forbidden');
        continue;
      }
      dispatchPointerClick(node);
      log('clicked', what || 'item');
      return true;
    }
    log('REFUSED to click: missing', what || '');
    return false;
  }
  async function waitFor(pred, timeout, interval) {
    const t0 = Date.now();
    const ms = timeout || 8000, step = interval || 200;
    while (Date.now() - t0 < ms) {
      if (aborted) return null;
      const v = pred();
      if (v) return v;
      await sleep(step);
    }
    return pred() || null;
  }
  async function waitForPaneSettled(target, timeout) {
    const t0 = Date.now();
    const ms = timeout == null ? NAV_WAIT_MS : timeout;
    let lastSig = null;
    let stableSince = null;
    while (Date.now() - t0 < ms) {
      if (aborted) break;
      const energyOk = !target || paneShowsEnergy(target);
      const sig = layoutSignature(target || TARGETS[0]);
      const found = findAllClassifiedInputs();
      const hasSome = found.temps.length + found.presses.length > 0;
      if (energyOk && hasSome) {
        if (sig === lastSig) {
          if (stableSince == null) stableSince = Date.now();
          if (Date.now() - stableSince >= STABLE_MS) return found;
        } else {
          lastSig = sig;
          stableSince = Date.now();
        }
      } else {
        lastSig = sig;
        stableSince = null;
      }
      await sleep(100);
    }
    return findAllClassifiedInputs();
  }

  let automationEnabled = false;
  let buttonTickId = null;
  let gateDebounce = null;
  let timeoutLogged = false;
  let filling = false;
  let aborted = false;

  function setStatus(text, kind) {
    const root = panelRoot();
    const el = root && root.getElementById ? root.getElementById('suncheck-tp-status') : null;
    if (!el) return;
    el.textContent = text;
    el.style.color = kind === 'error' ? '#b71c1c' : kind === 'ok' ? '#1b5e20' : '#111';
  }

  async function revealByTreeClicks(tVal, pVal) {
    log('fewer than', EXPECTED_COUNT, 'found — tree-row fallback to reveal sections');
    for (const target of TARGETS) {
      if (aborted) break;
      let rows = findEnergyTreeRows(target.energy, target.group);
      if (!rows.length) {
        const groupEl = findGroupItem(target.group);
        if (groupEl && safeActivate(groupEl, target.group, null)) {
          await sleep(400);
          rows = (await waitFor(() => {
            const list = findEnergyTreeRows(target.energy, target.group);
            return list.length ? list : null;
          }, 3000)) || [];
        }
      }
      if (rows[0]) safeActivate(rows[0], 'tree ' + target.energy, target.energy);
      await waitForPaneSettled(target, 2500);
      const found = findAllClassifiedInputs();
      const tNeed = found.temps.filter(el => !valuesEqual(el.value, tVal));
      const pNeed = found.presses.filter(el => !valuesEqual(el.value, pVal));
      if (tNeed.length) await fillInputs(tNeed, tVal);
      if (pNeed.length) await fillInputs(pNeed, pVal);
      const after = findAllClassifiedInputs();
      if (after.temps.length >= EXPECTED_COUNT && after.presses.length >= EXPECTED_COUNT &&
          after.temps.every(el => valuesEqual(el.value, tVal)) &&
          after.presses.every(el => valuesEqual(el.value, pVal))) {
        break;
      }
    }
  }

  async function runFill(temperature, pressure) {
    if (filling) { log('fill already running'); return; }
    if (!pageHasPeace()) { setStatus('Not a Peace page.', 'error'); log('not a Peace page'); return; }
    if (!isExec()) { setStatus('Not an Execution page.', 'error'); log('not an Execution page'); return; }
    const t = String(temperature ?? '').trim(), p = String(pressure ?? '').trim();
    if (t === '' || p === '') { setStatus('Enter temperature and pressure first.', 'error'); return; }
    if (!Number.isFinite(Number(t)) || !Number.isFinite(Number(p))) { setStatus('Temperature and pressure must be numbers.', 'error'); return; }

    filling = true;
    aborted = false;
    saveStore(t, p);
    setStatus('Filling…');
    log('start fill (scan all inputs, no navigation)');

    let found = findAllClassifiedInputs();
    logInputDebug(found.debug, 'initial');
    let tOk = await fillInputs(found.temps, t);
    let pOk = await fillInputs(found.presses, p);

    if (found.temps.length < EXPECTED_COUNT || found.presses.length < EXPECTED_COUNT) {
      setStatus('Only ' + found.temps.length + ' temperature / ' + found.presses.length + ' pressure found — revealing sections…');
      await revealByTreeClicks(t, p);
      found = findAllClassifiedInputs();
      logInputDebug(found.debug, 'after fallback');
      tOk = await fillInputs(found.temps, t);
      pOk = await fillInputs(found.presses, p);
    }

    filling = false;
    const summary = formatSummary(tOk, found.temps.length, pOk, found.presses.length);
    const kind = (found.temps.length < EXPECTED_COUNT || found.presses.length < EXPECTED_COUNT || tOk < found.temps.length || pOk < found.presses.length) ? 'error' : 'ok';
    setStatus(summary, kind);
    log('done', summary);
    return { tOk, tN: found.temps.length, pOk, pN: found.presses.length, summary };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (data && data.date === today()) return { temperature: data.temperature || '', pressure: data.pressure || '' };
    } catch (e) { /* ignore bad storage */ }
    return { temperature: '', pressure: '' };
  }
  function saveStore(temperature, pressure) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ date: today(), temperature, pressure })); }
    catch (e) { log('could not remember values'); }
  }

  function addPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const stored = loadStore();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = 'position:fixed;bottom:86px;left:12px;z-index:99999;width:300px;background:transparent;';
    // Closed shadow root + CSS ::before labels, so Ctrl+F for temp/pressure does not hit the panel.
    panelShadow = panel.attachShadow({ mode: 'closed' });
    panelShadow.innerHTML =
      '<style>' +
      ':host, .wrap { font: 14px/1.4 sans-serif; color: #111; }' +
      '.wrap { width: 300px; padding: 14px 14px 12px; background: #fff; border: 2px solid #1565c0; border-radius: 8px; box-shadow: 0 3px 10px rgba(0,0,0,.35); box-sizing: border-box; }' +
      '.title { font-weight: bold; font-size: 16px; margin-bottom: 8px; }' +
      '.lbl { display: block; margin: 6px 0 3px; }' +
      '.lbl.sp { margin-top: 8px; }' +
      '.lbl::before { content: attr(data-label); }' +
      'input[type="text"] { width: 100%; box-sizing: border-box; padding: 6px 8px; font-size: 16px; }' +
      '.sc-tp-fill { margin-top: 10px; width: 100%; padding: 8px 10px; font-size: 16px; font-weight: bold; background: #1565c0; color: #fff; border: 0; border-radius: 6px; cursor: pointer; }' +
      '#suncheck-tp-status { margin-top: 8px; font-size: 13px; min-height: 1.3em; }' +
      '</style>' +
      '<div class="wrap">' +
      '<div class="title">TP Fill  v' + SCRIPT_VERSION + '</div>' +
      '<span class="lbl" data-label="Temperature (°C)"></span>' +
      '<input class="sc-tp-temp" type="text" inputmode="decimal" aria-label="T">' +
      '<span class="lbl sp" data-label="Pressure (kPa or mmHg)"></span>' +
      '<input class="sc-tp-press" type="text" inputmode="decimal" aria-label="P">' +
      '<button class="sc-tp-fill" type="button">Fill</button>' +
      '<div id="suncheck-tp-status">Enter values, then Fill. Looks for every T and P box on the page.</div>' +
      '</div>';
    const temp = panelShadow.querySelector('.sc-tp-temp');
    const press = panelShadow.querySelector('.sc-tp-press');
    temp.value = stored.temperature;
    press.value = stored.pressure;
    panelShadow.querySelector('.sc-tp-fill').addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      runFill(temp.value, press.value).catch(err => { filling = false; setStatus('Fill error', 'error'); log('fill error'); });
    });
    document.body.appendChild(panel);
  }
  function removeUi() {
    const b = document.getElementById(BTN_ID); if (b) b.remove();
    const p = document.getElementById(PANEL_ID); if (p) p.remove();
    panelShadow = null;
  }
  function addButton() {
    if (document.getElementById(BTN_ID)) return;
    const ver = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || SCRIPT_VERSION;
    const b = document.createElement('button');
    b.id = BTN_ID;
    b.type = 'button';
    b.textContent = 'TP Fill  v' + ver;
    b.title = 'TP Fill v' + ver;
    b.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:99999;padding:14px 28px;font-size:20px;font-weight:bold;background:#1565c0;color:#fff;border:2px solid #fff;border-radius:8px;box-shadow:0 3px 10px rgba(0,0,0,.4);cursor:pointer';
    b.addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      const panel = document.getElementById(PANEL_ID);
      if (panel) panel.remove(); else addPanel();
    });
    document.body.appendChild(b);
  }

  function syncButtons() {
    if (!automationEnabled || !pageHasPeace()) { disableAutomation(); return; }
    if (isExec()) addButton();
    else { removeUi(); }
  }
  function enableAutomation() {
    if (automationEnabled) return;
    automationEnabled = true;
    log('Peace detected — starting');
    buttonTickId = setInterval(syncButtons, 1000);
    syncButtons();
  }
  function disableAutomation() {
    if (filling) aborted = true;
    if (!automationEnabled) { removeUi(); return; }
    automationEnabled = false;
    if (buttonTickId) { clearInterval(buttonTickId); buttonTickId = null; }
    removeUi();
    log('Peace not on page — stopped');
  }
  function evaluateGate() {
    if (pageHasPeace()) enableAutomation();
    else disableAutomation();
  }
  function onPossibleChange() {
    if (gateDebounce) clearTimeout(gateDebounce);
    gateDebounce = setTimeout(evaluateGate, 200);
  }

  if (typeof globalThis !== 'undefined' && globalThis.TP_FILL_TEST) {
    globalThis.TP_FILL_API = {
      findAllClassifiedInputs, classifyInput, kindFromAttrs, kindFromNearby,
      collectNearby, isEditableInput, isPtpInput, energyLabelMatches, isGroupLabel,
      temperatureLabelMatches, pressureLabelMatches, valuesEqual,
      formatSummary, runFill, fillInputs, setAndVerify, readPaneEnergy,
      findEnergyTreeRows, pageHasPeace, addPanel, panelRoot, SCRIPT_VERSION,
      EXPECTED_COUNT, PANEL_ID, BTN_ID, TARGETS
    };
    return;
  }

  log('waiting for Peace on page');
  evaluateGate();
  const root = document.documentElement || document.body;
  if (root && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(onPossibleChange);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }
  window.addEventListener('hashchange', onPossibleChange);
  window.addEventListener('popstate', onPossibleChange);
  setInterval(evaluateGate, 2000);
  setTimeout(() => {
    if (!automationEnabled && !timeoutLogged) {
      timeoutLogged = true;
      log('Peace not found after', GATE_TIMEOUT_MS / 1000, 's — idle until it appears');
    }
  }, GATE_TIMEOUT_MS);
})();
