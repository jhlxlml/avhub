// Desktop titlebar is outside the page viewport. Explicit component harnesses
// without a native shell use document scrolling to verify shared layout only.
function desktopScroller() {
  return window.avhubDesktop?document.getElementById('app-scroll-area'):null;
}
export function pageScrollTop() {
  return desktopScroller()?.scrollTop??window.scrollY;
}
export function scrollPageTo(top:number) {
  const scroller=desktopScroller();
  if(scroller)scroller.scrollTo(0,top);else window.scrollTo(0,top);
}
