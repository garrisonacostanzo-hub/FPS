// Pop-up notifications (friend requests, squad invites, 1v1 challenges, "X joined your squad"...). They live outside
// the menu so menu re-renders don't remove them. While a match is running they are hidden and invites wait.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Toasts {
  constructor(parent = document.body) {
    this.el = document.createElement('div');
    this.el.className = 'toasts';
    this.el.setAttribute('aria-live', 'polite');
    parent.appendChild(this.el);
    this.items = new Map();
    this.seq = 0;
    this.onAction = null;
  }

  /** { id?, title?, text, actions?: [{ label, primary?, fn }], ttl? (ms), sticky? (keep while hidden) } */
  show(t) {
    const id = t.id || 't' + this.seq++;
    this.dismiss(id);
    const node = document.createElement('div');
    node.className = 'toast' + (t.actions && t.actions.length ? ' ask' : '');
    node.dataset.toast = id;
    node.innerHTML = `${t.title ? `<b>${esc(t.title)}</b>` : ''}<p>${esc(t.text)}</p>
      ${t.actions && t.actions.length ? `<div class="toast-actions">${t.actions.map((a, i) => `<button data-i="${i}" class="${a.primary ? 'primary' : ''}">${esc(a.label)}</button>`).join('')}</div>` : ''}
      <button class="toast-x" aria-label="Dismiss">✕</button>`;
    node.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
      const a = t.actions[Number(b.dataset.i)];
      this.dismiss(id);
      if (this.onAction) this.onAction();
      if (a && a.fn) a.fn();
    }));
    node.querySelector('.toast-x').addEventListener('click', () => this.dismiss(id));
    this.el.prepend(node);
    const ttl = t.ttl || (t.actions ? 20000 : 6000);
    const timer = setTimeout(() => this.dismiss(id), ttl);
    this.items.set(id, { node, timer });
    while (this.el.children.length > 5) {
      const last = this.el.lastElementChild;
      this.dismiss(last.dataset.toast);
    }
    return id;
  }

  dismiss(id) {
    const item = this.items.get(id);
    if (!item) return;
    clearTimeout(item.timer);
    item.node.remove();
    this.items.delete(id);
  }

  setHidden(hidden) {
    this.el.classList.toggle('hidden', hidden);
  }
}
