// Desktop titlebar is outside the page's scroll viewport. Browsers keep their
// normal document scrolling; navigation uses the matching scroll owner.
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
