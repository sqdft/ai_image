import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import http from 'http';
import https from 'https';
import {defineConfig, loadEnv, type Plugin} from 'vite';

/**
 * 可靠的开发态反向代理（不依赖 http-proxy router）
 * 浏览器: GET /api-proxy/https/token.sensenova.cn/v1/models
 * 转发到:  https://token.sensenova.cn/v1/models
 */
function openProxyPlugin(): Plugin {
  return {
    name: 'open-cors-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // 全站 CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader(
          'Access-Control-Allow-Methods',
          'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
        );
        const reqHeaders =
          req.headers['access-control-request-headers'] ||
          'Authorization, Content-Type, X-Requested-With';
        res.setHeader('Access-Control-Allow-Headers', reqHeaders);
        res.setHeader('Access-Control-Max-Age', '86400');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        const url = req.url || '';
        if (!url.startsWith('/api-proxy/')) {
          next();
          return;
        }

        // /api-proxy/https/host/path?query
        const m = url.match(/^\/api-proxy\/(https?)\/([^/?#]+)(\/[^?]*)?(\?.*)?$/);
        if (!m) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: {
                message:
                  '代理路径格式: /api-proxy/https/example.com/v1/models',
              },
            }),
          );
          return;
        }

        const scheme = m[1];
        const host = m[2];
        const pathname = m[3] || '/';
        const search = m[4] || '';
        const targetUrl = `${scheme}://${host}${pathname}${search}`;

        const lib = scheme === 'http' ? http : https;
        const headers: Record<string, string | string[] | undefined> = {
          ...req.headers,
          host,
        };
        // 清理 hop-by-hop / 浏览器头
        delete headers['origin'];
        delete headers['referer'];
        delete headers['host'];
        headers['host'] = host;
        delete headers['connection'];
        delete headers['content-length']; // 由 node 重算
        // 不要把 localhost 的 accept-encoding 搞复杂，统一 identity 方便调试
        // delete headers['accept-encoding'];

        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(Buffer.from(c)));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          const upstream = lib.request(
            targetUrl,
            {
              method: req.method,
              headers: {
                ...headers,
                ...(body.length ? {'content-length': String(body.length)} : {}),
              },
              timeout: 60000,
            },
            (upRes) => {
              res.statusCode = upRes.statusCode || 502;
              // 透传上游头，并强制 CORS
              for (const [k, v] of Object.entries(upRes.headers)) {
                if (v === undefined) continue;
                const key = k.toLowerCase();
                if (
                  key === 'access-control-allow-origin' ||
                  key === 'transfer-encoding' ||
                  key === 'connection'
                ) {
                  continue;
                }
                res.setHeader(k, v as string | string[]);
              }
              res.setHeader('Access-Control-Allow-Origin', '*');
              upRes.pipe(res);
            },
          );

          upstream.on('timeout', () => {
            upstream.destroy();
            if (!res.headersSent) {
              res.statusCode = 504;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end(
                JSON.stringify({
                  error: {message: `代理超时: ${targetUrl}`},
                }),
              );
            }
          });

          upstream.on('error', (err) => {
            console.error('[api-proxy]', targetUrl, err.message);
            if (!res.headersSent) {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end(
                JSON.stringify({
                  error: {
                    message: `代理失败: ${err.message}`,
                    target: targetUrl,
                  },
                }),
              );
            }
          });

          if (body.length) upstream.write(body);
          upstream.end();
        });
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), openProxyPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3031,
      strictPort: true,
      cors: true,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
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
          rewrite: (proxyPath) =>
            proxyPath.replace(/^\/modelscope-proxy/, ''),
        },
        '/dashscope-proxy': {
          target: 'https://dashscope.aliyuncs.com',
          changeOrigin: true,
          rewrite: (proxyPath) =>
            proxyPath.replace(/^\/dashscope-proxy/, ''),
        },
      },
    },
  };
});
