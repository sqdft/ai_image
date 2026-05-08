const TARGET_HOST = 'api-inference.modelscope.cn';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const onRequest: PagesFunction = async (context) => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(context.request.url);
    const subPath = url.pathname.replace(/^\/modelscope-proxy/, '') || '/';
    const targetUrl = `https://${TARGET_HOST}${subPath}${url.search}`;

    const headers = new Headers(context.request.headers);
    headers.set('Host', TARGET_HOST);
    headers.delete('content-length');

    if (subPath.includes('/images/generations')) {
      headers.set('X-ModelScope-Async-Mode', 'true');
    }
    if (subPath.includes('/tasks/')) {
      headers.set('X-ModelScope-Task-Type', 'image_generation');
    }

    const response = await fetch(targetUrl, {
      method: context.request.method,
      headers,
      body: context.request.method !== 'GET' ? context.request.body : undefined,
      redirect: 'follow',
    });

    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
    newHeaders.delete('content-encoding');

    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
};
