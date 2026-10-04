import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorText, json, type Media, type MediaUpdate } from './api';
import { Icon } from './Icon';
import { CoverEditor } from './CoverEditor';
import { StatusMessage } from './ui';
import './media-editor.css';

export function MediaEditor({ media, update, onDirtyChange }: { media: Media; update: (value: MediaUpdate) => void; onDirtyChange: (dirty: boolean) => void }) {
  const [title, setTitle] = useState(media.title);
  const [kind, setKind] = useState(media.kind);
  const [seriesTitle, setSeriesTitle] = useState(media.series_title || media.title);
  const [season, setSeason] = useState(String(media.season ?? ''));
  const [episode, setEpisode] = useState(String(media.episode ?? ''));
  const [rating, setRating] = useState(media.rating == null ? '' : String(media.rating));
  const [tags, setTags] = useState(media.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);
  const mediaKey = JSON.stringify([media.title, media.kind, String(media.season ?? ''), String(media.episode ?? ''), media.rating == null ? '' : String(media.rating), media.tags.join(', '), media.series_title || media.title]);
  const [baseline, setBaseline] = useState(mediaKey);
  const identity = useRef(media.id);
  const dirty = JSON.stringify([title, kind, season, episode, rating, tags, seriesTitle]) !== baseline;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    if (!dirty || window.avhubDesktop) return;
    const leaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', leaving);
    return () => window.removeEventListener('beforeunload', leaving);
  }, [dirty]);

  useEffect(() => {
    // Unrelated full-media responses (favorite/progress/watched) must not replace
    // an editing draft. A new media identity always starts a new draft.
    if (identity.current === media.id && dirty) return;
    identity.current = media.id;
    setTitle(media.title); setKind(media.kind); setSeriesTitle(media.series_title || media.title);
    setSeason(String(media.season ?? '')); setEpisode(String(media.episode ?? ''));
    setRating(media.rating == null ? '' : String(media.rating)); setTags(media.tags.join(', '));
    setBaseline(mediaKey);
  }, [media.id, mediaKey, dirty]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) { setMessageError(true); setMessage('标题不能为空'); return; }
    const seasonNumber = season === '' ? null : Number(season);
    const episodeNumber = episode === '' ? null : Number(episode);
    if (kind === 'episode' && ((seasonNumber !== null && (!Number.isInteger(seasonNumber) || seasonNumber < 0 || seasonNumber > 9999)) || (episodeNumber !== null && (!Number.isInteger(episodeNumber) || episodeNumber < 0 || episodeNumber > 99999)))) {
      setMessageError(true); setMessage('季集号需为非负整数；季 0 表示特别篇，留空表示未设置'); return;
    }
    if(kind === 'episode' && !seriesTitle.trim()){setMessageError(true);setMessage('剧名不能为空');return;}
    const cleanTags = [...new Set(tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))];
    setSaving(true); setMessage(''); setMessageError(false);
    try {
      const value = await api<Media>(`/api/media/${media.id}`, json('PATCH', {
        title: cleanTitle, kind,
        season: kind === 'episode' ? seasonNumber : null,
        episode: kind === 'episode' ? episodeNumber : null,
        rating: rating === '' ? null : Number(rating), tags: cleanTags,
        ...(kind === 'episode' ? {series_title: seriesTitle.trim()} : {}),
      }));
      setTitle(value.title); setKind(value.kind); setSeriesTitle(value.series_title || value.title);
      setSeason(String(value.season ?? '')); setEpisode(String(value.episode ?? ''));
      setRating(value.rating == null ? '' : String(value.rating)); setTags(value.tags.join(', '));
      setBaseline(JSON.stringify([value.title, value.kind, String(value.season ?? ''), String(value.episode ?? ''), value.rating == null ? '' : String(value.rating), value.tags.join(', '), value.series_title || value.title]));
      onDirtyChange(false);
      update(value);
      setMessage('媒体信息已保存');
    } catch (error) { setMessageError(true); setMessage(`保存失败：${errorText(error)}`); }
    finally { setSaving(false); }
  }

  return <details className="media-editor">
    <summary><Icon name="edit" size={16}/>编辑媒体信息</summary>
    <CoverEditor media={media} update={update}/>
    <form onSubmit={event => void save(event)}>
      <fieldset disabled={saving} style={{ display: 'contents', border: 0, margin: 0, padding: 0 }}>
      <label>显示标题<input aria-label="显示标题" value={title} maxLength={300} onChange={event => setTitle(event.target.value)} /></label>
      <label>媒体类型<select aria-label="媒体类型" value={kind} onChange={event => setKind(event.target.value)}>
        <option value="video">未分类视频</option><option value="movie">电影</option><option value="episode">剧集</option>
      </select></label>
      {kind === 'episode' && <div className="episode-fields">
        <label>剧名<input aria-label="剧名" value={seriesTitle} maxLength={300} onChange={event=>setSeriesTitle(event.target.value)}/></label>
        <label>季<input aria-label="季数" type="number" min="0" max="9999" placeholder="未设置" step="1" value={season} onChange={event => setSeason(event.target.value)} /></label>
        <label>集<input aria-label="集数" type="number" min="0" max="99999" placeholder="未设置" step="1" value={episode} onChange={event => setEpisode(event.target.value)} /></label>
      </div>}
      <label>评分<select aria-label="评分" value={rating} onChange={event => setRating(event.target.value)}>
        <option value="">未评分</option>{[0,1,2,3,4,5].map(value => <option key={value} value={value}>{'★'.repeat(value)}（{value} 分）</option>)}
      </select></label>
      <label>标签<input aria-label="标签" value={tags} placeholder="用逗号分隔，例如：科幻, 收藏" onChange={event => setTags(event.target.value)} /></label>
      <button className="ui-button primary" type="submit" disabled={saving}><Icon name="save" size={16}/>{saving ? '正在保存…' : '保存信息'}</button>
      </fieldset>
      {message && <StatusMessage className="editor-message" kind={messageError?'error':'info'}>{message}</StatusMessage>}
    </form>
  </details>;
}
