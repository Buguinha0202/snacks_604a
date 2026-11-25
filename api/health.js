export default async function handler(req, res) {
  try {
    const { handleApiRequest } = await import('../lib/api-handler.mjs');
    await handleApiRequest(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: { code: 'FUNCTION_ERROR', message: err?.message || String(err), stack: err?.stack } }));
  }
}
