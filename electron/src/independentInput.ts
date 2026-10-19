/** Allowlisted native input. No native file opening, watch-later writes,
 * arbitrary console, or screenshots outside the AVHub screenshot service. */
export function independentInput(mouseSeconds:number){
  if(!Number.isInteger(mouseSeconds)||mouseSeconds<1||mouseSeconds>120)throw new Error('鼠标跳播步长无效');
  return `SPACE cycle pause
k cycle pause
LEFT script-message-to avhub_ui seek-relative -5
RIGHT script-message-to avhub_ui seek-relative 5
j script-message-to avhub_ui seek-relative -10
l script-message-to avhub_ui seek-relative 10
UP add volume 5
DOWN add volume -5
m cycle mute
f cycle fullscreen
ESC set fullscreen no
q script-message-to avhub_ui close
Q script-message-to avhub_ui close
c script-message avhub screenshot
s ignore
S ignore
Ctrl+s ignore
C ignore
PGUP script-message avhub previous
PGDWN script-message avhub next
MBTN_BACK script-message-to avhub_ui seek-relative -${mouseSeconds}
MBTN_FORWARD script-message-to avhub_ui seek-relative ${mouseSeconds}
MBTN_LEFT_DBL cycle fullscreen
MBTN_RIGHT cycle pause
WHEEL_UP add volume 2
WHEEL_DOWN add volume -2
r cycle-values video-rotate 0 90 180 270
o show-progress
v cycle sub-visibility
\n`;
}
