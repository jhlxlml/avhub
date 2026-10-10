import { useLayoutEffect, useRef, type RefObject } from 'react';

export function useModalDialog(ref: RefObject<HTMLElement | null>, busy: boolean, close: () => void) {
  const latest = useRef({ busy, close });
  latest.current = { busy, close };
  // Bind keyboard/focus guards in the same commit that makes a dialog visible.
  // A fast Escape must not land between DOM insertion and a passive effect.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const hidden: { element: HTMLElement; inert: boolean }[] = [];
    let branch: HTMLElement = dialog.closest('.modal-backdrop') as HTMLElement || dialog;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement && !sibling.classList.contains('desktop-titlebar') && !['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) {
          hidden.push({ element: sibling, inert: sibling.inert }); sibling.inert = true;
        }
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
    const scrollers = [document.documentElement, document.body, document.getElementById('app-scroll-area')].filter((e): e is HTMLElement => Boolean(e));
    const overflow = scrollers.map(element => ({ element, value: element.style.overflow }));
    scrollers.forEach(element => { element.style.overflow = 'hidden'; });
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') && element.getClientRects().length > 0);
    const focusFirst = () => {
      const elements = focusable();
      (elements.find(element => element.matches('input:not([type="file"]),select,textarea')) || elements[0] || dialog).focus({ preventScroll: true });
    };
    focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if(dialog.closest('[inert]'))return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!latest.current.busy) latest.current.close();
      } else if (event.key === 'Tab') {
        const elements = focusable();
        const index = elements.indexOf(document.activeElement as HTMLElement);
        if (!elements.length || index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === elements.length - 1) {
          event.preventDefault();
          (event.shiftKey ? elements.at(-1) || dialog : elements[0] || dialog).focus({ preventScroll: true });
        }
      }
    };
    const focusin = (event: FocusEvent) => {
      if(dialog.closest('[inert]'))return;
      const target=event.target;
      if(target instanceof Element&&target.closest('.desktop-titlebar'))return;
      if (!dialog.contains(target as Node)) focusFirst();
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusin);
      hidden.forEach(({ element, inert }) => { element.inert = inert; });
      overflow.forEach(({ element, value }) => { element.style.overflow = value; });
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
    };
  }, [ref]);
}
