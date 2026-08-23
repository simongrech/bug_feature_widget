import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { mockFeedbackApi } from './mock-api';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: dir,
  plugins: [react(), mockFeedbackApi()],
  server: {
    port: 5173,
    open: true,
  },
});
