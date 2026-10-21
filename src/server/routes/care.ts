import { Request, Response, Router } from 'express';
import { authenticateToken } from '../auth';
import { buildAiBriefing, buildDailyBriefing } from '../ai/briefing';
import { buildExercisePlan } from '../ai/exercise';
import {
  acknowledgeAlert,
  analyzeHeartRate,
  caregiversForMember,
  createAlert,
  evaluateVitalsAndAlert,
  handleFallEvent,
  resolveAlert,
} from '../ai/monitor';
import { pushProviderStatus } from '../push';
import { runTick, schedulerStatus } from '../scheduler';
import {
  alerts,
  caregivers,
  deviceConnections,
  familyMembers,
  persistState,
  persistStateSafely,
  reminders,
  vitals,
} from '../store';
import { AlertType, CaregiverLink, DeviceConnection, Reminder } from '../types';

export const careRouter = Router();
careRouter.use(authenticateToken);

/** Alert types the monitoring engine understands. */
const ALERT_TYPES: AlertType[] = [
  'heart_rate',
  'fall',
  'spo2',
  'inactivity',
  'medication_missed',
  'safety',
  'manual',
];

// -------------------------------------------------------------
// Alerts
// -------------------------------------------------------------

careRouter.get('/alerts', (req: Request, res: Response) => {
  const { memberId, status } = req.query;
  let list = alerts.filter((a) => a.userId === req.user!.id);
  if (memberId) list = list.filter((a) => a.memberId === memberId);
  if (status) list = list.filter((a) => a.status === status);
  res.json(
    list.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime())
  );
});

/**
 * Create a health alert.
 *
 * This is the endpoint an outside agent calls when a conversation
 * surfaces something that needs the family to look in now. The
 * monitoring engine takes over from here: the alert is recorded and
 * the linked caregivers are notified.
 */
careRouter.post('/alerts', async (req: Request, res: Response) => {
  const { memberId, type, severity, title, message } = req.body || {};
  if (!memberId || !title) {
    return res.status(400).json({ error: 'Family member and title are required.' });
  }
  const member = familyMembers.find((f) => f.id === memberId && f.userId === req.user!.id);
  if (!member) return res.status(404).json({ error: 'Family member not found.' });

  const alert = createAlert({
    userId: req.user!.id,
    memberId,
    type: ALERT_TYPES.includes(type) ? type : 'manual',
    severity: severity === 'critical' ? 'critical' : severity === 'info' ? 'info' : 'warning',
    title: String(title),
    message: String(message || ''),
    snapshot: { source: 'agent' },
  });

  await persistState();
  res.status(201).json(alert);
});

careRouter.post('/alerts/:id/acknowledge', async (req: Request, res: Response) => {
  const alert = acknowledgeAlert(req.user!.id, req.params.id, req.user!.name);
  if (!alert) return res.status(404).json({ error: 'Alert not found.' });
  await persistState();
  res.json(alert);
});

careRouter.post('/alerts/:id/resolve', async (req: Request, res: Response) => {
  const alert = resolveAlert(req.user!.id, req.params.id, req.body?.note);
  if (!alert) return res.status(404).json({ error: 'Alert not found.' });
  await persistState();
  res.json(alert);
});

/**
 * Register a fall detection event.
 *
 * This is the endpoint a watch app posts to. A real device build
 * (Wear OS / watchOS) would call it with the sensor trace and the
 * current position; the response contains the alert that was raised
 * and the escalation steps that were taken.
 */
careRouter.post('/monitor/fall', async (req: Request, res: Response) => {
  const { memberId, location, sensorTrace, confidence, source } = req.body || {};
  if (!memberId) return res.status(400).json({ error: 'Family member is required.' });
  const member = familyMembers.find((f) => f.id === memberId && f.userId === req.user!.id);
  if (!member) {
    return res.status(403).json({ error: 'You can only report events for your own family members.' });
  }
  if (location && (typeof location.lat !== 'number' || typeof location.lng !== 'number')) {
    return res.status(400).json({ error: 'Location must contain numeric lat and lng.' });
  }

  const alert = await handleFallEvent({
    userId: req.user!.id,
    memberId,
    location,
    sensorTrace,
    confidence,
    source,
  });

  res.status(201).json(alert);
});

/**
 * Manually raise an alert. Used by the demo controls so the whole
 * escalation path can be exercised without a physical device.
 */
careRouter.post('/alerts/simulate', async (req: Request, res: Response) => {
  const { memberId, type, severity, message } = req.body || {};
  if (!memberId) return res.status(400).json({ error: 'Family member is required.' });
  const member = familyMembers.find((f) => f.id === memberId && f.userId === req.user!.id);
  if (!member) {
    return res.status(403).json({ error: 'You can only raise alerts for your own family members.' });
  }

  if (type === 'fall') {
    const alert = await handleFallEvent({
      userId: req.user!.id,
      memberId,
      location: req.body?.location,
      confidence: 'medium',
      source: 'demo',
    });
    return res.status(201).json(alert);
  }

  if (type === 'heart_rate') {
    // Inject a reading that the monitoring engine will evaluate.
    const bpm = Number(req.body?.bpm) || 148;
    const now = new Date().toISOString();
    const vital = {
      id: `vit-sim-${Date.now()}`,
      userId: req.user!.id,
      memberId,
      type: 'heart_rate' as const,
      value: bpm,
      unit: 'bpm',
      measuredAt: now,
      source: 'watch' as const,
      context: 'resting' as const,
    };
    vitals.push(vital);
    const alert = await evaluateVitalsAndAlert(req.user!.id, memberId, vital);
    await persistStateSafely();
    if (alert) return res.status(201).json(alert);
    return res.status(200).json({
      created: false,
      message:
        'That reading was recorded but did not breach the alert thresholds for this member. A single reading needs to be sustained, and recent activity can explain it.',
    });
  }

  const alert = createAlert({
    userId: req.user!.id,
    memberId,
    type: type || 'manual',
    severity: severity === 'critical' ? 'critical' : severity === 'info' ? 'info' : 'warning',
    title: `Manual alert for ${member.name}`,
    message: message || 'A manual alert was raised from the demo controls.',
    snapshot: { source: 'demo' },
  });
  await persistStateSafely();
  res.status(201).json(alert);
});

// -------------------------------------------------------------
// Caregivers
// -------------------------------------------------------------

careRouter.get('/caregivers', (req: Request, res: Response) => {
  const { memberId } = req.query;
  let list = caregivers.filter((c) => c.userId === req.user!.id);
  if (memberId) list = list.filter((c) => c.memberId === memberId);
  res.json(list);
});

careRouter.post('/caregivers', async (req: Request, res: Response) => {
  const { memberId, caregiverName, caregiverPhone, caregiverEmail, relation, permission, channels } =
    req.body || {};

  if (!memberId || !caregiverName) {
    return res.status(400).json({ error: 'Family member and caregiver name are required.' });
  }
  const member = familyMembers.find((f) => f.id === memberId && f.userId === req.user!.id);
  if (!member) {
    return res.status(403).json({ error: 'You can only manage caregivers for your own family members.' });
  }

  const link: CaregiverLink = {
    id: `care-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId: req.user!.id,
    memberId,
    caregiverName: String(caregiverName).trim(),
    ...(caregiverPhone ? { caregiverPhone: String(caregiverPhone) } : {}),
    ...(caregiverEmail ? { caregiverEmail: String(caregiverEmail) } : {}),
    relation: String(relation || 'Family'),
    permission: permission === 'manage' ? 'manage' : 'view',
    channels: Array.isArray(channels) && channels.length ? channels : ['push'],
    createdAt: new Date().toISOString(),
  };

  caregivers.push(link);
  await persistState();
  res.status(201).json(link);
});

careRouter.delete('/caregivers/:id', async (req: Request, res: Response) => {
  const index = caregivers.findIndex((c) => c.id === req.params.id && c.userId === req.user!.id);
  if (index === -1) return res.status(404).json({ error: 'Caregiver link not found.' });
  caregivers.splice(index, 1);
  await persistState();
  res.json({ success: true });
});

// -------------------------------------------------------------
// Reminders
// -------------------------------------------------------------

careRouter.get('/reminders', (req: Request, res: Response) => {
  const { memberId } = req.query;
  let list = reminders.filter((r) => r.userId === req.user!.id);
  if (memberId) list = list.filter((r) => r.memberId === memberId);
  res.json(list);
});

careRouter.post('/reminders', async (req: Request, res: Response) => {
  const { memberId, type, title, message, times } = req.body || {};
  if (!memberId || !title || !Array.isArray(times) || times.length === 0) {
    return res
      .status(400)
      .json({ error: 'Family member, title and at least one reminder time are required.' });
  }
  const member = familyMembers.find((f) => f.id === memberId && f.userId === req.user!.id);
  if (!member) {
    return res.status(403).json({ error: 'You can only create reminders for your own family members.' });
  }

  const reminder: Reminder = {
    id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId: req.user!.id,
    memberId,
    type: type || 'hydration',
    title: String(title),
    message: String(message || ''),
    schedule: { kind: 'daily', times: times.map((t: string) => String(t)) },
    enabled: true,
    createdAt: new Date().toISOString(),
  };

  reminders.push(reminder);
  await persistState();
  res.status(201).json(reminder);
});

careRouter.put('/reminders/:id', async (req: Request, res: Response) => {
  const index = reminders.findIndex((r) => r.id === req.params.id && r.userId === req.user!.id);
  if (index === -1) return res.status(404).json({ error: 'Reminder not found.' });
  const { id: _id, userId: _userId, memberId: _memberId, ...updates } = req.body || {};
  reminders[index] = { ...reminders[index], ...updates };
  await persistState();
  res.json(reminders[index]);
});

careRouter.delete('/reminders/:id', async (req: Request, res: Response) => {
  const index = reminders.findIndex((r) => r.id === req.params.id && r.userId === req.user!.id);
  if (index === -1) return res.status(404).json({ error: 'Reminder not found.' });
  reminders.splice(index, 1);
  await persistState();
  res.json({ success: true });
});

// -------------------------------------------------------------
// Device connections
// -------------------------------------------------------------

careRouter.get('/devices', (req: Request, res: Response) => {
  const { memberId } = req.query;
  let list = deviceConnections.filter((d) => d.userId === req.user!.id);
  if (memberId) list = list.filter((d) => d.memberId === memberId);
  res.json(list);
});

careRouter.post('/devices', async (req: Request, res: Response) => {
  const { memberId, provider, displayName, scopes } = req.body || {};
  if (!memberId || !provider) {
    return res.status(400).json({ error: 'Family member and provider are required.' });
  }
  const member = familyMembers.find((f) => f.id === memberId && f.userId === req.user!.id);
  if (!member) {
    return res.status(403).json({ error: 'You can only connect devices for your own family members.' });
  }

  const device: DeviceConnection = {
    id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId: req.user!.id,
    memberId,
    provider,
    displayName: String(displayName || provider),
    status: 'connected',
    scopes: Array.isArray(scopes) ? scopes : [],
    lastSyncAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  deviceConnections.push(device);
  await persistState();
  res.status(201).json(device);
});

careRouter.delete('/devices/:id', async (req: Request, res: Response) => {
  const index = deviceConnections.findIndex((d) => d.id === req.params.id && d.userId === req.user!.id);
  if (index === -1) return res.status(404).json({ error: 'Device connection not found.' });
  deviceConnections.splice(index, 1);
  await persistState();
  res.json({ success: true });
});

/**
 * Ingest a batch of vitals from a wearable.
 *
 * A native app or a server-side wearable connector (Fitbit, Garmin,
 * Oura) posts the samples here. This is the endpoint that lets steps
 * and heart rate reach the record without the user typing anything.
 */
careRouter.post('/devices/sync', async (req: Request, res: Response) => {
  const { deviceId, samples } = req.body || {};
  if (!Array.isArray(samples) || samples.length === 0) {
    return res.status(400).json({ error: 'A non-empty samples array is required.' });
  }

  const device = deviceId
    ? deviceConnections.find((d) => d.id === deviceId && d.userId === req.user!.id)
    : undefined;
  if (deviceId && !device) {
    return res.status(404).json({ error: 'Device connection not found.' });
  }

  const memberId = device?.memberId || req.body.memberId;
  if (!memberId) {
    return res.status(400).json({ error: 'Family member is required.' });
  }
  const member = familyMembers.find((f) => f.id === memberId && f.userId === req.user!.id);
  if (!member) {
    return res.status(403).json({ error: 'You can only sync data for your own family members.' });
  }

  let accepted = 0;
  for (const sample of samples) {
    if (!sample?.type || sample?.value === undefined) continue;
    const vital = {
      id: `vit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      userId: req.user!.id,
      memberId,
      type: sample.type,
      value: Number(sample.value),
      unit: sample.unit || 'unit',
      measuredAt: sample.measuredAt || new Date().toISOString(),
      source: sample.source || (device?.provider as any) || 'wearable_api',
      ...(device ? { deviceId: device.id } : {}),
      context: sample.context || 'unknown',
    };
    vitals.push(vital);
    accepted++;
  }

  if (device) {
    device.lastSyncAt = new Date().toISOString();
    device.status = 'connected';
  }

  await persistStateSafely();
  res.json({ accepted, syncedAt: new Date().toISOString() });
});

// -------------------------------------------------------------
// Monitoring overview
// -------------------------------------------------------------

careRouter.get('/monitor/overview', (req: Request, res: Response) => {
  const { memberId } = req.query;
  const members = familyMembers.filter(
    (f) => f.userId === req.user!.id && (!memberId || f.id === memberId)
  );

  res.json({
    members: members.map((m) => {
      const hr = analyzeHeartRate(m.id);
      return {
        memberId: m.id,
        memberName: m.name,
        relationship: m.relationship,
        heartRate: hr,
        openAlerts: alerts.filter((a) => a.memberId === m.id && a.status !== 'resolved').length,
        caregivers: caregiversForMember(m.id).map((c) => ({
          name: c.caregiverName,
          relation: c.relation,
          permission: c.permission,
          channels: c.channels,
        })),
        devices: deviceConnections
          .filter((d) => d.memberId === m.id)
          .map((d) => ({
            id: d.id,
            provider: d.provider,
            displayName: d.displayName,
            status: d.status,
            lastSyncAt: d.lastSyncAt,
          })),
      };
    }),
    push: pushProviderStatus(),
    scheduler: schedulerStatus(),
  });
});

// -------------------------------------------------------------
// Daily briefing
// -------------------------------------------------------------

careRouter.get('/briefing', async (req: Request, res: Response) => {
  const briefing = buildDailyBriefing(req.user!.id);
  const narrative = await buildAiBriefing(req.user!.id, briefing);
  res.json({ ...briefing, narrative });
});

// -------------------------------------------------------------
// Exercise plan
// -------------------------------------------------------------

careRouter.get('/exercise-plan', async (req: Request, res: Response) => {
  const memberId = req.query.memberId ? String(req.query.memberId) : undefined;
  const target = memberId || familyMembers.find((f) => f.userId === req.user!.id)?.id;
  if (!target) return res.status(404).json({ error: 'No family member found.' });
  const plan = await buildExercisePlan(req.user!.id, target);
  if (!plan) return res.status(404).json({ error: 'Family member not found.' });
  res.json(plan);
});

// -------------------------------------------------------------
// Scheduler controls (useful for demos and for verifying reminders)
// -------------------------------------------------------------

careRouter.post('/scheduler/run', async (req: Request, res: Response) => {
  const result = await runTick();
  await persistStateSafely();
  res.json(result);
});
