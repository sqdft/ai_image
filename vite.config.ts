import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/modelscope-proxy': {
          target: 'https://api-inference.modelscope.cn',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              if (req.url?.includes('/images/generations')) {
                proxyReq.setHeader('X-ModelScope-Async-Mode', 'true');
              }

              if (req.url?.includes('/tasks/')) {
                proxyReq.setHeader('X-ModelScope-Task-Type', 'image_generation');
              }
            });
          },
          rewrite: (proxyPath) => proxyPath.replace(/^\/modelscope-proxy/, ''),
        },
      },
    },
  };
});
