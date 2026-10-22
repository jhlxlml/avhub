import {
  Play,Pause,Rewind,FastForward,RotateCw,Volume2,VolumeX,Scan,PictureInPicture2,PictureInPicture,
  Maximize,Minimize,Expand,Star,Hd,Gauge,AudioLines,Camera,X,Search,Settings2,RefreshCw,
  LayoutGrid,Film,Clapperboard,History,Clock3,ListVideo,SlidersHorizontal,List,Folder,
  FolderOpen,ChevronDown,ChevronRight,ChevronLeft,ChevronUp,Plus,Check,Eye,EyeOff,Copy,
  ExternalLink,Trash2,SquarePen,Download,Upload,Save,ShieldCheck,Database,SkipBack,
  SkipForward,ChevronsLeft,ChevronsRight,Info,TriangleAlert,ArrowLeft,Captions,Ellipsis,
  SquarePlay,PanelLeftClose,Pin,Minus,Square,Sun,Moon,GalleryHorizontalEnd,Shuffle,ArrowRight,
  ArrowDownWideNarrow,ArrowUpNarrowWide,CircleHelp,Keyboard,Monitor,Mouse,ChevronsDownUp,Activity,
} from 'lucide-react';

// One offline, tree-shaken family. Stable names are shared by both playback engines.
const icons={
  play:Play,pause:Pause,back:Rewind,forward:FastForward,volume:Volume2,muted:VolumeX,
  rotate:RotateCw,zoomReset:Scan,pip:PictureInPicture2,exitPip:PictureInPicture,
  fullscreen:Maximize,fullscreenExit:Minimize,expand:Expand,favorite:Star,quality:Hd,
  speed:Gauge,audio:AudioLines,camera:Camera,close:X,search:Search,settings:Settings2,
  refresh:RefreshCw,library:LayoutGrid,film:Film,series:Clapperboard,continue:Clock3,
  history:History,playlist:ListVideo,filter:SlidersHorizontal,grid:LayoutGrid,list:List,
  folder:Folder,reveal:FolderOpen,chevronDown:ChevronDown,chevronRight:ChevronRight,
  chevronLeft:ChevronLeft,chevronUp:ChevronUp,plus:Plus,check:Check,eye:Eye,eyeOff:EyeOff,
  copy:Copy,external:ExternalLink,trash:Trash2,edit:SquarePen,download:Download,upload:Upload,
  save:Save,shield:ShieldCheck,database:Database,previous:SkipBack,next:SkipForward,
  first:ChevronsLeft,last:ChevronsRight,info:Info,warning:TriangleAlert,arrowLeft:ArrowLeft,arrowRight:ArrowRight,
  subtitles:Captions,more:Ellipsis,purePlayback:SquarePlay,exitPurePlayback:PanelLeftClose,
  pin:Pin,minimize:Minus,windowMaximize:Square,windowRestore:Copy,sun:Sun,moon:Moon,
  coverSize:GalleryHorizontalEnd,shuffle:Shuffle,sortAsc:ArrowUpNarrowWide,
  sortDesc:ArrowDownWideNarrow,help:CircleHelp,keyboard:Keyboard,resolution:Monitor,mouse:Mouse,collapseAll:ChevronsDownUp,activity:Activity,
} as const;
export type IconName=keyof typeof icons;
export function Icon({name,size=18,filled=false,className=''}:{name:IconName;size?:number;filled?:boolean;className?:string}) {
  const Glyph=icons[name];
  return <Glyph className={`ui-icon ${className}`} aria-hidden="true" focusable="false" size={size}
    strokeWidth={1.75} fill={filled||name==='play'?'currentColor':'none'}/>;
}
