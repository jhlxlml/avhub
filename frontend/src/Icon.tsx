export type IconName = 'play'|'pause'|'back'|'forward'|'volume'|'muted'|'rotate'|'zoomReset'|'pip'|'exitPip'|'fullscreen'|'fullscreenExit'|'expand'|'favorite'|'quality'|'speed'|'audio'|'camera'|'close'|'search'|'settings'|'refresh'|'library'|'film'|'series'|'continue'|'history'|'playlist'|'filter'|'grid'|'list'|'folder'|'chevronDown'|'chevronRight'|'chevronLeft'|'chevronUp'|'plus'|'check'|'eye'|'eyeOff'|'copy'|'reveal'|'external'|'trash'|'edit'|'download'|'upload'|'save'|'shield'|'database'|'previous'|'next'|'first'|'last'|'info'|'warning'|'arrowLeft'|'subtitles'|'more'
  |'purePlayback'|'exitPurePlayback'|'pin'|'minimize'|'windowMaximize'|'windowRestore'|'sun'|'moon'|'coverSize';

// One 24px grid, one optical stroke and rounded joins across every surface.
// Code-native SVGs remain fully offline and inherit the control's state color.
export function Icon({name,size=18,filled=false,className=''}:{name:IconName;size?:number;filled?:boolean;className?:string}) {
  return <svg className={`ui-icon ${className}`} aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {name==='play' && <path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>}
    {name==='pause' && <><path d="M8 5v14M16 5v14" strokeWidth="3.6"/></>}
    {name==='back' && <><path d="M7 4v5H2"/><path d="M3 9a9 9 0 1 1 .7 8"/><path d="M10 10v5m3-5h2v5h-2z" strokeWidth="1.3"/></>}
    {name==='forward' && <><path d="M17 4v5h5"/><path d="M21 9a9 9 0 1 0-.7 8"/><path d="M10 10v5m3-5h2v5h-2z" strokeWidth="1.3"/></>}
    {name==='volume' && <><path d="m11 5-5 4H3v6h3l5 4z"/><path d="M15 9a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/></>}
    {name==='muted' && <><path d="m11 5-5 4H3v6h3l5 4z"/><path d="m16 9 5 6m0-6-5 6"/></>}
    {name==='rotate' && <><path d="M20 10A8 8 0 0 0 6 6L3 9m0-5v5h5M4 14a8 8 0 0 0 14 4l3-3m0 5v-5h-5"/></>}
    {name==='zoomReset' && <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M7.5 10.5h6M4 4v4h4"/></>}
    {(name==='pip'||name==='exitPip') && <><rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="11" width="6" height="5" rx=".8" fill={name==='pip'?'currentColor':'none'}/>{name==='exitPip'&&<path d="m8 10-3-3m0 0v3m0-3h3"/>}</>}
    {(name==='fullscreen'||name==='expand') && <path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>}
    {name==='fullscreenExit' && <><path d="M4 9h5V4"/><path d="M15 4v5h5"/><path d="M4 15h5v5"/><path d="M15 20v-5h5"/></>}
    {name==='favorite' && <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z" fill={filled?'currentColor':'none'}/>}
    {name==='quality' && <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9v6m4-6v6M7 12h4m4-3v6h2a3 3 0 0 0 0-6z" strokeWidth="1.4"/></>}
    {name==='speed' && <><path d="M4 18a9 9 0 1 1 16 0M12 13l4-4"/><circle cx="12" cy="13" r="1" fill="currentColor"/></>}
    {name==='audio' && <path d="M4 10v4m4-7v10m4-13v16m4-13v10m4-7v4"/>}
    {name==='camera' && <><path d="m8 6 1.5-2h5L16 6h4a1 1 0 0 1 1 1v12H3V7a1 1 0 0 1 1-1z"/><circle cx="12" cy="12" r="3.5"/></>}
    {name==='close' && <path d="m6 6 12 12M6 18 18 6"/>}
    {name==='more' && <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>}
    {name==='search' && <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>}
    {name==='settings' && <><path d="m9 3-.6 2.3-2 .9-2.1-.7-2 3.5 1.6 1.6v2.8L2.3 15l2 3.5 2.1-.7 2 .9L9 21h6l.6-2.3 2-.9 2.1.7 2-3.5-1.6-1.6v-2.8l1.6-1.6-2-3.5-2.1.7-2-.9L15 3z"/><circle cx="12" cy="12" r="3"/></>}
    {name==='refresh' && <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.4 8A7.5 7.5 0 0 1 18 6l2 3M4 15l2 3a7.5 7.5 0 0 0 12.6-2"/></>}
    {(name==='library'||name==='grid') && <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>}
    {name==='film' && <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18m10-18v18M3 8h4m-4 8h4m10-8h4m-4 8h4M7 12h10"/></>}
    {name==='series' && <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M7 3h10m-12 2h14m-9 6 5 3-5 3z"/></>}
    {(name==='continue'||name==='history') && <><path d="M3 10a9 9 0 1 1 1.3 7M3 4v6h6"/>{name==='history'?<path d="M12 7v5l3 2"/>:<path d="m11 8 5 4-5 4z" fill="currentColor" stroke="none"/>}</>}
    {(name==='playlist'||name==='list') && <><path d="M8 5h13M8 12h13M8 19h9M3 5h.01M3 12h.01M3 19h.01" strokeWidth={name==='list'?1.7:1.9}/>{name==='playlist'&&<path d="m19 16 3 3-3 3"/>}</>}
    {name==='filter' && <><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="var(--ui-surface)"/><circle cx="16" cy="12" r="2" fill="var(--ui-surface)"/><circle cx="10" cy="18" r="2" fill="var(--ui-surface)"/></>}
    {(name==='folder'||name==='reveal') && <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>{name==='reveal'&&<path d="m10 11 4 3-4 3"/>}</>}
    {name==='chevronDown' && <path d="m6 9 6 6 6-6"/>}
    {name==='chevronRight' && <path d="m9 6 6 6-6 6"/>}
    {name==='chevronLeft' && <path d="m15 6-6 6 6 6"/>}
    {name==='chevronUp' && <path d="m6 15 6-6 6 6"/>}
    {name==='plus' && <path d="M12 5v14M5 12h14"/>}
    {name==='check' && <path d="m5 12 4 4L19 6"/>}
    {(name==='eye'||name==='eyeOff') && <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>{name==='eyeOff'&&<path d="m3 3 18 18"/>}</>}
    {name==='copy' && <><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>}
    {name==='external' && <><path d="M14 3h7v7m0-7L10 14M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6"/></>}
    {name==='trash' && <><path d="M3 6h18M9 6V3h6v3m-10 0 1 15h12l1-15M10 10v7m4-7v7"/></>}
    {name==='edit' && <><path d="m14 5 5 5M4 20l5-1L21 7l-4-4L5 15z"/></>}
    {name==='download' && <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>}
    {name==='upload' && <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>}
    {name==='save' && <><path d="M3 3h14l4 4v14H3zM7 3v6h10V3M7 21v-7h10v7"/></>}
    {name==='shield' && <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></>}
    {name==='database' && <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></>}
    {name==='previous' && <><path d="M5 5v14m13-14L7 12l11 7z" fill="currentColor"/></>}
    {name==='next' && <><path d="M19 5v14M6 5l11 7-11 7z" fill="currentColor"/></>}
    {name==='first' && <path d="M5 5v14m13-13-6 6 6 6"/>}
    {name==='last' && <path d="M19 5v14M6 6l6 6-6 6"/>}
    {name==='info' && <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></>}
    {name==='warning' && <><path d="m12 3 10 18H2zM12 9v5m0 3h.01"/></>}
    {name==='arrowLeft' && <path d="M20 12H4m6-6-6 6 6 6"/>}
    {name==='subtitles' && <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M6 12h4m3 0h5M6 15h7m3 0h2"/></>}
    {(name==='purePlayback'||name==='exitPurePlayback') && <><rect x="3" y="4" width="18" height="16" rx="2"/>{name==='purePlayback'?<path d="m10 8 6 4-6 4z" fill="currentColor" stroke="none"/>:<path d="M8 4v16M12 12h6m-3-3 3 3-3 3"/>}</>}
    {name==='pin' && <g transform="rotate(35 12 12)"><path d="M9 3h6l-1 7 4 4v2H6v-2l4-4z" fill={filled?'currentColor':'none'}/><path d="M12 16v5"/></g>}
    {name==='minimize' && <path d="M5 12h14"/>}
    {name==='windowMaximize' && <rect x="5" y="5" width="14" height="14" rx="1"/>}
    {name==='windowRestore' && <><path d="M9 7V4h11v11h-3"/><rect x="4" y="9" width="11" height="11" rx="1"/></>}
    {name==='sun' && <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>}
    {name==='moon' && <path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14z"/>}
    {name==='coverSize' && <><rect x="3" y="3" width="12" height="9" rx="1.5"/><path d="M5 7h8m-2 8h10m-3-3 3 3-3 3M3 16v5h8"/></>}
  </svg>;
}
