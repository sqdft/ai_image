const PROXY_ROUTES = {
  '/dashscope-image-gen': {
    host: 'dashscope.aliyuncs.com',
    path: '/compatible-mode/v1/images/generations',
  },
  '/dashscope-image-edit': {
    host: 'dashscope.aliyuncs.com',
    path: '/compatible-mode/v1/images/edits',
  },
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Handle CORS preflight for proxy routes
    if (request.method === 'OPTIONS' && PROXY_ROUTES[pathname]) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Check if this is a proxy route
    const route = PROXY_ROUTES[pathname];
    if (!route) {
      return new Response('Not Found', { status: 404 });
    }

    try {
      const targetUrl = `https://${route.host}${route.path}${url.search}`;

      const headers = new Headers(request.headers);
      headers.set('Host', route.host);
      headers.delete('content-length');

      const response = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: request.method !== 'GET' ? request.body : undefined,
        redirect: 'follow',
      });

      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
      newHeaders.delete('content-encoding');

      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  },
};
