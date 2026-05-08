const TARGET_HOST = 'dashscope.aliyuncs.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(context.request.url);
    const subPath = url.pathname.replace(/^\/dashscope-proxy/, '') || '/';
    const targetUrl = `https://${TARGET_HOST}${subPath}${url.search}`;

    const headers = new Headers(context.request.headers);
    headers.set('Host', TARGET_HOST);
    headers.delete('content-length');

    const response = await fetch(targetUrl, {
      method: context.request.method,
      headers,
      body: context.request.method !== 'GET' ? context.request.body : undefined,
      redirect: 'follow',
    });

    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
    newHeaders.set('X-Proxy', 'dashscope');
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
}
