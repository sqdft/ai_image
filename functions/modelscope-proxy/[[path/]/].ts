export const onRequest: PagesFunction = async (context) => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const url = new URL(context.request.url);
  const targetUrl = `https://api-inference.modelscope.cn${url.pathname.replace(/^\/modelscope-proxy/, '')}${url.search}`;

  const headers = new Headers(context.request.headers);
  headers.set('Host', 'api-inference.modelscope.cn');

  if (url.pathname.includes('/images/generations')) {
    headers.set('X-ModelScope-Async-Mode', 'true');
  }
  if (url.pathname.includes('/tasks/')) {
    headers.set('X-ModelScope-Task-Type', 'image_generation');
  }

  const response = await fetch(targetUrl, {
    method: context.request.method,
    headers,
    body: context.request.method !== 'GET' ? context.request.body : undefined,
  });

  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', '*');
  newHeaders.delete('content-encoding');

  return new Response(response.body, {
    status: response.status,
    headers: newHeaders,
  });
};
