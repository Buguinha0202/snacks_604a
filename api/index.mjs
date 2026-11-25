/**
 * Entrypoint Serverless para Vercel (/api/*).
 * Reutiliza integralmente o handler compartilhado em lib/api-handler.mjs.
 */
import { handleApiRequest } from '../lib/api-handler.mjs';

export default async function handler(req, res) {
  await handleApiRequest(req, res);
}
