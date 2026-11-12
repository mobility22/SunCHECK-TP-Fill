// ==UserScript==
// @name         TP Fill
// @namespace    https://github.com/mobility22/SunCHECK-TP-Fill
// @version      1.2
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
  const SCRIPT_VERSION = '1.2';
  const log = (...a) => console.log(TAG, ...a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const GATE_RE = /peace/i;
  const GATE_TIMEOUT_MS = 30000;
  const NAV_WAIT_MS = 8000;
  const STABLE_MS = 300;
  const POST_FILL_MS = 800;
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
  function targetName(t) { return t.group.replace(/ constancy/i, '') + ' ' + t.energy; }
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
  function safeClick(el, what, energy) {
    return safeActivate(el, what, energy);
  }

  function ourUi(el) {
    return !!(el && el.closest && el.closest('#' + PANEL_ID + ',#' + BTN_ID));
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
  function isShown(el) {
    if (!el || ourUi(el) || el.hidden) return false;
    if (vis(el)) return true;
    try {
      const st = el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.getComputedStyle(el);
      if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
    } catch (e) { /* ignore */ }
    return el.isConnected !== false;
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
  function mainRoot() {
    const main = document.querySelector('main,[role="main"],[class*="content"],[class*="detail"],[class*="workspace"]');
    if (main && isPresentInDom(main) && !ourUi(main)) return main;
    return document.body;
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
  function findEnergyTreeRow(energy, groupName) {
    return findEnergyTreeRows(energy, groupName)[0] || null;
  }
  function findEnergyTab(energy) {
    const roots = [];
    const tablists = [...document.querySelectorAll('[role="tablist"],[class*="tab"],[class*="Tab"]')].filter(el => vis(el) && !ourUi(el) && !el.closest(TREE_SEL));
    roots.push(...tablists);
    roots.push(mainRoot());
    const hits = [];
    const seen = new Set();
    for (const root of roots) {
      for (const el of candidates(root, 'a,button,[role="tab"],[role="button"],li,span,div')) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (el.closest(TREE_SEL)) continue;
        if (energyLabelMatches(ownLabel(el), energy)) hits.push(el);
      }
    }
    return pickShortest(hits);
  }
  function findEnergyTabs(energy) {
    const hits = [];
    const seen = new Set();
    const roots = [];
    const tablists = [...document.querySelectorAll('[role="tablist"],[class*="tab"],[class*="Tab"]')].filter(el => isPresentInDom(el) && !ourUi(el) && !el.closest(TREE_SEL));
    roots.push(...tablists);
    roots.push(mainRoot());
    for (const root of roots) {
      for (const el of [...root.querySelectorAll('a,button,[role="tab"],[role="button"],li,span,div')].filter(e => isPresentInDom(e) && !ourUi(e))) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (el.closest(TREE_SEL)) continue;
        if (energyLabelMatches(ownLabel(el), energy)) hits.push(el);
      }
    }
    if (hits.length) pickShortest(hits);
    return hits;
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

  function dosimetryRe(groupName) {
    return new RegExp('Dosimetry\\s*[-–—]\\s*' + groupKind(groupName) + '\\s*constancy', 'i');
  }
  function headerMatchesEnergy(el, target) {
    const re = dosimetryRe(target.group);
    const own = norm(el.innerText || el.textContent || '').split('\n').slice(0, 3).join(' ');
    if (own.length > 160) return false;
    const parentBits = [];
    if (el.parentElement) {
      for (const sib of el.parentElement.children) {
        const t = norm(sib.innerText || sib.textContent || '').split('\n')[0];
        if (t && t.length < 80) parentBits.push(t);
      }
    }
    const ctx = own + ' ' + parentBits.join(' ');
    if (!re.test(own) && !re.test(ctx)) return false;
    return energyInText(ctx, target.energy) || energyLabelMatches(ownLabel(el), target.energy) || parentBits.some(t => energyLabelMatches(t, target.energy));
  }
  function findEnergySection(target) {
    const re = dosimetryRe(target.group);
    const nodes = [...document.querySelectorAll('h1,h2,h3,h4,h5,div,span,a,p,strong,b,legend')].filter(el => {
      if (!isPresentInDom(el) || ourUi(el) || (el.closest && el.closest(TREE_SEL))) return false;
      const t = norm((el.innerText || el.textContent || '').split('\n')[0]);
      return t.length < 120 && re.test(t);
    });
    const matched = nodes.filter(el => headerMatchesEnergy(el, target));
    const headers = matched.length ? matched : nodes;
    if (!headers.length) return null;
    let best = headers[0];
    for (const h of headers) {
      if (matched.includes(h) && !matched.includes(best)) best = h;
    }
    let n = best;
    for (let i = 0; i < 10 && n && n !== document.body; i++, n = n.parentElement) {
      const ins = n.querySelectorAll('input,textarea');
      if (ins.length >= 1 && ins.length < 40) return n;
    }
    return best.parentElement || best;
  }
  function scrollEl(el) {
    if (!el || typeof el.scrollIntoView !== 'function') return;
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); }
    catch (e) { try { el.scrollIntoView(); } catch (e2) { /* ignore */ } }
  }
  function paneScrollTop() {
    const pane = mainRoot();
    if (!pane) return 0;
    if (typeof pane.scrollTop === 'number' && pane.scrollHeight > pane.clientHeight + 4) return pane.scrollTop;
    const win = pane.ownerDocument && pane.ownerDocument.defaultView;
    if (win && win.scrollY != null) return win.scrollY;
    return 0;
  }
  function photonEnergies() { return ['10 FFF', '6 FFF', '15 MV', '10 MV', '6 MV']; }
  function electronEnergies() { return ['20 MeV', '16 MeV', '12 MeV', '9 MeV', '6 MeV']; }
  function knownEnergies(groupName) {
    return groupKind(groupName) === 'Photon' ? photonEnergies() : electronEnergies();
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
    const tablists = [...document.querySelectorAll('[role="tablist"],[class*="tab"],[aria-selected="true"]')].filter(el => isPresentInDom(el) && !ourUi(el) && !el.closest(TREE_SEL));
    for (const root of tablists) {
      const sel = root.matches && (root.getAttribute('aria-selected') === 'true' || /selected|active/i.test(root.className || '')) ? root
        : (root.querySelector && root.querySelector('[aria-selected="true"],[class*="selected"],[class*="active"]'));
      if (!sel) continue;
      const found = extractEnergyFromText(ownLabel(sel) || sel.textContent, groupName);
      if (found) return found;
    }
    return '';
  }
  function paneShowsEnergy(target) {
    const e = readPaneEnergy(target.group);
    return !!(e && energyLabelMatches(e, target.energy));
  }
  function inputSnapshot(target) {
    const found = findTempAndPressure(target);
    return {
      energy: readPaneEnergy(target.group),
      alreadyTarget: paneShowsEnergy(target),
      temperature: found.temperature || null,
      pressure: found.pressure || null,
      found
    };
  }
  function layoutSignature(target) {
    const parts = [readPaneEnergy(target.group) || '', 's' + Math.round(paneScrollTop())];
    const found = findTempAndPressure(target);
    const els = [];
    const section = found.section || findEnergySection(target);
    if (section) els.push(section);
    if (found.temperature) els.push(found.temperature);
    if (found.pressure) els.push(found.pressure);
    for (const el of els) {
      try {
        const r = el.getBoundingClientRect();
        parts.push([Math.round(r.top), Math.round(r.left), Math.round(r.width), Math.round(r.height)].join(','));
      } catch (e) { parts.push('x'); }
    }
    parts.push(found.temperature ? 't' : '-', found.pressure ? 'p' : '-');
    return parts.join('|');
  }

  function emptyDebug() {
    return {
      inputsScanned: 0,
      editable: 0,
      readonlyOrDisabled: 0,
      excludedUi: 0,
      excludedPtp: 0,
      hiddenType: 0,
      attrAria: 0,
      attrPlaceholder: 0,
      attrTitle: 0,
      attrName: 0,
      attrId: 0,
      attrFormcontrol: 0,
      tempAttrHits: 0,
      pressAttrHits: 0,
      tempNearHits: 0,
      pressNearHits: 0,
      unitCNear: 0,
      unitKpaNear: 0,
      sectionFound: false,
      headerMatchedEnergy: false
    };
  }
  function findTempAndPressure(target) {
    const debug = emptyDebug();
    const section = findEnergySection(target);
    debug.sectionFound = !!section;
    debug.headerMatchedEnergy = !!(section && headerMatchesEnergy(section, target) || (section && [...section.querySelectorAll('h1,h2,h3,h4,h5,div,span')].some(el => headerMatchesEnergy(el, target))));
    const roots = [];
    if (section) roots.push(section);
    const main = mainRoot();
    if (!section || section !== main) roots.push(main);
    const tempHits = [];
    const pressHits = [];
    const seen = new Set();
    for (const root of roots) {
      const list = [...root.querySelectorAll('input,textarea')];
      if (root === (section || roots[0])) debug.inputsScanned = list.length;
      for (const el of list) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (ourUi(el)) { debug.excludedUi++; continue; }
        const typ = (el.type || '').toLowerCase();
        if (SKIP_INPUT_TYPES.test(typ)) { debug.hiddenType++; continue; }
        const map = attrMap(el);
        if (map['aria-label']) debug.attrAria++;
        if (map.placeholder) debug.attrPlaceholder++;
        if (map.title) debug.attrTitle++;
        if (map.name) debug.attrName++;
        if (map.id) debug.attrId++;
        if (map.formcontrolname || map.formControlName || map['ng-reflect-name'] || map['ng-reflect-form-control-name']) debug.attrFormcontrol++;
        if (el.disabled || el.readOnly) { debug.readonlyOrDisabled++; }
        const cls = classifyInput(el);
        if (cls.kind === 'ptp') { debug.excludedPtp++; continue; }
        if (cls.via === 'attr' && cls.kind === 'temperature') debug.tempAttrHits++;
        if (cls.via === 'attr' && cls.kind === 'pressure') debug.pressAttrHits++;
        if (cls.via === 'near' && cls.kind === 'temperature') debug.tempNearHits++;
        if (cls.via === 'near' && cls.kind === 'pressure') debug.pressNearHits++;
        if (cls.nearby && cls.nearby.units.some(u => UNIT_C_RE.test(u))) debug.unitCNear++;
        if (cls.nearby && cls.nearby.units.some(u => UNIT_PRESS_RE.test(u))) debug.unitKpaNear++;
        if (!isEditableInput(el)) continue;
        if (!isPresentInDom(el)) continue;
        debug.editable++;
        const inSection = !!(section && section.contains(el));
        const rec = { el, inSection, via: cls.via, units: (cls.nearby && cls.nearby.units) || [] };
        if (cls.kind === 'temperature') tempHits.push(rec);
        if (cls.kind === 'pressure') pressHits.push(rec);
      }
    }
    const pick = hits => {
      const preferred = hits.filter(h => h.inSection);
      const pool = preferred.length ? preferred : hits;
      pool.sort((a, b) => {
        const ua = a.units.length ? 1 : 0, ub = b.units.length ? 1 : 0;
        if (ua !== ub) return ub - ua;
        if ((a.via === 'attr') !== (b.via === 'attr')) return a.via === 'attr' ? -1 : 1;
        return 0;
      });
      return pool[0] ? pool[0].el : null;
    };
    return { temperature: pick(tempHits), pressure: pick(pressHits), section, debug };
  }
  function logInputDebug(target, debug) {
    log('debug input scan', targetName(target),
      'scanned=' + debug.inputsScanned,
      'editable=' + debug.editable,
      'readonlyOrDisabled=' + debug.readonlyOrDisabled,
      'excludedUi=' + debug.excludedUi,
      'excludedPtp=' + debug.excludedPtp,
      'hiddenType=' + debug.hiddenType,
      'attrs(aria/placeholder/title/name/id/formcontrol)=' +
        [debug.attrAria, debug.attrPlaceholder, debug.attrTitle, debug.attrName, debug.attrId, debug.attrFormcontrol].join('/'),
      'tempAttr=' + debug.tempAttrHits,
      'pressAttr=' + debug.pressAttrHits,
      'tempNear=' + debug.tempNearHits,
      'pressNear=' + debug.pressNearHits,
      'unitC=' + debug.unitCNear,
      'unitKpa=' + debug.unitKpaNear,
      'sectionFound=' + debug.sectionFound,
      'headerMatchedEnergy=' + debug.headerMatchedEnergy
    );
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

  let automationEnabled = false;
  let buttonTickId = null;
  let gateDebounce = null;
  let timeoutLogged = false;
  let filling = false;
  let aborted = false;

  const energyProgress = {};
  function renderProgress() {
    const box = document.getElementById('suncheck-tp-progress');
    if (!box) return;
    box.textContent = TARGETS.map(tg => {
      const n = targetName(tg);
      return n + ': ' + (energyProgress[n] || '…');
    }).join('\n');
  }
  function setStatus(text, kind) {
    const el = document.getElementById('suncheck-tp-status');
    if (!el) return;
    el.textContent = text;
    el.style.color = kind === 'error' ? '#b71c1c' : kind === 'ok' ? '#1b5e20' : '#111';
  }
  function setEnergyProgress(name, state, kind) {
    energyProgress[name] = state;
    renderProgress();
    setStatus(name + ': ' + state, kind);
    log(name + ':', state);
  }

  async function setIfNeeded(kind, inp, value) {
    if (!inp) return kind.toLowerCase() + ' input not found';
    if (valuesEqual(inp.value, value)) { log(kind, 'already set'); return null; }
    inp.focus();
    setVal(inp, value);
    await sleep(350);
    if (valuesEqual(inp.value, value)) { log(kind, 'set'); return null; }
    inp.focus();
    setVal(inp, value);
    await sleep(350);
    if (valuesEqual(inp.value, value)) { log(kind, 'set after retry'); return null; }
    log(kind, 'did not stick');
    return kind.toLowerCase() + ' did not stick';
  }
  async function verifyAfterSettle(target, tVal, pVal) {
    await sleep(POST_FILL_MS);
    if (!paneShowsEnergy(target)) return 'pane changed before values settled';
    const again = findTempAndPressure(target);
    const errs = [];
    if (!again.temperature || !valuesEqual(again.temperature.value, tVal)) errs.push('temperature did not stick');
    if (!again.pressure || !valuesEqual(again.pressure.value, pVal)) errs.push('pressure did not stick');
    return errs;
  }

  async function waitForPaneReady(target, before, timeout) {
    const t0 = Date.now();
    const ms = timeout == null ? NAV_WAIT_MS : timeout;
    let lastSig = null;
    let stableSince = null;
    let lastFound = (before && before.found) || findTempAndPressure(target);
    while (Date.now() - t0 < ms) {
      if (aborted) break;
      const energyOk = paneShowsEnergy(target);
      lastFound = findTempAndPressure(target);
      const sig = layoutSignature(target);
      if (energyOk && lastFound.temperature && lastFound.pressure) {
        if (sig === lastSig) {
          if (stableSince == null) stableSince = Date.now();
          if (Date.now() - stableSince >= STABLE_MS) {
            logInputDebug(target, lastFound.debug);
            return { ok: true, found: lastFound };
          }
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
    logInputDebug(target, lastFound.debug);
    if (!paneShowsEnergy(target)) return { ok: false, found: lastFound, error: 'nav failed' };
    return { ok: false, found: lastFound, error: null };
  }

  async function tryClickAndWait(el, what, energy, target, before, perTryMs) {
    const chain = clickableChain(el, energy);
    if (!chain.length && el) chain.push(el);
    for (const node of chain) {
      if (!canActivate(node)) {
        if (node && isForbiddenClickText(norm(node.innerText || ''))) log('REFUSED to click', what || 'forbidden');
        continue;
      }
      dispatchPointerClick(node);
      log('clicked', what || 'item');
      const ready = await waitForPaneReady(target, before, perTryMs || 2500);
      if (ready.ok) return ready;
    }
    return { ok: false, error: 'nav failed' };
  }

  async function goToTarget(target) {
    const before = inputSnapshot(target);
    if (before.alreadyTarget) {
      const ready = await waitForPaneReady(target, before, NAV_WAIT_MS);
      return ready.ok || (ready.found && (ready.found.temperature || ready.found.pressure))
        ? { found: ready.found || before.found, via: 'already', error: ready.ok ? null : null }
        : { found: ready.found, via: 'already', error: ready.error };
    }

    let via = 'tree';
    let rows = findEnergyTreeRows(target.energy, target.group);
    if (!rows.length) {
      const groupEl = findGroupItem(target.group);
      if (!groupEl) return { error: 'group not found' };
      if (!safeActivate(groupEl, target.group, null)) return { error: 'group click refused' };
      await sleep(400);
      rows = await waitFor(() => {
        const list = findEnergyTreeRows(target.energy, target.group);
        return list.length ? list : null;
      }, 3000) || [];
    }
    for (const row of rows) {
      const ready = await tryClickAndWait(row, 'tree ' + target.energy, target.energy, target, before, 2500);
      if (ready.ok) return { found: ready.found, via: 'tree' };
      if (paneShowsEnergy(target)) {
        const again = await waitForPaneReady(target, before, 5000);
        if (again.ok) return { found: again.found, via: 'tree' };
        return { found: again.found, via: 'tree', error: again.error };
      }
    }

    via = 'tab';
    let tabs = findEnergyTabs(target.energy);
    if (!tabs.length) tabs = await waitFor(() => {
      const list = findEnergyTabs(target.energy);
      return list.length ? list : null;
    }, 2000) || [];
    for (const tab of tabs) {
      const ready = await tryClickAndWait(tab, 'tab ' + target.energy, target.energy, target, before, 2500);
      if (ready.ok) return { found: ready.found, via: 'tab' };
    }
    const late = await waitForPaneReady(target, before, 4000);
    if (late.ok) return { found: late.found, via: via };
    if (!rows.length && !tabs.length) return { error: 'energy row not found', found: late.found };
    return { error: 'nav failed', found: late.found, via };
  }

  async function fillFound(target, found, tVal, pVal) {
    const scanned = found && found.debug ? found.debug.inputsScanned : 0;
    const errs = [];
    if (!found || !found.temperature) errs.push('no temperature input (' + scanned + ' inputs scanned)');
    else {
      const e = await setIfNeeded('Temperature', found.temperature, tVal);
      if (e) errs.push(e);
    }
    if (!found || !found.pressure) errs.push('no pressure input (' + scanned + ' inputs scanned)');
    else {
      const e = await setIfNeeded('Pressure', found.pressure, pVal);
      if (e) errs.push(e);
    }
    if (!errs.length) {
      const late = await verifyAfterSettle(target, tVal, pVal);
      if (late.length) return late;
    }
    return errs;
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
    const failed = [];
    let ok = 0;
    for (const tg of TARGETS) energyProgress[targetName(tg)] = '…';
    renderProgress();
    log('start fill', TARGETS.length, 'targets');
    for (let i = 0; i < TARGETS.length; i++) {
      if (aborted || !pageHasPeace()) {
        failed.push('run stopped early');
        break;
      }
      const target = TARGETS[i];
      const name = targetName(target);
      setEnergyProgress(name, 'navigating…');
      log('filling', (i + 1) + '/10');
      const nav = await goToTarget(target);
      if (nav.error === 'nav failed' || nav.error === 'group not found' || nav.error === 'energy row not found' || nav.error === 'group click refused') {
        failed.push(name + ' (' + nav.error + ')');
        setEnergyProgress(name, nav.error, 'error');
        continue;
      }
      if (!nav.error) setEnergyProgress(name, 'nav ok');
      const found = nav.found || findTempAndPressure(target);
      if (!paneShowsEnergy(target)) {
        failed.push(name + ' (nav failed)');
        setEnergyProgress(name, 'nav failed', 'error');
        continue;
      }
      const errs = await fillFound(target, found, t, p);
      if (!errs.length) {
        ok++;
        setEnergyProgress(name, 'filled', 'ok');
      } else {
        failed.push(name + ' (' + errs.join(', ') + ')');
        setEnergyProgress(name, errs.join(', '), 'error');
      }
    }
    filling = false;
    const summary = ok + ' of 10 filled' + (failed.length ? '. Failed: ' + failed.join('; ') : '.');
    setStatus(summary, failed.length ? 'error' : 'ok');
    log('done', summary);
  }

  function applyPaste(raw) {
    const parsed = parsePaste(raw);
    if (!parsed) return false;
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return false;
    const tIn = panel.querySelector('.sc-tp-temp');
    const pIn = panel.querySelector('.sc-tp-press');
    if (tIn) tIn.value = parsed.temperature;
    if (pIn) pIn.value = parsed.pressure;
    log('parsed paste');
    return true;
  }

  function addPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const stored = loadStore();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = 'position:fixed;bottom:86px;left:12px;z-index:99999;width:280px;padding:14px 14px 12px;background:#fff;color:#111;border:2px solid #1565c0;border-radius:8px;box-shadow:0 3px 10px rgba(0,0,0,.35);font:14px/1.4 sans-serif';
    panel.innerHTML = '<div style="font-weight:bold;font-size:16px;margin-bottom:8px">TP Fill  v' + SCRIPT_VERSION + '</div>' +
      '<label style="display:block;margin:6px 0 3px">Temperature (°C)</label>' +
      '<input class="sc-tp-temp" type="text" inputmode="decimal" style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:16px">' +
      '<label style="display:block;margin:8px 0 3px">Pressure (kPa or mmHg)</label>' +
      '<input class="sc-tp-press" type="text" inputmode="decimal" style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:16px">' +
      '<label style="display:block;margin:8px 0 3px">Or paste both (e.g. 22.3 101.2)</label>' +
      '<input class="sc-tp-paste" type="text" placeholder="22.3 101.2" style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:16px">' +
      '<button class="sc-tp-fill" type="button" style="margin-top:10px;width:100%;padding:8px 10px;font-size:16px;font-weight:bold;background:#1565c0;color:#fff;border:0;border-radius:6px;cursor:pointer">Fill</button>' +
      '<div id="suncheck-tp-status" style="margin-top:8px;font-size:13px;min-height:1.3em">Enter values, then Fill. 10 energies.</div>' +
      '<div id="suncheck-tp-progress" style="margin-top:8px;font-size:12px;line-height:1.35;max-height:11em;overflow:auto;white-space:pre-wrap"></div>';
    const temp = panel.querySelector('.sc-tp-temp');
    const press = panel.querySelector('.sc-tp-press');
    const paste = panel.querySelector('.sc-tp-paste');
    temp.value = stored.temperature;
    press.value = stored.pressure;
    paste.addEventListener('input', () => { if (applyPaste(paste.value)) paste.style.borderColor = '#2e7d32'; });
    paste.addEventListener('paste', ev => {
      const raw = (ev.clipboardData && ev.clipboardData.getData('text')) || '';
      if (applyPaste(raw)) { ev.preventDefault(); paste.value = raw.trim(); }
    });
    panel.querySelector('.sc-tp-fill').addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      if (paste.value && applyPaste(paste.value)) { /* fields updated */ }
      runFill(temp.value, press.value).catch(err => { filling = false; setStatus('Fill error', 'error'); log('fill error'); });
    });
    document.body.appendChild(panel);
  }
  function removeUi() {
    const b = document.getElementById(BTN_ID); if (b) b.remove();
    const p = document.getElementById(PANEL_ID); if (p) p.remove();
  }
  function addButton() {
    if (document.getElementById(BTN_ID)) return;
    const ver = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || SCRIPT_VERSION;
    const b = document.createElement('button');
    b.id = BTN_ID;
    b.type = 'button';
    b.textContent = 'TP Fill  v' + ver;
    b.title = 'TP Fill v' + ver + ' — fill Temperature and Pressure';
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
      findTempAndPressure, findEnergySection, findEnergyTreeRow, findEnergyTab,
      findEnergyTreeRows, findEnergyTabs, findGroupItem, classifyInput, kindFromAttrs,
      kindFromNearby, collectNearby, isEditableInput, isPtpInput, energyLabelMatches,
      isGroupLabel, targetName, readPaneEnergy, paneShowsEnergy, goToTarget,
      waitForPaneReady, dispatchPointerClick, clickableChain, layoutSignature,
      isPresentInDom, SCRIPT_VERSION, TARGETS, PANEL_ID, BTN_ID, NAV_WAIT_MS, STABLE_MS, POST_FILL_MS
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
