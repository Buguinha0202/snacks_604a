import { handleApiRequest, sendError } from '../../lib/api-handler.mjs';
export default async function handler(req, res) {
  try { await handleApiRequest(req, res); }
  catch (err) { sendError(res, 500, 'FUNCTION_ERROR', err?.message || 'Erro interno.'); }
}
