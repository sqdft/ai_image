export async function onRequest(context) {
  return new Response(JSON.stringify({ ok: true, message: 'proxy function is working' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Proxy': 'true' },
  });
}
