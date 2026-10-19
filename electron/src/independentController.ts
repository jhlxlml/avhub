/** App-owned native ASS controls. Runs inside MPV, never in an Electron overlay.
 * Fixed commands only; media titles are data, not Lua/ASS or command strings.
 */
export const independentController=String.raw`
local mp = require 'mp'
local utils = require 'mp.utils'
local overlay = mp.create_osd_overlay('ass-events')
overlay.z = 1000
local W,H,scale = 960,540,1
local mx,my,inside = -1,-1,false
local visible,panel,drag,pressed = true,false,nil,nil
local startup = mp.get_time()+1
local toast,capturing=nil,false
local toast_timer=nil
local seek_target,seek_timer=nil,nil
local title = 'AVHub'
local boxes,parts = {},{}
local pending,last_state,cursor_locked = nil,'',false
local last_w,last_h,last_visible,last_toast=nil,nil,nil,false
local accent,white,muted = 'FFBC9B','F4F2F2','CAC3C3'
local request,render
local function num(name,default) return mp.get_property_number(name,default or 0) end
local function flag(name) return mp.get_property_bool(name,false) end
local function clamp(v,a,b) return math.max(a,math.min(b,v)) end
local function safe(value,limit)
    local s=tostring(value or ''):gsub('[%c]',' '):gsub('\\','＼'):gsub('{','｛'):gsub('}','｝')
    local out,n={},0
    for ch in s:gmatch('[%z\1-\127\194-\244][\128-\191]*') do
        n=n+1;if n>(limit or 100) then out[#out+1]='…';break end
        out[#out+1]=ch
    end
    return table.concat(out)
end
local function time(v)
    v=math.max(0,math.floor(v or 0))
    if v>=3600 then return string.format('%d:%02d:%02d',math.floor(v/3600),math.floor(v/60)%60,v%60) end
    return string.format('%02d:%02d',math.floor(v/60),v%60)
end
local function shape(color,alpha,path)
    parts[#parts+1]=string.format('{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H%s&\\1a&H%02X&\\p1}%s{\\p0}',color,alpha or 0,path)
end
local function round(x,y,w,h,r,color,alpha)
    r=math.min(r,w/2,h/2);local k=r*.552285
    shape(color,alpha,string.format('m %f %f l %f %f b %f %f %f %f %f %f l %f %f b %f %f %f %f %f %f l %f %f b %f %f %f %f %f %f l %f %f b %f %f %f %f %f %f',
      x+r,y,x+w-r,y,x+w-r+k,y,x+w,y+r-k,x+w,y+r,x+w,y+h-r,x+w,y+h-r+k,x+w-r+k,y+h,x+w-r,y+h,x+r,y+h,x+r-k,y+h,x,y+h-r+k,x,y+h-r,x,y+r,x,y+r-k,x+r-k,y,x+r,y))
end
local function line(x1,y1,x2,y2,width,color)
    local d=math.sqrt((x2-x1)^2+(y2-y1)^2);if d==0 then return end
    local dx,dy=(y2-y1)/d*width/2,(x1-x2)/d*width/2
    shape(color or white,0,string.format('m %f %f l %f %f %f %f %f %f',x1+dx,y1+dy,x2+dx,y2+dy,x2-dx,y2-dy,x1-dx,y1-dy))
end
local function text(x,y,s,size,color,align)
    parts[#parts+1]=string.format('{\\an%d\\pos(%f,%f)\\fnSegoe UI\\fs%f\\b0\\bord0.7\\3c&H141416&\\shad0\\1c&H%s&}%s',align or 7,x,y,(size or 13)*(W<330 and 1.25 or 1.5),color or white,safe(s,180))
end
local function fit(value,width,size)
    local out,used={},0
    for ch in safe(value,180):gmatch('[%z\1-\127\194-\244][\128-\191]*') do
        local step=(#ch>1 and .95 or .53)*size*1.5
        if used+step>width-16 then out[#out+1]='…';used=used+16;break end
        out[#out+1]=ch;used=used+step
    end
    return table.concat(out),used
end
local function polygon(points,color)
    local p={};for i,v in ipairs(points) do p[#p+1]=string.format('%s %f %f',i==1 and 'm' or 'l',v[1],v[2]) end
    shape(color or white,0,table.concat(p,' '))
end
local function icon(kind,x,y,size,color)
    local s=size/24;color=color or white
    local function L(a,b,c,d) line(x+a*s,y+b*s,x+c*s,y+d*s,1.65*s,color) end
    local function P(p) local q={};for _,v in ipairs(p) do q[#q+1]={x+v[1]*s,y+v[2]*s} end;polygon(q,color) end
    if kind=='play' then P({{8,5},{19,12},{8,19}})
    elseif kind=='pause' then round(x+7*s,y+5*s,3*s,14*s,s,color,0);round(x+14*s,y+5*s,3*s,14*s,s,color,0)
    elseif kind=='close' then L(6,6,18,18);L(18,6,6,18)
    elseif kind=='min' then L(5,12,19,12)
    elseif kind=='max' or kind=='restore' then
        if kind=='restore' then L(8,5,19,5);L(19,5,19,16) end
        local a=kind=='restore' and 4 or 5;local b=kind=='restore' and 16 or 19
        L(a,8,b,8);L(b,8,b,19);L(b,19,a,19);L(a,19,a,8)
    elseif kind=='pin' then L(9,4,17,7);L(11,5,8,12);L(16,7,13,14);L(6,12,14,15);L(6,12,7,15);L(7,15,13,17);L(13,17,14,15);L(10,16,7,22)
    elseif kind=='fullscreen' then L(4,9,4,4);L(4,4,9,4);L(15,4,20,4);L(20,4,20,9);L(20,15,20,20);L(20,20,15,20);L(9,20,4,20);L(4,20,4,15)
    elseif kind=='exit-fullscreen' then L(9,4,9,9);L(9,9,4,9);L(15,4,15,9);L(15,9,20,9);L(20,15,15,15);L(15,15,15,20);L(9,20,9,15);L(9,15,4,15)
    elseif kind=='previous' or kind=='next' then
        if kind=='previous' then L(5,5,5,19);P({{18,5},{7,12},{18,19}}) else L(19,5,19,19);P({{6,5},{17,12},{6,19}}) end
    elseif kind=='camera' then
        L(3,7,8,7);L(8,7,10,4);L(10,4,15,4);L(15,4,17,7);L(17,7,21,7);L(21,7,21,20);L(21,20,3,20);L(3,20,3,7)
        for i=0,15 do local a,b=i*math.pi/8,(i+1)*math.pi/8;L(12+4*math.cos(a),13+4*math.sin(a),12+4*math.cos(b),13+4*math.sin(b)) end
    elseif kind=='volume' or kind=='muted' then
        L(4,9,8,9);L(8,9,13,5);L(13,5,13,19);L(13,19,8,15);L(8,15,4,15);L(4,15,4,9)
        if kind=='muted' then L(17,9,22,15);L(22,9,17,15) else L(17,8,19,10);L(19,10,19,14);L(19,14,17,16);L(20,5,23,9);L(23,9,23,15);L(23,15,20,19) end
    elseif kind=='settings' then
        for _,v in ipairs({{6,3,6,8},{6,12,6,21},{12,3,12,13},{12,17,12,21},{18,3,18,6},{18,10,18,21},{3,10,9,10},{9,15,15,15},{15,8,21,8}}) do L(v[1],v[2],v[3],v[4]) end
    elseif kind=='back' or kind=='forward' then
        local mirror=kind=='forward';local function X(a) return mirror and 24-a or a end
        for i=0,13 do local a,b=(-135+i*21)*math.pi/180,(-135+(i+1)*21)*math.pi/180;L(X(12+8*math.cos(a)),12+8*math.sin(a),X(12+8*math.cos(b)),12+8*math.sin(b)) end
        L(X(3),4,X(3),9);L(X(3),9,X(8),9)
        text(x+12*s,y+12*s,'5',10*s,color,5)
    end
end
local function contains(b) return inside and mx>=b.x and mx<=b.x+b.w and my>=b.y and my<=b.y+b.h end
local function hit()
    for i=#boxes,1,-1 do if contains(boxes[i]) then return boxes[i] end end
end
local function box(id,x,y,w,h,label)
    local b={id=id,x=x,y=y,w=w,h=h,label=label};boxes[#boxes+1]=b;return b
end
local function button(id,x,y,size,label,kind,active)
    local b=box(id,x,y,size,size,label)
    if not visible then return end
    local hover=contains(b)
    round(x,y,size,size,math.min(size/2,12),id=='close' and hover and '5E5EBD' or hover and '393432' or '161414',hover and 24 or 72)
    icon(kind or id,x+(size-21)/2,y+(size-21)/2,21,active and accent or white)
end
local function tracks(kind)
    local list={};for _,t in ipairs(mp.get_property_native('track-list',{})) do if t.type==kind then list[#list+1]=t end end;return list
end
local function track_label(kind)
    local id=mp.get_property_native(kind=='audio' and 'aid' or 'sid')
    for i,t in ipairs(tracks(kind)) do if t.id==id then return safe(t.title or t.lang or ((kind=='audio' and '音轨 ' or '字幕 ')..i),18) end end
    return kind=='sub' and '关闭' or '无音轨'
end
local function layout()
    local w,h=mp.get_osd_size();if not w or not h or w<=0 or h<=0 then return false end
    scale=clamp(h/720,.85,1.6);W,H=w/scale,h/scale
    local pos=mp.get_property_native('mouse-pos',{})
    mx,my=(pos.x or -100)/scale,(pos.y or -100)/scale;inside=pos.hover==true
    return true
end
local function menu_row(id,y,label,value)
    local w=math.min(274,W-36);local x=W-w-18;box(id,x+6,y,w-12,34,label)
    if contains(boxes[#boxes]) then round(x+6,y,w-12,34,8,'393432',30) end
    text(x+18,y+17,label,13,white,4);text(x+w-18,y+17,fit(value,w-110,12),12,accent,6)
end
render=function()
    if pending then pending:kill();pending=nil end;if not layout() then return end
    local hot=inside and (my<58 or my>H-126)
    visible=hot or panel or drag~=nil or mp.get_time()<startup
    local lock=inside and (hot or panel or drag~=nil)
    if lock~=cursor_locked then mp.set_property('cursor-autohide',lock and 'no' or '400');cursor_locked=lock end
    if not visible and not toast and not last_toast and last_visible==false and last_w==W and last_h==H then return end
    parts={};boxes={}
    local size=W<330 and 26 or W<430 and 30 or 38;local gap=W<430 and 4 or 7;local margin=18
    local topSize=32;local topX=W-margin-4*(topSize+5)+5
    box('title',0,0,math.max(0,topX-8),54,'拖动窗口；双击最大化')
    if visible then
        local titleWidth=math.max(0,topX-30)
        if titleWidth>80 then
            local label,used=fit('AVHub · '..title,titleWidth-45,13)
            round(14,12,math.min(titleWidth,used+48),32,10,'161414',72)
            icon('play',21,19,17,accent)
            text(45,28,label,13,white,4)
        end
    end
    button('pin',topX,12,topSize,flag('ontop') and '取消置顶' or '窗口置顶','pin',flag('ontop'))
    button('min',topX+37,12,topSize,'最小化','min')
    button('max',topX+74,12,topSize,flag('window-maximized') and '还原窗口' or '最大化',flag('window-maximized') and 'restore' or 'max')
    button('close',topX+111,12,topSize,'关闭播放','close')
    local y=H-60;local x=margin
    button('play',x,y,size,flag('pause') and '播放 · 空格' or '暂停 · 空格',flag('pause') and 'play' or 'pause');x=x+size+gap
    button('back',x,y,size,'后退 5 秒','back');x=x+size+gap
    button('forward',x,y,size,'前进 5 秒','forward');x=x+size+gap
    button('mute',x,y,size,'静音 · M',flag('mute') and 'muted' or 'volume');x=x+size+gap
    if W>800 then
        box('volume',x,y,90,size,'音量')
        if visible then round(x,y+size/2-2,90,4,2,'F4F2F2',130);round(x,y+size/2-2,clamp(num('volume')/100,0,1)*90,4,2,accent,0);round(x+clamp(num('volume')/100,0,1)*90-4,y+size/2-4,8,8,4,white,0) end
        x=x+105
    end
    button('screenshot',x,y,size,capturing and '正在保存截图…' or '保存截图 · C','camera',capturing)
    local right=W-margin-size
    button('fullscreen',right,y,size,flag('fullscreen') and '退出全屏 · F' or '视频全屏 · F',flag('fullscreen') and 'exit-fullscreen' or 'fullscreen');right=right-size-gap
    button('settings',right,y,size,'播放设置','settings',panel);right=right-size-gap
    if W>365 then button('next',right,y,size,'下一条 · PageDown','next');right=right-size-gap;button('previous',right,y,size,'上一条 · PageUp','previous') end
    local duration,position=num('duration'),drag and drag.id=='timeline' and drag.target or num('time-pos')
    local sy=H-86;box('timeline',margin,sy-11,W-2*margin,22,'播放进度')
    if visible then
        round(margin,sy-3,W-2*margin,6,3,'161414',45)
        round(margin,sy-2,W-2*margin,4,2,'F4F2F2',130)
        local ratio=duration>0 and clamp(position/duration,0,1) or 0
        if ratio>0 then round(margin,sy-2,(W-2*margin)*ratio,4,2,accent,0) end
        round(margin+(W-2*margin)*ratio-5,sy-5,10,10,5,white,0)
        round(margin,sy-36,70,23,7,'161414',65);text(margin+9,sy-24,time(position),12,white,4)
        round(W-margin-70,sy-36,70,23,7,'161414',65);text(W-margin-9,sy-24,time(duration),12,white,6)
        if W>800 then text(W/2,sy-24,'原文件 · 原画',11,muted,5) end
        local target=hit()
        if target and target.id=='timeline' and duration>0 then
            local tx=clamp(mx,margin+40,W-margin-40)
            round(tx-38,sy-66,76,25,8,'161414',25)
            text(tx,sy-54,time(duration*clamp((mx-margin)/(W-margin*2),0,1)),12,white,5)
        end
    end
    if panel and visible then
        local pw=math.min(274,W-36);local px,py=W-pw-18,math.max(8,H-304)
        box('panel',px,py,pw,190,'播放设置')
        round(px,py,pw,190,14,'242020',8)
        menu_row('speed',py+10,'倍速',string.format('%g×',num('speed',1)))
        menu_row('audio',py+44,'音轨',track_label('audio'))
        menu_row('subtitle',py+78,'字幕',track_label('sub'))
        text(px+18,py+129,pw<250 and '延迟' or '字幕延迟',13,white,4)
        box('delay-down',px+pw-146,py+112,26,34,'字幕延迟 − 0.25 秒')
        box('delay-up',px+pw-40,py+112,26,34,'字幕延迟 + 0.25 秒')
        round(px+pw-146,py+116,26,26,7,'393432',20);round(px+pw-40,py+116,26,26,7,'393432',20)
        text(px+pw-133,py+129,'−',13,white,5);text(px+pw-27,py+129,'+',13,white,5)
        text(px+pw-78,py+129,string.format('%+.2fs',num('sub-delay')),11,accent,5)
        menu_row('rotate',py+146,'旋转画面',string.format('%d°',num('video-rotate')))
    end
    local hover=hit()
    if visible and hover and hover.label and hover.id~='timeline' and hover.id~='title' and hover.id~='panel' and not panel and not drag then
        local label=hover.label;local tw=math.min(W-28,math.max(70,#label*5.5))
        local tx=clamp(hover.x+hover.w/2,tw/2+12,W-tw/2-12);local ty=hover.y<60 and 55 or y-31
        round(tx-tw/2,ty,tw,24,8,'161414',16);text(tx,ty+12,label,11,white,5)
    end
    if toast then
        local label,used=fit(toast.text,W-72,13);local tw=math.min(W-36,used+34)
        round((W-tw)/2,66,tw,36,12,'161414',24)
        text(W/2,84,label,13,toast.error and 'A5A5F4' or accent,5)
    end
    local data=table.concat(parts,'\n')
    if overlay.data~=data or last_w~=W or last_h~=H then overlay.res_x=W;overlay.res_y=H;overlay.data=data;overlay:update() end
    last_w,last_h,last_visible,last_toast=W,H,not not visible,toast~=nil
    local state={version=1,visible=not not visible,panel=panel,width=W,height=H,scale=scale,dragging=drag and drag.id or '',capturing=capturing,toast=toast~=nil,buttons=boxes}
    local signature=utils.format_json(state)
    if signature~=last_state then mp.set_property_native('user-data/avhub-ui/layout',state);last_state=signature end
    mp.set_property_native('user-data/avhub-ui/version',1)
end
request=function() if not pending then pending=mp.add_timeout(1/30,render) end end
local function cycle_track(kind)
    local list=tracks(kind);local prop=kind=='audio' and 'aid' or 'sid';local id=mp.get_property_native(prop);local next_id=kind=='sub' and 'no' or nil
    for i,t in ipairs(list) do if t.id==id then next_id=list[i+1] and list[i+1].id or (kind=='sub' and 'no' or list[1].id);break end end
    if next_id==nil or kind=='sub' and (id==false or id=='no' or id==nil) then next_id=list[1] and list[1].id or 'no' end
    if next_id then mp.set_property_native(prop,next_id) end
end
local function seek_to(target)
    local duration=num('duration')
    if duration<=0 or not target or target~=target then return end
    target=clamp(target,0,math.max(0,duration-.01))
    seek_target=target
    if seek_timer then seek_timer:kill() end
    seek_timer=mp.add_timeout(15,function() seek_target=nil;seek_timer=nil end)
    mp.commandv('script-message','avhub','seek-intent',string.format('%.9f',target))
    mp.set_property_number('time-pos',target)
end
mp.register_script_message('seek-relative',function(value)
    local delta=tonumber(value)
    if delta and math.abs(delta)<=120 then seek_to((seek_target or num('time-pos'))+delta) end
end)
mp.register_event('playback-restart',function()
    if seek_target and math.abs(num('time-pos')-seek_target)<=.5 then
        seek_target=nil;if seek_timer then seek_timer:kill();seek_timer=nil end
    end
end)
local function close_native()
    mp.commandv('script-message','avhub','closing')
    mp.commandv('quit')
end
mp.register_script_message('close',close_native)
local function action(id)
    if id=='play' then mp.commandv('cycle','pause')
    elseif id=='back' or id=='forward' then seek_to(num('time-pos')+(id=='back' and -5 or 5))
    elseif id=='mute' then mp.commandv('cycle','mute')
    elseif id=='screenshot' or id=='previous' or id=='next' then if id~='screenshot' or not capturing then mp.commandv('script-message','avhub',id) end
    elseif id=='fullscreen' then mp.commandv('cycle','fullscreen')
    elseif id=='pin' then mp.commandv('cycle','ontop')
    elseif id=='min' then mp.set_property_bool('window-minimized',true)
    elseif id=='max' then if flag('fullscreen') then mp.set_property_bool('fullscreen',false) else mp.commandv('cycle','window-maximized') end
    elseif id=='close' then close_native()
    elseif id=='settings' then panel=not panel
    elseif id=='speed' then
        local values={.5,.75,1,1.25,1.5,2};local index=1
        for i,v in ipairs(values) do if math.abs(v-num('speed',1))<.01 then index=i%#values+1 end end
        mp.set_property_number('speed',values[index])
    elseif id=='audio' then cycle_track('audio')
    elseif id=='subtitle' then cycle_track('sub')
    elseif id=='delay-down' or id=='delay-up' then mp.set_property_number('sub-delay',clamp(num('sub-delay')+(id=='delay-up' and .25 or -.25),-10,10))
    elseif id=='rotate' then mp.set_property_number('video-rotate',(num('video-rotate')+90)%360)
    end
    request()
end
local function update_drag()
    if not drag then return end
    if drag.id=='timeline' then drag.target=num('duration')*clamp((mx-18)/(W-36),0,1)
    elseif drag.id=='volume' then mp.set_property_number('volume',100*clamp((mx-drag.x)/drag.w,0,1)) end
end
mp.add_forced_key_binding('MBTN_LEFT','pointer',function(e)
    layout();if e.canceled then drag=nil;pressed=nil;request();return end
    if e.event=='down' or e.event=='press' then
        render();local b=hit();pressed=b and b.id or 'picture'
        if b and b.id=='title' then if not flag('fullscreen') then mp.commandv('begin-vo-dragging') end;pressed=nil
        elseif b and (b.id=='timeline' or b.id=='volume') then drag={id=b.id,x=b.x,w=b.w,target=0};update_drag()
        elseif panel and (not b or b.id=='picture') then panel=false;pressed=nil end
    end
    if e.event=='up' or e.event=='press' then
        if drag then if drag.id=='timeline' then seek_to(drag.target) end;drag=nil
        else local b=hit();if b and b.id==pressed then action(b.id) end end
        pressed=nil
    end
    request()
end,{complex=true})
mp.add_forced_key_binding('MBTN_LEFT_DBL','double',function()
    layout();local b=hit()
    if b and b.id=='title' then mp.commandv('cycle','window-maximized')
    elseif not b then mp.commandv('cycle','fullscreen') end
end)
mp.add_forced_key_binding('ESC','escape',function() if panel then panel=false else mp.set_property_bool('fullscreen',false) end;request() end)
mp.observe_property('mouse-pos','native',function(_,pos)
    if not pos or not pos.hover then drag=nil;pressed=nil end
    layout();update_drag();request()
end)
for _,name in ipairs({'time-pos','duration','pause','mute','volume','fullscreen','window-maximized','ontop','speed','aid','sid','sub-delay','video-rotate','osd-dimensions'}) do mp.observe_property(name,'native',request) end
mp.register_script_message('title',function(value) title=safe(value,180);request() end)
mp.register_script_message('capture',function(status)
    local labels={pending='正在保存截图…',saved='截图已保存',error='截图未保存，请返回媒体库查看'}
    if not labels[status] then return end
    capturing=status=='pending';toast={text=labels[status],error=status=='error'}
    if toast_timer then toast_timer:kill() end
    if not capturing then toast_timer=mp.add_timeout(status=='error' and 4 or 2,function() toast=nil;request() end) end
    request()
end)
mp.register_event('shutdown',function() if pending then pending:kill() end;if toast_timer then toast_timer:kill() end;if seek_timer then seek_timer:kill() end;overlay:remove() end)
mp.add_timeout(1.05,request)
request()
`;
