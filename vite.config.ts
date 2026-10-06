import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const build = JSON.parse(readFileSync('app/build-info.json', 'utf8'));
export default defineConfig({ define: { __AVHUB_BUILD__: JSON.stringify(build) }, plugins: [react()], root: 'frontend', build: { outDir: '../app/static', emptyOutDir: true } });
