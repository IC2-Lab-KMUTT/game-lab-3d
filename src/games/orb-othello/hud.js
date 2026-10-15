// Orb Othello's HUD: scoreboard with a territory bar, turn line, cosmic-rule chips (with tooltips),
// move ticker, toolbar, banners, the start menu and the end screen.
// Plain DOM styled by orb.css; the game calls these and gets callbacks / promises back.
import './orb.css';

const el = (tag, cls, html) => Object.assign(document.createElement(tag), { className: cls ?? '', innerHTML: html ?? '' });

/** Small line icons for the cosmic rules (inline SVG, currentColor). */
export const ICONS = {
  tectonic: '<svg viewBox="0 0 24 24"><path d="M3 8h13l-3-3M21 16H8l3 3"/></svg>',
  holes: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 0 1 9 9M12 21a9 9 0 0 1-9-9M19 6a9 9 0 0 1-1 12M5 18A9 9 0 0 1 6 6"/></svg>',
  nova: '<svg viewBox="0 0 24 24"><path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z"/></svg>',
  night: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
};

/** The cosmic rules as players read them (menu cards and in-game tooltips). */
export const RULE_TEXT = {
  tectonic: { name: 'Tectonic shift', line: 'Every 3 turns a band of the planet slides round, carrying its discs. The band with racing arrows moves next.' },
  holes: { name: 'Black holes', line: 'Six voids swallow cells. Nobody can play there, and lines stop at them, so some rings can never close.' },
  nova: { name: 'Supernova stars', line: 'Play on a star (it must still be a legal move) and it bursts: every enemy disc touching it flips too.' },
  night: { name: 'Night side', line: 'Night sweeps round the planet. Discs in the dark are asleep: lines through them capture nothing, unless you close a whole ring.' },
};

/** A row of toggle buttons; returns { el, value }. options: [[value, label, extraClass?], …] */
function segmented(options, value, onChange) {
  const box = el('div', 'orb-seg');
  const state = { el: box, value };
  for (const [v, label, cls] of options) {
    const b = el('button', cls ?? '', label);
    b.type = 'button';
    b.classList.toggle('on', v === value);
    b.addEventListener('click', () => {
      state.value = v;
      box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      onChange?.(v);
    });
    box.append(b);
  }
  return state;
}

const field = (label, control) => {
  const f = el('div', 'orb-field');
  f.append(el('div', 'orb-label', label), control.el ?? control);
  return f;
};

/** Count a number up/down smoothly (score digits). */
function roll(node, to) {
  const from = Number(node.dataset.value ?? node.textContent) || 0;
  node.dataset.value = to;
  if (from === to) return (node.textContent = to);
  const t0 = performance.now();
  const dur = Math.min(450, 90 + Math.abs(to - from) * 40);
  cancelAnimationFrame(node._roll);
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    node.textContent = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) node._roll = requestAnimationFrame(step);
  };
  node._roll = requestAnimationFrame(step);
}

/**
 * names: { 1: 'Ember', 2: 'Frost' }. actions: { undo, newGame, hints, music, volume(v), menu, click, hover } (click/hover = UI sounds).
 */
export function createHud(engine, { names, actions, cells = 128 }) {
  const root = el('div', 'orb');
  root.style.pointerEvents = 'none'; // beats the overlay's "#ui > * { pointer-events: auto }"
  engine.ui.root.append(root);
  root.append(el('div', 'orb-vignette'));

  // ---------- scoreboard + territory bar ----------
  const board = el('div', 'orb-score');
  const sideOf = (cls, p) => {
    const s = el('div', `orb-side ${cls}`);
    const info = el('div', 'orb-info', `<div class="orb-name">${names[p]}</div><div class="orb-who"></div>`);
    const chip = el('div', 'orb-chip');
    const count = el('div', 'orb-count', '2');
    if (cls === 'ember') s.append(info, count, chip);
    else s.append(chip, count, info);
    return { s, count, who: info.querySelector('.orb-who') };
  };
  const sides = { 1: sideOf('ember', 1), 2: sideOf('frost', 2) };
  const bar = el('div', 'orb-bar', '<i class="e"></i><i class="f"></i><b></b>');
  const row = el('div', 'orb-score-row');
  row.append(sides[1].s, sides[2].s);
  board.append(row, bar);
  const turn = el('div', 'orb-turn');
  root.append(board, turn);

  // ---------- cosmic rule chips (top left) with tooltips ----------
  const chips = el('div', 'orb-chips');
  const tip = el('div', 'orb-tip');
  root.append(chips, tip);
  const chipEls = {};
  const showTip = (target, html) => {
    tip.innerHTML = html;
    const r = target.getBoundingClientRect();
    tip.style.left = `${r.left}px`;
    tip.style.top = `${r.bottom + 8}px`;
    tip.classList.add('on');
  };
  const hideTip = () => tip.classList.remove('on');

  // ---------- move ticker (right) ----------
  const ticker = el('div', 'orb-ticker');
  root.append(ticker);

  // ---------- toolbar ----------
  const tools = el('div', 'orb-tools');
  const tool = (label, key, fn, title) => {
    const b = el('button', 'orb-tool', `<span>${label}</span><kbd>${key}</kbd>`);
    b.title = title ?? label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      actions.click?.();
      fn();
    });
    b.addEventListener('pointerenter', () => actions.hover?.());
    tools.append(b);
    return b;
  };
  tool('New', 'N', actions.newGame, 'New game');
  tool('Undo', 'U', actions.undo, 'Take back your last move');
  const hintBtn = tool('Hints', 'H', actions.hints, 'Show the moves you can make');
  const musicBtn = tool('Music', 'M', actions.music, 'Music on/off');
  const vol = el('input', 'orb-vol');
  Object.assign(vol, { type: 'range', min: 0, max: 1, step: 0.05, value: 0.7, title: 'Volume' });
  vol.addEventListener('input', () => actions.volume?.(Number(vol.value)));
  vol.addEventListener('pointerdown', (e) => e.stopPropagation());
  tools.append(vol);
  tool('Menu', 'Esc', actions.menu, 'Back to the menu');
  const help = el('div', 'orb-help', 'Drag to spin the planet · scroll to zoom · click a glowing ring to play');
  root.append(tools, help);

  const playUi = [board, turn, tools, help, chips, ticker];
  const hud = {
    setScores(s) {
      for (const p of [1, 2]) roll(sides[p].count, s[p]);
      const total = Math.max(1, s[1] + s[2]);
      bar.querySelector('.e').style.width = `${(s[1] / cells) * 100}%`;
      bar.querySelector('.f').style.width = `${(s[2] / cells) * 100}%`;
      bar.querySelector('b').style.left = `${(s[1] / total) * 100}%`;
    },
    /** Pulse a count (a disc just landed or flipped to that side). */
    bump(p) {
      const c = sides[p].count;
      c.classList.remove('bump');
      void c.offsetWidth; // restart the CSS animation
      c.classList.add('bump');
    },
    setPlayers(labels) {
      for (const p of [1, 2]) sides[p].who.textContent = labels[p];
    },
    setTurn(p, html) {
      for (const q of [1, 2]) sides[q].s.classList.toggle('active', q === p);
      if (turn.innerHTML !== html) {
        turn.innerHTML = html;
        turn.classList.remove('swap');
        void turn.offsetWidth;
        turn.classList.add('swap');
      }
      turn.dataset.p = p ?? 0;
    },
    setToggles({ hints, music, volume }) {
      hintBtn.classList.toggle('off', !hints);
      musicBtn.classList.toggle('off', !music);
      if (volume !== undefined) vol.value = volume;
    },
    /** rules: { name: statusText | null } for the active rules (status shown on the chip). */
    setRules(rules) {
      for (const [name, status] of Object.entries(rules)) {
        let c = chipEls[name];
        if (!c) {
          c = chipEls[name] = el('div', `orb-rchip ${name}`, `<span class="ic">${ICONS[name]}</span><span class="nm">${RULE_TEXT[name].name}</span><span class="st"></span>`);
          c.addEventListener('pointerenter', () => showTip(c, `<b>${RULE_TEXT[name].name}</b>${RULE_TEXT[name].line}`));
          c.addEventListener('pointerleave', hideTip);
          chips.append(c);
        }
        const st = c.querySelector('.st');
        if (st.innerHTML !== (status ?? '')) st.innerHTML = status ?? '';
        c.classList.toggle('alert', /now|next/i.test(status ?? ''));
      }
      for (const name of Object.keys(chipEls)) if (!(name in rules)) (chipEls[name].remove(), delete chipEls[name]);
    },
    /** Add a line to the move ticker: { player, text, detail }. Keeps the last 6. */
    log({ player, text, detail = '' }) {
      const item = el('div', `orb-tick p${player}`, `<i></i><span>${text}</span><em>${detail}</em>`);
      ticker.prepend(item);
      while (ticker.children.length > 6) ticker.lastChild.remove();
    },
    clearLog() {
      ticker.innerHTML = '';
    },
    hideHelp() {
      help.style.opacity = '0';
    },
    showPlayUi(on) {
      for (const e of playUi) e.classList.toggle('orb-hidden', !on);
      if (!on) hideTip();
    },
    /** Big centred title. kind: '' | 'big' (ring closure, supernova) */
    banner(html, color = 'var(--ink)', kind = '') {
      root.querySelector('.orb-banner')?.remove();
      const b = el('div', `orb-banner ${kind}`, html);
      b.style.color = color;
      root.append(b);
      setTimeout(() => b.remove(), kind === 'big' ? 2400 : 1900);
    },

    /** Start menu. Resolves with { mode, level, human, hints, rules: {…}, quality }. */
    menu(defaults) {
      hud.showPlayUi(false);
      return new Promise((resolve) => {
        const overlay = el('div', 'orb-overlay orb-menu');
        const card = el('div', 'orb-card');
        card.append(
          el('div', 'orb-kicker', 'A strategy game in orbit'),
          el('h1', 'orb-title', 'ORB<br>OTHELLO'),
          el('p', 'orb-tag', '<b>Flank</b> your rival’s discs to flip them. Rows run <b>all the way round</b> the world, and if your disc closes a <b>ring</b>, the whole ring is yours.'),
        );
        const opts = structuredClone(defaults);
        const levelField = field('Computer', segmented([['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], opts.level, (v) => ((opts.level = v), actions.click?.())));
        const sideField = field('You play', segmented([[1, `${names[1]} · first`, 'ember'], [2, names[2], 'frost']], opts.human, (v) => ((opts.human = v), actions.click?.())));
        const showAi = () => [levelField, sideField].forEach((f) => f.classList.toggle('hidden', opts.mode !== 'ai'));
        // cosmic rules: toggle cards
        const rules = el('div', 'orb-rules');
        for (const name of Object.keys(RULE_TEXT)) {
          const b = el('button', `orb-rule ${name}`, `<span class="ic">${ICONS[name]}</span><span class="tx"><b>${RULE_TEXT[name].name}</b><small>${RULE_TEXT[name].line}</small></span><span class="sw"></span>`);
          b.type = 'button';
          b.classList.toggle('on', !!opts.rules[name]);
          b.addEventListener('click', () => {
            opts.rules[name] = !opts.rules[name];
            b.classList.toggle('on', opts.rules[name]);
            actions.click?.();
          });
          b.addEventListener('pointerenter', () => actions.hover?.());
          rules.append(b);
        }
        const rulesHead = el('div', 'orb-label', 'Cosmic rules <span class="dimmer">· none = classic</span>');
        const left = el('div', 'orb-col');
        const right = el('div', 'orb-col');
        left.append(
          field('Mode', segmented([['ai', 'vs Computer'], ['hotseat', '2 Players']], opts.mode, (v) => ((opts.mode = v), showAi(), actions.click?.()))),
          levelField,
          sideField,
          field('Move hints', segmented([[true, 'On'], [false, 'Off']], opts.hints, (v) => ((opts.hints = v), actions.click?.()))),
          field('Graphics', segmented([['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], opts.quality, (v) => ((opts.quality = v), actions.click?.(), actions.quality?.(v)))),
        );
        right.append(rulesHead, rules);
        const cols = el('div', 'orb-cols');
        cols.append(left, right);
        card.append(cols);
        showAi();
        const go = el('button', 'orb-go', 'Launch');
        go.addEventListener('click', () => {
          overlay.classList.add('leaving');
          setTimeout(() => overlay.remove(), 380);
          resolve(opts);
        });
        go.addEventListener('pointerenter', () => actions.hover?.());
        card.append(go, el('div', 'orb-foot', 'Drag to spin · scroll to zoom · U undo · H hints · M music · Esc menu'));
        overlay.append(card);
        root.append(overlay);
        go.focus();
      });
    },

    /** End screen. Resolves with 'again' or 'menu'. stats: [[label, value], …] */
    end({ title, color, scores, text, stats = [] }) {
      return new Promise((resolve) => {
        const overlay = el('div', 'orb-overlay orb-end');
        const card = el('div', 'orb-card');
        const h = el('h1', 'orb-title', title);
        if (color) (h.style.background = `linear-gradient(90deg, ${color}, #fff 50%, ${color})`), (h.style.webkitBackgroundClip = h.style.backgroundClip = 'text');
        card.append(
          h,
          el('div', 'orb-final', `<span class="e">${scores[1]}</span><i>vs</i><span class="f">${scores[2]}</span>`),
          el('p', 'orb-tag', text),
          el('div', 'orb-stats', stats.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')),
        );
        const again = el('button', 'orb-go', 'Play again');
        const menu = el('button', 'orb-ghost', 'Change mode');
        again.addEventListener('click', () => (overlay.remove(), resolve('again')));
        menu.addEventListener('click', () => (overlay.remove(), resolve('menu')));
        card.append(again, menu);
        overlay.append(card);
        root.append(overlay);
      });
    },
    closeOverlays() {
      root.querySelectorAll('.orb-overlay').forEach((o) => o.remove());
    },
  };
  return hud;
}
