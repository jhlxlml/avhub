import { useId } from 'react';
import { Icon } from './Icon';
import {FieldHint} from './ui';
import { changeAutoplay, useAutoplay, type QueueMode, type QueueScope } from './autoplay';
import {SettingToggle} from './SettingToggle';

export function AutoplaySettings({busy}:{busy:boolean}) {
  const hintId=useId();
  const {enabled,mode,scope}=useAutoplay();
  return <section className="settings-section autoplay-settings" aria-label="视频连播设置">
    <h3><Icon name="playlist"/>视频连播</h3>
    <SettingToggle label="视频连播" disabled={busy} checked={enabled} onChange={enabled=>changeAutoplay({enabled})}
      description="结束后提供 8 秒可取消倒计时；关闭后播放结束即停。">播放结束自动播放下一条</SettingToggle>
    <div className="autoplay-fields">
      <label>连播模式<select aria-label="连播模式" aria-describedby={hintId} disabled={busy} value={mode} onChange={event=>changeAutoplay({mode:event.target.value as QueueMode})}>
        <option value="sequential">顺序播放</option><option value="random">随机播放</option><option value="repeat-one">单条循环</option>
      </select></label>
      <label>连播范围<select aria-label="连播范围" aria-describedby={hintId} disabled={busy} value={scope} onChange={event=>changeAutoplay({scope:event.target.value as QueueScope})}>
        <option value="series">同一剧集（默认）</option><option value="directory">同一目录</option>
      </select></label>
    </div>
    <FieldHint id={hintId}>同一剧集按季、集排序，播完即停；未归类视频使用同目录，不含子目录。从播放列表打开时以该列表为准。</FieldHint>
    <FieldHint>设置自动保存；普通播放队列会更新全局偏好，片单队列的调整仅本次播放有效。</FieldHint>
  </section>;
}
