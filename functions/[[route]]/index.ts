const PROXY_ROUTES: Record<string, string> = {
  '/modelscope-proxy': 'api-inference.modelscope.cn',
  '/dashscope-proxy': 'dashscope.aliyuncs.com',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // Find matching proxy route
  const matchedPrefix = Object.keys(PROXY_ROUTES).find((prefix) =>
    pathname.startsWith(prefix)
  );

  if (!matchedPrefix) {
    return new Response('Not Found', { status: 404 });
  }

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const targetHost = PROXY_ROUTES[matchedPrefix];
  const subPath = pathname.slice(matchedPrefix.length) || '/';
  const targetUrl = `https://${targetHost}${subPath}${url.search}`;

  const headers = new Headers(context.request.headers);
  headers.set('Host', targetHost);

  // ModelScope specific headers
  if (targetHost === 'api-inference.modelscope.cn') {
    if (subPath.includes('/images/generations')) {
      headers.set('X-ModelScope-Async-Mode', 'true');
    }
    if (subPath.includes('/tasks/')) {
      headers.set('X-ModelScope-Task-Type', 'image_generation');
    }
  }

  const response = await fetch(targetUrl, {
    method: context.request.method,
    headers,
    body: context.request.method !== 'GET' ? context.request.body : undefined,
  });

  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
  newHeaders.delete('content-encoding');

  return new Response(response.body, {
    status: response.status,
    headers: newHeaders,
  });
};
