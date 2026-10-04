import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const build = JSON.parse(readFileSync('app/build-info.json', 'utf8'));
const localProxy = (): ProxyOptions => ({
  target: 'http://127.0.0.1:8765', changeOrigin: true,
  configure: proxy => {
    proxy.on('proxyReq', (proxyReq, req) => {
      // Rewrite only our fixed loopback development page, never a foreign site.
      if (['http://127.0.0.1:5173', 'http://localhost:5173'].includes(req.headers.origin || ''))
        proxyReq.setHeader('Origin', 'http://127.0.0.1:8765');
    });
  },
});
export default defineConfig({ define: { __AVHUB_BUILD__: JSON.stringify(build) }, plugins: [react()], root: 'frontend', build: { outDir: '../app/static', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    headers: { 'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'", 'X-Frame-Options': 'DENY' },
    proxy: { '/api': localProxy(), '/media': localProxy(), '/thumbs': localProxy() } } });
