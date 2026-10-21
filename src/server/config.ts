import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

export const isProd = process.env.NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '3000', 10);
export const JWT_SECRET =
  process.env.JWT_SECRET || (isProd ? '' : 'healthyfy-local-development-secret-change-me');
if (isProd && !JWT_SECRET) throw new Error('JWT_SECRET must be configured in production.');

// -------------------------------------------------------------
// Gemini AI Initialization
// -------------------------------------------------------------
const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

export const ai = apiKey
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
export const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash';

/**
 * The Gemini models to try, in order.
 *
 * The free tier allows 20 requests per day *per model* per project, so
 * each additional model name is a fresh daily allowance. Rotating
 * through them turns one bucket into several, and it also means one
 * exhausted model does not take the app down.
 */
export const GEMINI_MODELS: string[] = Array.from(
  new Set(
    (
      process.env.GEMINI_MODELS ||
      [
        GEMINI_MODEL,
        GEMINI_FALLBACK_MODEL,
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
      ].join(',')
    )
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean)
  )
);

// Optional FCM (Firebase Cloud Messaging) credentials for real push delivery.
// Without them the app falls back to the in-app notification channel, which is
// what the demo and local development use.
export const FCM_PROJECT_ID = process.env.FCM_PROJECT_ID || '';
export const FCM_SERVICE_ACCOUNT_JSON = process.env.FCM_SERVICE_ACCOUNT_JSON || '';

// Optional RxNorm service for drug-name canonicalisation.
export const RXNORM_ENABLED = process.env.RXNORM_ENABLED !== 'false';
