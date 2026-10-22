import { useEffect, useLayoutEffect, useRef,useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { useModalDialog } from './useModalDialog';
import {Button as PrimitiveButton} from './components/ui/button';

export function Button({ icon, busy = false, variant = 'default', className = '', children, disabled, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName; busy?: boolean; variant?: 'default' | 'primary' | 'danger' }) {
  return <PrimitiveButton {...props} type={type} variant={variant==='primary'?'default':variant==='danger'?'destructive':'outline'} disabled={disabled || busy} aria-busy={busy || undefined} className={`ui-button ${variant === 'primary' ? 'primary' : variant === 'danger' ? 'danger-action' : ''} ${className}`}>
    {(busy || icon) && <Icon name={busy ? 'refresh' : icon!} size={16} className={busy ? 'is-spinning' : undefined}/>} {children}
  </PrimitiveButton>;
}

export function IconButton({ icon, label, className = '', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: IconName; label: string }) {
  return <PrimitiveButton type="button" variant="ghost" size="icon" title={label} aria-label={label} {...props} className={`ui-icon-button ${className}`}><Icon name={icon}/></PrimitiveButton>;
}

export function DialogHeader({id,descriptionId,icon,title,description}:{id:string;descriptionId:string;icon:IconName;title:string;description:string}) {
  return <div className="ui-dialog-header"><h2 id={id} className="dialog-title"><Icon name={icon} size={22}/>{title}</h2>
    <p id={descriptionId} className="dialog-description">{description}</p></div>;
}

export function FieldHint({id,children}:{id?:string;children:ReactNode}) {
  return <small id={id} className="ui-field-hint">{children}</small>;
}

export function Dialog({ label, labelledBy, describedBy, closeLabel, busy, close, className = 'modal', backdropClassName = '', children }: { label?: string; labelledBy?: string; describedBy?:string; closeLabel: string; busy: boolean; close: () => void; className?: string; backdropClassName?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const pointerStartedOutside = useRef(false);
  useModalDialog(ref, busy, close);
  return <div className={`modal-backdrop ${backdropClassName}`} onPointerDown={event => { pointerStartedOutside.current = event.target === event.currentTarget; }} onClick={event => {
    if (pointerStartedOutside.current && event.target === event.currentTarget && !busy) close();
    pointerStartedOutside.current = false;
  }}>
    <section ref={ref} tabIndex={-1} data-slot="dialog" className={className} role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy} aria-describedby={describedBy} aria-busy={busy || undefined}>
      <IconButton className="close" icon="close" label={closeLabel} disabled={busy} onClick={close}/>
      {children}
    </section>
  </div>;
}

export function StatusMessage({ children, kind = 'info', className = '' }: { children: ReactNode; kind?: 'info' | 'error' | 'loading' | 'success'; className?: string }) {
  return <p role={kind === 'error' ? 'alert' : 'status'} className={`ui-status ${kind} ${className}`} aria-busy={kind === 'loading' || undefined}>
    <Icon name={kind === 'error' ? 'warning' : kind === 'loading' ? 'refresh' : kind==='success'?'check':'info'} size={16} className={kind === 'loading' ? 'is-spinning' : undefined}/><span>{children}</span>
  </p>;
}

export function EmptyState({ icon, title, description, children }: { icon: IconName; title: string; description: string; children?: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Icon name={icon} size={27}/></div><h2>{title}</h2><p>{description}</p>{children}</div>;
}

// Content-level feedback; callers retain their own loading delay and retry policy.
export function ContentState({kind,title,description,children}:{kind:'loading'|'empty'|'error';title:string;description?:string;children?:ReactNode}) {
  return <div className={`ui-content-state is-${kind}`} role={kind==='error'?'alert':kind==='loading'?'status':undefined} aria-busy={kind==='loading'||undefined}>
    <Icon name={kind==='loading'?'refresh':kind==='error'?'warning':'library'} size={22} className={kind==='loading'?'is-spinning':undefined}/>
    <div className="ui-content-state-copy"><h3>{title}</h3>{description&&<p>{description}</p>}{children&&<div className="ui-content-state-actions">{children}</div>}</div>
  </div>;
}

export function Toast({ message, close, autoDismissMs = 0, pauseAutoDismiss=false,pauseOnInteraction=false,closeDisabled=false, children }: { message: string; close: () => void; autoDismissMs?: number; pauseAutoDismiss?:boolean;pauseOnInteraction?:boolean;closeDisabled?:boolean; children?: ReactNode }) {
  const [hovered,setHovered]=useState(false),[focused,setFocused]=useState(false);
  const held=pauseAutoDismiss||pauseOnInteraction&&(hovered||focused);
  const latestClose = useRef(close);
  latestClose.current = close;
  useEffect(() => {
    if (autoDismissMs <= 0||held) return;
    const timer = window.setTimeout(() => latestClose.current(), autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [message, autoDismissMs,held]);
  const success=autoDismissMs>0;
  return <div className="toast" data-kind={success?'success':'info'} role={success?'status':'alert'} aria-live={success?'polite':'assertive'} onPointerEnter={()=>{if(pauseOnInteraction)setHovered(true);}} onPointerLeave={()=>setHovered(false)} onFocusCapture={()=>{if(pauseOnInteraction)setFocused(true);}} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false);}}><Icon name={success?'check':'info'}/><span className="toast-message">{message}</span>{children}<IconButton icon="close" label="关闭提示" disabled={closeDisabled} onClick={close}/></div>;
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
      if(panel.closest('[inert]')||event.target instanceof Element&&event.target.closest('.modal-backdrop'))return;
      if (event.target instanceof HTMLElement && event.target.closest('.player-setting > button')) return;
      if (!panel.contains(event.target as Node)) latestClose.current();
    };
    const keys = (event: KeyboardEvent) => {
      if(panel.closest('[inert]'))return;
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
