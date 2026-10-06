export type Track = { index: number; codec: string; language: string; title: string };
export type VideoColor = { version?:number; pix_fmt?:string; bit_depth?:number; transfer?:string; primaries?:string; matrix?:string; range?:string; hdr?:string|null; dynamic_hdr?:boolean; dolby_vision_profile?:number|null };
export type PlaybackColor = { source:VideoColor; label:string; warning:string };
export type ExternalSubtitle = { name: string; path: string };
export type Media = {
  id: number; name: string; title: string; kind: string; season?: number; episode?: number;
  ext: string; duration: number; width?: number; height?: number; video_codec?: string;
  size?:number|null;
  thumbnail_url?: string; favorite: boolean | number; progress: number; watched: boolean | number;
  missing?: boolean | number;
  manual_watched?:number|null;
  playlist_index?: number; playlist_position?: number; previous_item_id?: number | null; next_item_id?: number | null;
  video_color?:VideoColor;
  series_id?:number|null;series_title?:string|null;custom_cover?:string|null;
  path: string; root_id: number; audio_tracks: Track[]; subtitles: Track[]; external_subtitles?: ExternalSubtitle[]; tags: string[]; last_played?: number; rating?: number | null;
};
export type Root = { id: number; path: string; available: boolean | null; relocated?: number };
export type MediaPage = { items: Media[]; total: number; page: number; page_size: number; pages: number };
export type FolderPage = { folder: string; items: { name: string; folder: string; count: number;has_children?:boolean }[]; total: number; video_count: number; direct_count: number; page: number; pages: number };
export type SiblingPage = MediaPage & { index: number; previous: Media | null; next: Media | null };
export type Playlist = { id: number; name: string; count: number };
export type PlaylistDetail = Playlist & { items: Media[]; created_at: number };
export type PlaylistSource = { id: number; name: string };
export type PlaylistPage = PlaylistDetail & MediaPage & { playable_count: number; revision: number; total_duration?:number; cover_media?:Pick<Media,'id'|'title'|'thumbnail_url'>|null };
export type QueuePage = SiblingPage & { count?: number; playable_count?:number; name?: string; current?: Media; revision?: number; current_id?:number; requested_scope?:'series'|'directory'; scope?:'series'|'directory' };
export type MediaUpdate = Partial<Media> & { id: number };
export type View = 'all' | 'movies' | 'series' | 'continue' | 'favorites' | 'history';
export const views: { id: View; label: string }[] = [
  { id: 'all', label: '全部视频' }, { id: 'movies', label: '电影' }, { id: 'series', label: '剧集' },
  { id: 'continue', label: '继续观看' }, { id: 'favorites', label: '收藏' }, { id: 'history', label: '观看历史' },
];
export const SERVICE_MISMATCH = '本地服务与网页版本不匹配，请完全退出并重新启动 AVHub';
export const CLIENT_BUILD = __AVHUB_BUILD__;
export let rendererTest=false;
export async function checkServiceBuild() {
  const health = await api<{ api_protocol?:number; build_id?:string;renderer_test?:boolean }>('/api/health');
  if (health.api_protocol !== CLIENT_BUILD.api_protocol || health.build_id !== CLIENT_BUILD.build_id)
    throw new Error(`${SERVICE_MISMATCH}；网页 ${CLIENT_BUILD.build_id} / 服务 ${health.build_id ?? '旧服务'}。开发模式请先执行 npm run build 再重启服务`);
  rendererTest=health.renderer_test===true;
  if(!window.avhubDesktop&&!rendererTest)throw new Error('AVHub 仅支持桌面版，请使用启动AVHub.bat、npm run dev 或便携 EXE 打开应用');
}
export const isJsonResponse = (response: Response) => /(?:^|\/)json(?:\s*;|$)|\+json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '');
export const isHtmlResponse = (response: Response) => /(?:text\/html|application\/xhtml\+xml)/i.test(response.headers.get('content-type') ?? '');
export async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (isHtmlResponse(response) || /^\s*(?:<!doctype\s+html|<html\b)/i.test(body) || !isJsonResponse(response)) {
    throw new Error(SERVICE_MISMATCH);
  }
  try { return JSON.parse(body) as T; }
  catch { throw new Error('本地服务返回了无法识别的数据，请完全退出并重新启动 AVHub'); }
}
export type ApiOptions = RequestInit & { timeoutMs?: number };
export function requestDeadline(url: string, options?: ApiOptions): number {
  if (options?.timeoutMs !== undefined) return options.timeoutMs;
  if (/\/pick(?:\?|$)/.test(url)) return 0; // Native folder picker waits for the user.
  if (/\/backup/.test(url)) return 120000;
  if (/\/playback$/.test(url)) return 120000;
  if (/\/subtitles/.test(url)) return 35000;
  if (/\/screenshot(?:\?|$)/.test(url)) return 120000;
  return options?.method && options.method !== 'GET' ? 20000 : 15000;
}
export async function request<T>(url: string, options: ApiOptions | undefined, consume: (response: Response) => Promise<T>): Promise<T> {
  const { timeoutMs: _timeoutMs, ...init } = options ?? {};
  const controller = new AbortController();
  const cancel = () => controller.abort(options?.signal?.reason);
  const deadline = requestDeadline(url, options);
  let timedOut = false;
  const timer = deadline > 0 ? globalThis.setTimeout(() => { timedOut = true; controller.abort(); }, deadline) : undefined;
  if (options?.signal?.aborted) cancel();
  else options?.signal?.addEventListener('abort', cancel, { once: true });
  try { return await consume(await fetch(url, { ...init, signal: controller.signal })); }
  catch (error) {
    if (options?.signal?.aborted) throw error;
    if (timedOut) throw new Error(`本地服务响应超时${init.method && init.method !== 'GET' ? '，操作可能已提交，请刷新确认后再重试' : '，请稍后重试或查看运行诊断'}`);
    if (error instanceof TypeError) throw new Error('无法连接本地服务，请确认 AVHub 正在运行后重试');
    throw error;
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
    options?.signal?.removeEventListener('abort', cancel);
  }
}
export async function api<T>(url: string, options?: ApiOptions): Promise<T> {
  return request(url, options, async r => {
  const isJson = isJsonResponse(r);
  if (!r.ok) {
    let data: any = null;
    let parseError: unknown;
    if (isJson) { try { data = await readJson<unknown>(r); } catch (error) { parseError = error; } }
    if (parseError instanceof Error && parseError.message === SERVICE_MISMATCH) throw parseError;
    throw new Error(typeof data?.detail === 'string' ? data.detail :
      r.status === 405 || !isJson ? SERVICE_MISMATCH : `请求失败（${r.status}），请稍后重试`);
  }
  // A missing FastAPI API route may fall through to the SPA document, sometimes
  // with a misleading JSON content type. Validate both the header and body.
  return readJson<T>(r);
  });
}
export const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
export function duration(seconds = 0) {
  const n = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${n >= 3600 ? Math.floor(n / 3600) + ':' : ''}${String(Math.floor(n % 3600 / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
export const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';
