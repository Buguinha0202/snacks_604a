/**
 * Catch-all Serverless Function da Vercel para todas as rotas /api/*.
 */
import { handleApiRequest, sendError } from '../lib/api-handler.mjs';

export default async function handler(req, res) {
  try {
    const handled = await handleApiRequest(req, res);
    if (!handled) {
      sendError(res, 404, 'ROUTE_NOT_FOUND', `Rota ${req.method} ${req.url} não encontrada.`);
    }
  } catch (err) {
    sendError(res, 500, 'FUNCTION_ERROR', err?.message || 'Erro interno na função.');
  }
}
