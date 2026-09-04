// ============ UI / NARRATIVE PANE ============
// Text log with hover->3D flash refs, party HUD, roll & end dialogs.

import { EFFECTS } from './data.js';

export const esc = s => String(s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Inline reference helper: hovering the text flashes the 3D entity.
export const ref = (id, text) => `<span class="ref" data-ref="${esc(id)}">${esc(text)}</span>`;

export class UI {
  constructor(onFlash) {
    this.onFlash = onFlash;
    this.logEl = document.getElementById('log');
    this.partyEl = document.getElementById('party-panel');
    this.fearEl = document.getElementById('fear-count');
    this.tokensWrap = document.getElementById('action-tokens');
    this.tokenPips = document.getElementById('token-pips');
    this.contextEl = document.getElementById('context-bar');
    this.badge = document.getElementById('mode-badge');

    this.logEl.addEventListener('mouseover', ev => {
      const r = ev.target.closest('.ref');
      if (r) this.onFlash(r.dataset.ref);
    });
  }

  log(html, cls = 'narration') {
    const div = document.createElement('div');
    div.className = 'log-entry ' + cls;
    div.innerHTML = html;
    this.logEl.appendChild(div);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    // Trim very long logs
    while (this.logEl.children.length > 250) this.logEl.firstChild.remove();
  }

  logHeader(text) {
    this.log(`<h5>${esc(text)}</h5>`, 'system');
  }

  rollDetail(r) {
    const modStr = r.mod >= 0 ? `+ ${r.mod}` : `− ${-r.mod}`;
    return `<span class="roll-detail">Hope <span class="d-hope">${r.hope}</span> + ` +
      `Fear <span class="d-fear">${r.fear}</span> ${modStr} ` +
      `= <b>${r.total}</b> vs DC ${r.dc}</span>`;
  }

  clearLog() { this.logEl.innerHTML = ''; }

  setContext(text) { this.contextEl.textContent = text; }

  setBadge(text, cls = '') {
    this.badge.textContent = text;
    this.badge.className = cls;
  }

  // ---- Party HUD ----
  renderParty(heroes, selectedId, onSelect, onBlessing) {
    this.partyEl.innerHTML = '';
    for (const h of heroes) {
      const card = document.createElement('div');
      card.className = 'hero-card' + (h.id === selectedId ? ' selected' : '') + (h.hp <= 0 ? ' dead' : '');
      const hp = '♥'.repeat(Math.max(h.hp, 0)) + '·'.repeat(Math.max(h.maxHp - h.hp, 0));
      const hope = '◆'.repeat(h.hope) + '◇'.repeat(Math.max(6 - h.hope, 0));
      card.innerHTML =
        `<div class="hname"><span class="hero-chip" style="background:${h.color}"></span>${esc(h.name)}</div>` +
        `<div class="hstats"><span class="hp-pips">${hp}</span><br>` +
        `<span class="hope-pips">${hope}</span><br>` +
        `${esc(h.class)} · Ev ${h.evasion}</div>`;
      if (h.blessing && h.hp > 0) {
        const btn = document.createElement('button');
        btn.className = 'blessing-btn' + (h.blessingUsed ? ' used' : '');
        btn.textContent = h.blessingUsed ? '✦ spent' : '✦ ' + h.blessing.name;
        btn.title = h.blessing.desc;
        btn.disabled = !!h.blessingUsed;
        btn.onclick = ev => { ev.stopPropagation(); onBlessing?.(h.id); };
        card.appendChild(btn);
      }
      card.onclick = () => onSelect(h.id);
      this.partyEl.appendChild(card);
    }
    if (!heroes.length) {
      this.partyEl.innerHTML = '<div class="spirit-note">You are formless — spirits adrift. Find vessels.</div>';
    }
  }

  // ---- Choice dialog (campaign branching) ----
  // opts: { title, html, options: [{label, detail, value}], mood? }
  askChoice({ title, html, options }) {
    return new Promise(resolve => {
      const dlg = document.getElementById('choice-dialog');
      dlg.querySelector('.choice-title').textContent = title;
      dlg.querySelector('.choice-body').innerHTML = html || '';
      const wrap = dlg.querySelector('.choice-options');
      wrap.innerHTML = '';
      for (const opt of options) {
        const b = document.createElement('button');
        b.className = 'choice-btn';
        b.innerHTML = `<b>${esc(opt.label)}</b>` + (opt.detail ? `<span>${esc(opt.detail)}</span>` : '');
        b.onclick = () => { dlg.classList.add('hidden'); resolve(opt.value); };
        wrap.appendChild(b);
      }
      dlg.classList.remove('hidden');
    });
  }

  // ---- Story panel (flashbacks, GM script blocks) ----
  // paragraphs: array of strings (rendered italic, sequential)
  story({ title, paragraphs, button = 'Continue' }) {
    return this.askChoice({
      title,
      html: paragraphs.map(p => `<p class="story-p">${esc(p)}</p>`).join(''),
      options: [{ label: button, value: true }],
    });
  }

  renderFear(n) { this.fearEl.textContent = n; }

  renderTokens(n, max, show) {
    this.tokensWrap.classList.toggle('hidden', !show);
    this.tokenPips.textContent = '●'.repeat(n) + '○'.repeat(Math.max(max - n, 0));
  }

  // ---- Roll dialog ----
  askRoll({ title, flavor, trait, mod, dc, canSpendHope }) {
    return new Promise(resolve => {
      const dlg = document.getElementById('roll-dialog');
      document.getElementById('roll-title').textContent = title;
      document.getElementById('roll-flavor').textContent = flavor || '';
      document.getElementById('roll-meta').innerHTML =
        `<b class="trait">${esc(trait)}</b> check · modifier ${mod >= 0 ? '+' : ''}${mod} · Difficulty <b>${dc}</b>`;
      const spendRow = document.getElementById('hope-spend-row');
      const spendCb = document.getElementById('hope-spend');
      spendCb.checked = false;
      spendRow.style.display = canSpendHope ? 'block' : 'none';
      dlg.classList.remove('hidden');
      const done = v => { dlg.classList.add('hidden'); cleanup(); resolve(v); };
      const go = () => done({ go: true, spendHope: spendCb.checked });
      const cancel = () => done({ go: false });
      const goBtn = document.getElementById('roll-go');
      const cancelBtn = document.getElementById('roll-cancel');
      goBtn.addEventListener('click', go);
      cancelBtn.addEventListener('click', cancel);
      function cleanup() {
        goBtn.removeEventListener('click', go);
        cancelBtn.removeEventListener('click', cancel);
      }
    });
  }

  // ---- Right-click inspector ----
  showInspect(html, ev) {
    const panel = document.getElementById('inspect-panel');
    panel.innerHTML = html + '<div class="ins-hint">right-click elsewhere or press Esc to close</div>';
    panel.classList.remove('hidden');
    const vp = document.getElementById('viewport').getBoundingClientRect();
    let x = ev.clientX - vp.left + 14, y = ev.clientY - vp.top + 10;
    // Clamp inside the viewport
    panel.style.left = '0px'; panel.style.top = '0px';
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    if (x + pw > vp.width - 8) x = Math.max(8, ev.clientX - vp.left - pw - 14);
    if (y + ph > vp.height - 8) y = Math.max(8, vp.height - ph - 8);
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
  }

  hideInspect() {
    document.getElementById('inspect-panel').classList.add('hidden');
  }

  // ---- End modal ----
  showEnd(win, text, onRestart) {
    const m = document.getElementById('end-modal');
    const title = document.getElementById('end-title');
    title.textContent = win ? '✦ VICTORY ✦' : '☠ THE PARTY FALLS ☠';
    title.className = win ? 'win' : 'lose';
    document.getElementById('end-text').textContent = text;
    m.classList.remove('hidden');
    document.getElementById('end-restart').onclick = () => {
      m.classList.add('hidden');
      onRestart();
    };
  }

  // ---- Node editor panel ----
  // opts.scenes: [{id, name}] for the travel-target dropdown (campaign builder)
  openNodePanel(node, { onApply, onDelete, scenes = [] }) {
    const panel = document.getElementById('node-panel');
    document.getElementById('np-type').textContent = node.type.toUpperCase();
    document.getElementById('np-name').value = node.name;
    document.getElementById('np-trait').value = node.trait;
    document.getElementById('np-dc').value = node.dc;
    document.getElementById('np-flavor').value = node.flavor;
    document.getElementById('np-reqkey').value = node.requireKey || '';
    document.getElementById('np-locked').value = node.lockedText || '';

    const gotoSel = document.getElementById('np-goto');
    gotoSel.innerHTML = '<option value="">(none — this is a check)</option>' +
      scenes.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    gotoSel.value = node.goto || '';

    for (const key of ['hopeSuccess', 'fearSuccess', 'hopeFail', 'fearFail']) {
      const o = node.outcomes[key];
      panel.querySelector(`[data-out="${key}"]`).value = o.text;
      const sel = panel.querySelector(`[data-eff="${key}"]`);
      sel.innerHTML = Object.entries(EFFECTS)
        .map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
      sel.value = o.effect;
      const parm = panel.querySelector(`[data-parm="${key}"]`);
      parm.value = o.param || '';
      const syncParm = () => {
        const fx = EFFECTS[sel.value];
        parm.style.display = fx?.needsParam ? 'block' : 'none';
        parm.placeholder = fx?.hint ? `param: ${fx.hint}` : 'effect parameter';
      };
      sel.onchange = syncParm;
      syncParm();
    }
    panel.classList.remove('hidden');

    const close = () => panel.classList.add('hidden');
    document.getElementById('np-ok').onclick = () => {
      node.name = document.getElementById('np-name').value;
      node.trait = document.getElementById('np-trait').value;
      node.dc = parseInt(document.getElementById('np-dc').value) || 12;
      node.flavor = document.getElementById('np-flavor').value;
      node.requireKey = document.getElementById('np-reqkey').value.trim();
      node.lockedText = document.getElementById('np-locked').value;
      node.goto = gotoSel.value || null;
      for (const key of ['hopeSuccess', 'fearSuccess', 'hopeFail', 'fearFail']) {
        node.outcomes[key].text = panel.querySelector(`[data-out="${key}"]`).value;
        node.outcomes[key].effect = panel.querySelector(`[data-eff="${key}"]`).value;
        node.outcomes[key].param = panel.querySelector(`[data-parm="${key}"]`).value.trim();
      }
      close(); onApply(node);
    };
    document.getElementById('np-delete').onclick = () => { close(); onDelete(node); };
    document.getElementById('np-cancel').onclick = close;
  }
}
