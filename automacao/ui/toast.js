// Sistema de Notificações Toast Enterprise não-intrusivo
// Posição fixa no canto superior direito com auto-dismiss e suporte a ações

class ToastManager {
  constructor() {
    this.container = null;
    this.ensureContainer();
  }

  ensureContainer() {
    if (this.container && document.body.contains(this.container)) return;
    let existing = document.getElementById('toast-container');
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'toast-container';
      existing.className = 'toast-container';
      existing.setAttribute('aria-live', 'polite');
      existing.setAttribute('aria-atomic', 'true');
      document.body.appendChild(existing);
    }
    this.container = existing;
  }

  show({ title, message, type = 'info', duration = 4000, action = null }) {
    this.ensureContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');

    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };

    const iconEl = document.createElement('span');
    iconEl.className = 'toast-icon';
    iconEl.textContent = icons[type] || 'ℹ';

    const contentEl = document.createElement('div');
    contentEl.className = 'toast-content';

    if (title) {
      const titleEl = document.createElement('strong');
      titleEl.className = 'toast-title';
      titleEl.textContent = title;
      contentEl.appendChild(titleEl);
    }

    if (message) {
      const msgEl = document.createElement('span');
      msgEl.className = 'toast-message';
      msgEl.textContent = message;
      contentEl.appendChild(msgEl);
    }

    toast.appendChild(iconEl);
    toast.appendChild(contentEl);

    if (action && typeof action.onClick === 'function') {
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'toast-action';
      actionBtn.textContent = action.label || 'Ver';
      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        action.onClick();
        this.dismiss(toast);
      });
      toast.appendChild(actionBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Fechar notificação');
    closeBtn.addEventListener('click', () => this.dismiss(toast));
    toast.appendChild(closeBtn);

    // Barra de progresso do auto-dismiss
    if (duration > 0) {
      const progress = document.createElement('div');
      progress.className = 'toast-progress';
      progress.style.animationDuration = `${duration}ms`;
      toast.appendChild(progress);
    }

    this.container.appendChild(toast);

    // Animação de entrada
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    if (duration > 0) {
      toast._timer = setTimeout(() => this.dismiss(toast), duration);
    }

    return toast;
  }

  dismiss(toast) {
    if (!toast || toast.classList.contains('toast-hiding')) return;
    toast.classList.add('toast-hiding');
    if (toast._timer) clearTimeout(toast._timer);
    toast.addEventListener('transitionend', () => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, { once: true });
  }

  success(message, title = 'Sucesso', options = {}) {
    return this.show({ ...options, title, message, type: 'success' });
  }

  error(message, title = 'Erro', options = {}) {
    return this.show({ ...options, title, message, type: 'error', duration: options.duration ?? 6000 });
  }

  warning(message, title = 'Atenção', options = {}) {
    return this.show({ ...options, title, message, type: 'warning', duration: options.duration ?? 5000 });
  }

  info(message, title = 'Informação', options = {}) {
    return this.show({ ...options, title, message, type: 'info' });
  }
}

export const toast = new ToastManager();
