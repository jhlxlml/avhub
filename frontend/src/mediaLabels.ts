export const formatLabel = (extension: string) => extension.replace(/^\./, '').toUpperCase() || '未知格式';
export const resolutionLabel = (width?: number, height?: number) => width && height ? `${width}×${height}` : '分辨率未知';
export const episodeLabel = ({ season, episode }: { season?: number; episode?: number }) => `${season === 0 ? '特别篇' : season != null ? `第 ${season} 季` : '季未设置'} · ${episode != null ? `第 ${episode} 集` : '集未设置'}`;
