import {useEffect,useRef,useState,type RefObject} from 'react';

type Options={phase:string;openSetting:string|null;purePlayback:boolean;videoFullscreen:boolean;isPlaying:boolean;initialVisible:boolean;videoWrap:RefObject<HTMLDivElement|null>;dragging:()=>boolean;onReveal:(visible:boolean)=>void;onHide:()=>void};
// UI-only state machine: never owns playback source, seek, decode or progress.
export function usePlaybackChrome({phase,openSetting,purePlayback,videoFullscreen,isPlaying,initialVisible,videoWrap,dragging,onReveal,onHide}:Options) {
  const [controlsVisible,setControlsVisible]=useState(initialVisible);
  const [cursorVisible,setCursorVisible]=useState(initialVisible);
  const onRevealRef=useRef(onReveal),onHideRef=useRef(onHide);
  onRevealRef.current=onReveal;onHideRef.current=onHide;
  const controlsTimer = useRef<number | null>(null);
  const cursorTimer = useRef<number|null>(null);
  const controlsHovered = useRef(false);
  const windowControlsHovered = useRef(false);
  const controlsPressed = useRef(false);
  const controlsKeyboardFocus = useRef(false);
  const controlsIdleDelay = useRef(180);
  useEffect(()=>{
    document.documentElement.classList.toggle('controls-visible',controlsVisible);
    return()=>document.documentElement.classList.remove('controls-visible');
  },[controlsVisible]);
  useEffect(()=>{
    document.documentElement.classList.toggle('player-cursor-hidden',!cursorVisible);
    return()=>document.documentElement.classList.remove('player-cursor-hidden');
  },[cursorVisible]);
  useEffect(()=>{
    scheduleCursorHide();
    return()=>{if(cursorTimer.current!==null)window.clearTimeout(cursorTimer.current);};
  },[phase,openSetting,purePlayback]);
  useEffect(() => {
    if (controlsTimer.current !== null) window.clearTimeout(controlsTimer.current);
    controlsTimer.current=null;
    // Playback events (including keyboard pause/resume and seek completion)
    // must not reveal controls. Only explicit interaction/menu focus does so.
    if(openSetting) {setControlsVisible(true);return;}
    if (controlsVisible) scheduleControlsHide(controlsIdleDelay.current);
  }, [videoFullscreen, purePlayback, phase, isPlaying, openSetting,controlsVisible]);
  useEffect(()=>{
    if(!purePlayback && windowControlsHovered.current) {
      windowControlsHovered.current=false;
      if(!controlsHovered.current)hideControlsSoon();
    }
    const move=(event:MouseEvent)=>{
      if(purePlayback && (event.target as HTMLElement)?.closest?.('.desktop-titlebar')) {
        windowControlsHovered.current=true;
        controlsIdleDelay.current=180;revealControls();
      } else if(windowControlsHovered.current) {
        windowControlsHovered.current=false;
        if(!controlsHovered.current)hideControlsSoon();
        scheduleCursorHide();
      }
    };
    const down=(event:PointerEvent)=>{
      if(purePlayback && (event.target as HTMLElement)?.closest?.('.desktop-titlebar')) {
        controlsPressed.current=true;revealControls();
      }
    };
    const released=()=>{
      if(!controlsPressed.current)return;
      controlsPressed.current=false;
      scheduleControlsHide(controlsIdleDelay.current);
      scheduleCursorHide();
    };
    const left=()=>{windowControlsHovered.current=false;hideControlsSoon();};
    document.addEventListener('mousemove',move);
    document.addEventListener('pointerdown',down);
    document.addEventListener('mouseleave',left);
    window.addEventListener('pointerup',released);
    window.addEventListener('pointercancel',released);
    return()=>{
      document.removeEventListener('mousemove',move);document.removeEventListener('pointerdown',down);
      document.removeEventListener('mouseleave',left);
      window.removeEventListener('pointerup',released);window.removeEventListener('pointercancel',released);
    };
  },[purePlayback,phase,openSetting,controlsVisible]);
  useEffect(()=>()=>{
    if(controlsTimer.current!==null)clearTimeout(controlsTimer.current);
    if(cursorTimer.current!==null)clearTimeout(cursorTimer.current);
  },[]);
  function scheduleControlsHide(delay:number) {
    if (controlsTimer.current !== null) window.clearTimeout(controlsTimer.current);
    controlsTimer.current=null;
    // Stationary hover is still interaction: preserve controls until the
    // pointer leaves, in both playing and paused states.
    if (controlsHovered.current || windowControlsHovered.current || phase !== 'ready' || openSetting || controlsPressed.current) return;
    controlsTimer.current=window.setTimeout(()=>{
      controlsTimer.current=null;
      if(!controlsHovered.current && !windowControlsHovered.current && !controlsPressed.current && !(controlsKeyboardFocus.current && videoWrap.current?.querySelector('.player-controls :focus-visible'))) {
        setControlsVisible(false);onHideRef.current();
      }
    },delay);
  }
  function scheduleCursorHide() {
    if(cursorTimer.current!==null)window.clearTimeout(cursorTimer.current);
    cursorTimer.current=null;
    if(phase!=='ready' || openSetting || controlsHovered.current || windowControlsHovered.current || controlsPressed.current || dragging())return;
    cursorTimer.current=window.setTimeout(()=>{
      cursorTimer.current=null;
      if(!controlsHovered.current && !windowControlsHovered.current && !controlsPressed.current && !dragging())setCursorVisible(false);
    },400);
  }
  function revealCursor() {
    setCursorVisible(true);scheduleCursorHide();
  }
  function revealControls() {
    revealCursor();
    onRevealRef.current(controlsVisible);
    setControlsVisible(true);
    scheduleControlsHide(controlsIdleDelay.current);
  }
  function hideControlsSoon() {
    controlsHovered.current=false;
    scheduleCursorHide();
    if(phase!=='ready' || openSetting || controlsPressed.current || windowControlsHovered.current)return;
    if (controlsTimer.current !== null) window.clearTimeout(controlsTimer.current);
    controlsTimer.current=null;
    setControlsVisible(false);onHideRef.current();
  }
  function trackControlsMouse(event:React.MouseEvent<HTMLDivElement>) {
    controlsKeyboardFocus.current=false;
    controlsIdleDelay.current=180;
    const wrap=videoWrap.current,bar=wrap?.querySelector<HTMLElement>('.player-controls');
    if(!wrap || !bar)return;
    const bounds=wrap.getBoundingClientRect();
    // Hidden controls reject pointer events. Use their untransformed bottom
    // hot zone so mouse movement can always bring them back without flashing
    // controls while the pointer moves over the picture.
    const over=Boolean((event.target as HTMLElement).closest('.player-controls')) ||
      (event.clientY>=bounds.bottom-bar.offsetHeight && event.clientY<=bounds.bottom &&
       event.clientX>=bounds.left && event.clientX<=bounds.right);
    controlsHovered.current=over;
    revealCursor();
    if(over)revealControls();else hideControlsSoon();
  }
  return {controlsVisible,cursorVisible,controlsHovered,controlsPressed,controlsKeyboardFocus,controlsIdleDelay,revealControls,hideControlsSoon,trackControlsMouse,scheduleControlsHide,scheduleCursorHide};
}
