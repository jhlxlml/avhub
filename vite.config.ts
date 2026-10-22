import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const build = JSON.parse(readFileSync('app/build-info.json', 'utf8'));
export default defineConfig({ define: { __AVHUB_BUILD__: JSON.stringify(build) }, resolve:{alias:{'@':resolve('frontend/src')}}, plugins: [react(), tailwindcss()], root: 'frontend', build: { outDir: '../app/static', emptyOutDir: true } });
