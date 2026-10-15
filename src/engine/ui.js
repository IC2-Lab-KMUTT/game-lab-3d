// HTML overlay on top of the 3D view: HUD text, buttons, panels, menus and toasts.
// Plain DOM, styled by src/style.css. Everything is removed when the game is disposed.
//
//   const score = ui.text('Score: 0', 'top-left');     score.set('Score: 5')
//   ui.button('Restart', () => …, 'top-right')
//   const panel = ui.panel('top-right');               panel.append(…any element…)
//   const choice = await ui.menu({ title: 'Game over', text: 'You scored 12', buttons: ['Play again', 'Quit'] })
//   ui.toast('Level 2!')
//   ui.bar('top-left', { label: 'HP', color: '#e63946' }).set(0.5)   progress / health bar (0..1)
//
// Positions: 'top-left' 'top-center' 'top-right' 'bottom-left' 'bottom-center' 'bottom-right' 'center'

export function createUI(root) {
  const slots = {};
  const slot = (pos) => {
    if (!slots[pos]) {
      slots[pos] = document.createElement('div');
      slots[pos].className = `ui-slot ui-${pos}`;
      root.append(slots[pos]);
    }
    return slots[pos];
  };

  const el = (tag, className, html) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  return {
    root,
    el,
    text(html, pos = 'top-left', { big = false } = {}) {
      const e = el('div', `ui-text${big ? ' ui-big' : ''}`, html);
      slot(pos).append(e);
      e.set = (h) => (e.innerHTML = h);
      return e;
    },
    button(label, onClick, pos = 'top-right') {
      const b = el('button', 'ui-button', label);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(b);
      });
      (typeof pos === 'string' ? slot(pos) : pos).append(b);
      return b;
    },
    panel(pos = 'top-right', title) {
      const p = el('div', 'ui-panel');
      if (title) p.append(el('h2', '', title));
      slot(pos).append(p);
      return p;
    },
    /** A labelled <select>. options: [[value, label], …]. */
    select(label, options, value, onChange, parent = 'top-right') {
      const wrap = el('label', 'ui-field', `<span>${label}</span>`);
      const s = el('select');
      for (const [v, l] of options) s.add(new Option(l, v, false, v === value));
      s.addEventListener('change', () => onChange(s.value));
      wrap.append(s);
      (typeof parent === 'string' ? slot(parent) : parent).append(wrap);
      return s;
    },
    /** A labelled range slider. */
    slider(label, { min = 0, max = 1, step = 0.01, value = 0.5 }, onInput, parent = 'top-right') {
      const wrap = el('label', 'ui-field', `<span>${label}</span>`);
      const s = el('input');
      Object.assign(s, { type: 'range', min, max, step, value });
      s.addEventListener('input', () => onInput(Number(s.value)));
      wrap.append(s);
      (typeof parent === 'string' ? slot(parent) : parent).append(wrap);
      return s;
    },
    bar(pos = 'top-left', { label = '', color = '#4ade80', value = 1 } = {}) {
      const wrap = el('div', 'ui-bar', `<span>${label}</span><div><i></i></div>`);
      const fill = wrap.querySelector('i');
      fill.style.background = color;
      wrap.set = (v) => (fill.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`);
      wrap.set(value);
      slot(pos).append(wrap);
      return wrap;
    },
    toast(html, ms = 1800) {
      const t = el('div', 'ui-toast', html);
      slot('top-center').append(t);
      setTimeout(() => t.remove(), ms);
    },
    /** Full-screen menu. Resolves with the label of the button clicked. */
    menu({ title = '', text = '', buttons = ['OK'] } = {}) {
      return new Promise((resolve) => {
        const overlay = el('div', 'ui-menu');
        const card = el('div', 'ui-menu-card', `<h1>${title}</h1>${text ? `<p>${text}</p>` : ''}`);
        const row = el('div', 'ui-row');
        for (const label of buttons) {
          const b = el('button', 'ui-button', label);
          b.addEventListener('click', () => {
            overlay.remove();
            resolve(label);
          });
          row.append(b);
        }
        card.append(row);
        overlay.append(card);
        root.append(overlay);
        row.querySelector('button')?.focus();
      });
    },
    clear() {
      root.innerHTML = '';
      for (const k in slots) delete slots[k];
    },
  };
}
