// ==UserScript==
// @name         TP Fill
// @namespace    https://github.com/mobility22/SunCHECK-TP-Fill
// @version      1.0
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
  const SCRIPT_VERSION = '1.0';
  const log = (...a) => console.log(TAG, ...a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const GATE_RE = /peace/i;
  const GATE_TIMEOUT_MS = 30000;
  const HEADER_SEL = 'header,[role="banner"],[class*="title" i],[class*="header" i],[class*="toolbar" i],[class*="navbar" i],[class*="appbar" i],[class*="app-bar" i],[class*="topbar" i],[class*="top-bar" i],h1,h2';
  const STORE_KEY = 'suncheck-tp-fill-v1';
  const BTN_ID = 'suncheck-tp-btn';
  const PANEL_ID = 'suncheck-tp-panel';
  const TEMP_LABEL_RE = /^\s*Temperature(\s*\([^)]*\))?\s*$/i;
  const PRESS_LABEL_RE = /^\s*Pressure(\s*\([^)]*\))?\s*$/i;
  const FORBIDDEN_CLICK_RE = /^(pass(\s*all)?|fail(\s*all)?|submit|complete|approve|unapprove|delete|cancel|save)$/i;
  const FORBIDDEN_WORD_RE = /\b(pass\s*all|fail\s*all|submit|complete|approve|unapprove|delete)\b/i;
  const ICP_RE = /quad\s*wedges?|\bICP\b/i;
  const TREE_SEL = 'nav,aside,[class*="tree"],[class*="sidebar"],[class*="menu"],[class*="nav"],[role="tree"]';
  const CLICKABLE_SEL = 'a,button,[role="treeitem"],[role="tab"],[role="button"],li,span,div,label';

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
  const vis = el => el && el.offsetParent !== null;
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
  function temperatureLabelMatches(text) { return TEMP_LABEL_RE.test(norm(text)); }
  function pressureLabelMatches(text) { return PRESS_LABEL_RE.test(norm(text)); }
  function isForbiddenClickText(text) {
    const t = norm(text);
    return !t ? false : (FORBIDDEN_CLICK_RE.test(t) || FORBIDDEN_WORD_RE.test(t));
  }
  function targetName(t) { return t.group.replace(/ constancy/i, '') + ' ' + t.energy; }

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
  function safeClick(el, what) {
    if (!el) { log('REFUSED to click: missing', what || ''); return false; }
    if (el.closest && el.closest('#' + PANEL_ID + ',#' + BTN_ID)) return false;
    const t = norm(el.innerText || el.value || el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title')) || '');
    if (isForbiddenClickText(t)) { log('REFUSED to click', what || 'forbidden'); return false; }
    el.click(); log('clicked', what || 'item'); return true;
  }

  function ourUi(el) {
    return !!(el && el.closest && el.closest('#' + PANEL_ID + ',#' + BTN_ID));
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
    const t = norm(el.innerText || el.textContent || '');
    if (!t) return '';
    return t.split('\n')[0].trim();
  }
  function textInputs(root) {
    return [...(root || document).querySelectorAll('input[type="text"],input[type="number"],input:not([type]),textarea')]
      .filter(el => vis(el) && !ourUi(el) && !el.disabled && !el.readOnly);
  }
  function section(name) {
    const re = new RegExp(name, 'i');
    const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,div,span,a,legend,label')]
      .filter(e => vis(e) && !ourUi(e) && e.children.length <= 3 && re.test(e.textContent) && norm(e.textContent).length < 90 &&
        !e.closest('nav,aside,[class*="tree"],[class*="sidebar"],[class*="menu"]'));
    for (const h of heads) {
      let n = h;
      for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
        if (n.querySelector('input,textarea')) return n;
      }
    }
    return null;
  }

  function candidates(root, sel) {
    return [...(root || document).querySelectorAll(sel || CLICKABLE_SEL)].filter(el => vis(el) && !ourUi(el));
  }
  function treeRoots() {
    const nodes = [...document.querySelectorAll(TREE_SEL)].filter(el => vis(el) && !ourUi(el));
    return nodes.length ? nodes : [document.body];
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
    for (const root of treeRoots()) {
      for (const el of candidates(root)) {
        if (isGroupLabel(ownLabel(el), groupName)) hits.push(el);
      }
    }
    return pickShortest(hits);
  }
  function mainRoot() {
    const tree = document.querySelector(TREE_SEL);
    const main = document.querySelector('main,[role="main"],[class*="content"],[class*="detail"],[class*="workspace"]');
    if (main && vis(main) && !ourUi(main)) return main;
    return document.body;
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
    if (hits.length) return pickShortest(hits);
    const treeHits = [];
    for (const root of treeRoots()) {
      for (const el of candidates(root)) {
        if (energyLabelMatches(ownLabel(el), energy)) treeHits.push(el);
      }
    }
    return pickShortest(treeHits);
  }

  function inputFromLabelEl(lab) {
    if (!lab) return null;
    if (lab.htmlFor) {
      const inp = document.getElementById(lab.htmlFor);
      if (inp && vis(inp) && !ourUi(inp)) return inp;
    }
    const inner = lab.querySelector && lab.querySelector('input,textarea');
    if (inner && vis(inner) && !ourUi(inner)) return inner;
    let n = lab;
    for (let i = 0; i < 5 && n; i++, n = n.parentElement) {
      const ins = textInputs(n);
      if (ins.length === 1) return ins[0];
      if (ins.length > 1 && i === 0) {
        const after = ins.find(inp => lab.compareDocumentPosition(inp) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (after) return after;
      }
    }
    let sib = lab.nextElementSibling;
    for (let i = 0; i < 4 && sib; i++, sib = sib.nextElementSibling) {
      if ((sib.matches && sib.matches('input,textarea')) && vis(sib)) return sib;
      const inner2 = sib.querySelector && sib.querySelector('input,textarea');
      if (inner2 && vis(inner2)) return inner2;
    }
    return null;
  }
  function findLabeledInput(labelFn) {
    const root = section('Environmentals') || section('Environmental') || mainRoot();
    const labelEls = [...root.querySelectorAll('label,span,div,p,th,td,h1,h2,h3,h4,h5,legend')].filter(el => vis(el) && !ourUi(el) && el.children.length <= 4);
    for (const el of labelEls) {
      const t = norm(el.innerText || el.textContent || '');
      if (!t || t.length > 80 || !labelFn(t)) continue;
      const inp = inputFromLabelEl(el);
      if (inp) return inp;
    }
    for (const inp of textInputs(root)) {
      const aria = (inp.getAttribute('aria-label') || inp.getAttribute('placeholder') || inp.title || '').trim();
      if (aria && labelFn(aria)) return inp;
    }
    return null;
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

  function setStatus(text, kind) {
    const el = document.getElementById('suncheck-tp-status');
    if (!el) return;
    el.textContent = text;
    el.style.color = kind === 'error' ? '#b71c1c' : kind === 'ok' ? '#1b5e20' : '#111';
  }

  async function fillOneInput(kind, value, labelFn) {
    const inp = findLabeledInput(labelFn);
    if (!inp) return kind + ' input not found';
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
    return kind + ' did not stick';
  }

  async function goToTarget(target) {
    const groupEl = findGroupItem(target.group);
    if (!groupEl) return 'group not found';
    if (!safeClick(groupEl, target.group)) return 'group click refused';
    await sleep(500);
    const energyEl = await waitFor(() => findEnergyTab(target.energy), 8000);
    if (!energyEl) return 'energy tab not found';
    if (!safeClick(energyEl, target.energy)) return 'energy click refused';
    await sleep(500);
    const env = await waitFor(() => findLabeledInput(temperatureLabelMatches) || findLabeledInput(pressureLabelMatches) || section('Environmentals'), 8000);
    if (!env) return 'Environmentals not found';
    return null;
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
    log('start fill', TARGETS.length, 'targets');
    for (let i = 0; i < TARGETS.length; i++) {
      if (aborted || !pageHasPeace()) {
        failed.push('run stopped early');
        break;
      }
      const target = TARGETS[i];
      const name = targetName(target);
      setStatus('Filling ' + (i + 1) + ' of 10: ' + name + '…');
      log('filling', (i + 1) + '/10');
      const navErr = await goToTarget(target);
      if (navErr) { failed.push(name + ' (' + navErr + ')'); log('fail'); continue; }
      const tErr = await fillOneInput('Temperature', t, temperatureLabelMatches);
      const pErr = await fillOneInput('Pressure', p, pressureLabelMatches);
      if (!tErr && !pErr) { ok++; log('ok'); }
      else failed.push(name + ' (' + [tErr, pErr].filter(Boolean).join(', ') + ')');
      await sleep(250);
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
    const t = panel.querySelector('.sc-tp-temp');
    const p = panel.querySelector('.sc-tp-press');
    if (t) t.value = parsed.temperature;
    if (p) p.value = parsed.pressure;
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
      '<div id="suncheck-tp-status" style="margin-top:8px;font-size:13px;min-height:1.3em">Enter values, then Fill. 10 energies.</div>';
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
