/** Engine-independent keyboard policy. Focus belongs to editing/menu controls;
 * pointer-focused playback sliders keep player shortcuts, Tab keeps native arrows.
 * This only describes intent: each engine owns execution and readiness checks. */
export function playerShortcutTarget(event:KeyboardEvent, pointerRange:Element|null, keyboardNavigation:boolean) {
  if(event.defaultPrevented||event.isComposing||event.keyCode===229||event.ctrlKey||event.altKey||event.metaKey)return false;
  const target=event.target;
  if(!(target instanceof HTMLElement))return true;
  if(target.isContentEditable||target.closest('[role="menu"],[role="dialog"],.setting-popover'))return false;
  if(target.matches('input[type=range]')) {
    if(!target.closest('.player-controls,.native-controls'))return false;
    return !event.code.startsWith('Arrow')||pointerRange===target;
  }
  if(target.closest('input,select,textarea'))return false;
  if(event.code==='Space'&&(target.closest('summary')||keyboardNavigation&&target.closest('button')))return false;
  return true;
}

export function playbackKeyIntent(event:Pick<KeyboardEvent,'code'|'shiftKey'>) {
  if(event.code==='KeyC'&&event.shiftKey)return null;
  const intents:Record<string,string>={Space:'pause',KeyK:'pause',KeyJ:'back10',KeyL:'forward10',ArrowLeft:'back5',ArrowRight:'forward5',ArrowUp:'volumeUp',ArrowDown:'volumeDown',KeyM:'mute',KeyR:'rotate',KeyC:'screenshot',KeyF:'fullscreen',KeyW:'pure',KeyN:'next',KeyP:'pip',Escape:'escape'};
  return intents[event.code]??null;
}
