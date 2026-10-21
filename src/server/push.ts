import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { FCM_PROJECT_ID, FCM_SERVICE_ACCOUNT_JSON } from './config';
import { notifications, persistStateSafely } from './store';
import { NotificationItem, NotificationType } from './types';

// -------------------------------------------------------------
// Push delivery
//
// Healthyfy talks to two channels:
//
//  1. In-app inbox  - always on, this is what the demo and local
//     development use. A push is recorded as a NotificationItem.
//  2. FCM (Firebase) - optional. Enabled by providing FCM_PROJECT_ID
//     and FCM_SERVICE_ACCOUNT_JSON so a real phone can receive the
//     same alert outside the app.
//
// Keeping the two separate means the alerting pipeline is fully
// exercised without any cloud credentials, and production delivery is
// a configuration change rather than a code change.
// -------------------------------------------------------------

export type PushChannel = 'push' | 'sms' | 'email' | 'in_app';

export interface PushTarget {
  userId: string;
  deviceToken?: string;
  phone?: string;
  email?: string;
}

export interface PushPayload {
  title: string;
  body: string;
  type: NotificationType;
  priority: 'low' | 'medium' | 'high';
  data?: Record<string, unknown>;
}

export interface PushResult {
  delivered: boolean;
  channel: PushChannel;
  detail: string;
}

// -------------------------------------------------------------
// FCM (Firebase Cloud Messaging) HTTP v1
// -------------------------------------------------------------

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

let cachedServiceAccount: ServiceAccount | null = null;
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function getServiceAccount(): ServiceAccount | null {
  if (cachedServiceAccount) return cachedServiceAccount;
  if (process.env.FCM_SERVICE_ACCOUNT_JSON === undefined) {
    cachedServiceAccount = null;
    return cachedServiceAccount;
  }
  try {
    const parsed = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON || '');
    cachedServiceAccount =
      parsed.client_email && parsed.private_key ? (parsed as ServiceAccount) : null;
  } catch {
    console.error('FCM_SERVICE_ACCOUNT_JSON is not valid JSON. Push will stay in-app only.');
    cachedServiceAccount = null;
  }
  return cachedServiceAccount;
}

async function getFcmAccessToken(): Promise<string | null> {
  const account = getServiceAccount();
  if (!account) return null;

  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
      {
        iss: account.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      },
      account.private_key.replace(/\\n/g, '\n'),
      { algorithm: 'RS256' }
    );

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });

    if (!response.ok) {
      console.error('FCM token exchange failed:', response.status, await response.text());
      return null;
    }

    const data: any = await response.json();
    cachedAccessToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };
    return cachedAccessToken.token;
  } catch (error) {
    console.error('FCM token exchange error:', error);
    return null;
  }
}

async function sendFcm(deviceToken: string, payload: PushPayload): Promise<boolean> {
  if (!FCM_PROJECT_ID) return false;
  const accessToken = await getFcmAccessToken();
  if (!accessToken) return false;

  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            notification: { title: payload.title, body: payload.body },
            data: Object.fromEntries(
              Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)])
            ),
            android: {
              priority: payload.priority === 'high' ? 'HIGH' : 'NORMAL',
              notification: { channel_id: 'healthyfy_alerts' },
            },
          },
        }),
      }
    );

    if (!response.ok) {
      console.error('FCM send failed:', response.status, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error('FCM send error:', error);
    return false;
  }
}

// -------------------------------------------------------------
// Public API
// -------------------------------------------------------------

/**
 * Record a notification in the in-app inbox. This is the durable
 * delivery channel and also the audit trail for every alert the
 * system raises.
 */
export function recordInAppNotification(
  userId: string,
  payload: PushPayload
): NotificationItem {
  const item: NotificationItem = {
    id: `notif-${crypto.randomUUID()}`,
    userId,
    type: payload.type,
    title: payload.title,
    message: payload.body,
    timestamp: new Date().toISOString(),
    read: false,
    priority: payload.priority,
  };
  notifications.unshift(item);
  return item;
}

/**
 * Deliver a push to a user. The in-app inbox always receives it;
 * FCM is used additionally when a device token is registered.
 */
export async function pushToUser(
  target: PushTarget,
  payload: PushPayload
): Promise<PushResult[]> {
  const results: PushResult[] = [];

  recordInAppNotification(target.userId, payload);
  results.push({
    delivered: true,
    channel: 'in_app',
    detail: 'Recorded in the in-app notification inbox.',
  });

  if (target.deviceToken) {
    const ok = await sendFcm(target.deviceToken, payload);
    results.push({
      delivered: ok,
      channel: 'push',
      detail: ok
        ? 'Delivered to the registered device via FCM.'
        : 'FCM delivery unavailable (missing credentials or device token).',
    });
  }

  if (target.phone) {
    results.push({
      delivered: false,
      channel: 'sms',
      detail:
        'SMS gateway not configured. Connect a provider (Twilio/MSG91) to deliver SMS escalations.',
    });
  }

  await persistStateSafely();
  return results;
}

export function pushProviderStatus(): {
  inApp: boolean;
  fcm: boolean;
  sms: boolean;
  note: string;
} {
  const fcmReady = Boolean(FCM_PROJECT_ID && FCM_SERVICE_ACCOUNT_JSON);
  return {
    inApp: true,
    fcm: fcmReady,
    sms: false,
    note: fcmReady
      ? 'FCM is configured; alerts are delivered to registered devices and the in-app inbox.'
      : 'FCM is not configured; alerts land in the in-app inbox. Set FCM_PROJECT_ID and FCM_SERVICE_ACCOUNT_JSON to deliver to a real device.',
  };
}
