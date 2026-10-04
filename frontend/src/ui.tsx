import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { useModalDialog } from './useModalDialog';

export function Button({ icon, busy = false, variant = 'default', className = '', children, disabled, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName; busy?: boolean; variant?: 'default' | 'primary' | 'danger' }) {
  return <button {...props} type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={`ui-button ${variant === 'primary' ? 'primary' : variant === 'danger' ? 'danger-action' : ''} ${className}`}>
    {(busy || icon) && <Icon name={busy ? 'refresh' : icon!} size={16} className={busy ? 'is-spinning' : undefined}/>} {children}
  </button>;
}

export function IconButton({ icon, label, className = '', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: IconName; label: string }) {
  return <button type="button" title={label} aria-label={label} {...props} className={`ui-icon-button ${className}`}><Icon name={icon}/></button>;
}

export function Dialog({ label, labelledBy, closeLabel, busy, close, className = 'modal', backdropClassName = '', children }: { label?: string; labelledBy?: string; closeLabel: string; busy: boolean; close: () => void; className?: string; backdropClassName?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const pointerStartedOutside = useRef(false);
  useModalDialog(ref, busy, close);
  return <div className={`modal-backdrop ${backdropClassName}`} onPointerDown={event => { pointerStartedOutside.current = event.target === event.currentTarget; }} onClick={event => {
    if (pointerStartedOutside.current && event.target === event.currentTarget && !busy) close();
    pointerStartedOutside.current = false;
  }}>
    <section ref={ref} tabIndex={-1} className={className} role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy} aria-busy={busy || undefined}>
      <IconButton className="close" icon="close" label={closeLabel} disabled={busy} onClick={close}/>
      {children}
    </section>
  </div>;
}

export function StatusMessage({ children, kind = 'info', className = '' }: { children: ReactNode; kind?: 'info' | 'error' | 'loading'; className?: string }) {
  return <p role={kind === 'error' ? 'alert' : 'status'} className={`ui-status ${kind} ${className}`} aria-busy={kind === 'loading' || undefined}>
    <Icon name={kind === 'error' ? 'warning' : kind === 'loading' ? 'refresh' : 'info'} size={16} className={kind === 'loading' ? 'is-spinning' : undefined}/><span>{children}</span>
  </p>;
}

export function EmptyState({ icon, title, description, children }: { icon: IconName; title: string; description: string; children?: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Icon name={icon} size={27}/></div><h2>{title}</h2><p>{description}</p>{children}</div>;
}

export function Toast({ message, close, children }: { message: string; close: () => void; children?: ReactNode }) {
  return <div className="toast" role="alert"><Icon name="info"/><span className="toast-message">{message}</span>{children}<IconButton icon="close" label="关闭提示" onClick={close}/></div>;
}

// Player popovers stay inside the fullscreen element and keep focus local without
// making the video inert. Pointer dismissal must not steal focus from its target.
export function Popover({ label, close, children, className = '' }: { label: string; close: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const latestClose = useRef(close);
  latestClose.current = close;
  useLayoutEffect(() => {
    const panel = ref.current!;
    const stage = panel.closest('.video-wrap'), bar = panel.closest('.player-controls');
    const fit = () => {
      if (stage && bar) {
        const compact = stage.getBoundingClientRect().height < 360 && panel.classList.contains('subtitle-popover');
        panel.classList.toggle('is-stage-sheet', compact);
        panel.style.maxHeight = `${Math.max(40, compact ? stage.getBoundingClientRect().height - 24 : bar.getBoundingClientRect().top - stage.getBoundingClientRect().top - 16)}px`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (stage) observer.observe(stage);
    if (bar) observer.observe(bar);
    const trigger = document.activeElement as HTMLElement | null;
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>('button,input,select,[tabindex]')).filter(e => e.tabIndex >= 0 && !e.matches(':disabled') && e.getClientRects().length > 0);
    (controls().find(e => e.matches('select,input')) || controls()[0] || panel).focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('.player-setting > button')) return;
      if (!panel.contains(event.target as Node)) latestClose.current();
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); latestClose.current();
      } else if (event.key === 'Tab') {
        const items = controls(), index = items.indexOf(document.activeElement as HTMLElement);
        if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === items.length - 1) {
          event.preventDefault(); (event.shiftKey ? items.at(-1) || panel : items[0] || panel).focus({ preventScroll: true });
        }
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', keys, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', keys, true);
      if (panel.contains(document.activeElement) && trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return <div ref={ref} tabIndex={-1} className={`setting-popover ${className}`} role="region" aria-label={label} onWheel={event => event.stopPropagation()}>{children}</div>;
}
