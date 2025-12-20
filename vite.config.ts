import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/', // Vercel 部署使用根路径
  server: {
    host: '0.0.0.0',
    allowedHosts: true // 允许所有主机（不推荐用于生产）
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
