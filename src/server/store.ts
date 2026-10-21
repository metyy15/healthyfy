import { MongoClient } from 'mongodb';
import { isProd } from './config';
import {
  doctorsDatabase,
  fitnessData,
  seedFamilyMembers,
  seedMedicalReports,
  seedNotifications,
  seedUsers,
} from './seed';
import {
  AdherenceEntry,
  AllergyRecord,
  Appointment,
  CaregiverLink,
  Conversation,
  DeviceConnection,
  FamilyMember,
  FollowUpTask,
  HealthAlert,
  MedicalReport,
  Medication,
  NotificationItem,
  Reminder,
  SafetyCheck,
  User,
  Vital,
} from './types';

// -------------------------------------------------------------
// Application state
//
// Every collection is held in memory and mirrored into a single
// MongoDB document (healthyfy.app_state) so the demo data model
// stays intact while accounts, clinical records, monitoring data
// and alerts survive a restart.
// -------------------------------------------------------------

export const users: User[] = seedUsers();
export const familyMembers: FamilyMember[] = seedFamilyMembers();
export const medicalReports: MedicalReport[] = seedMedicalReports();
export const notifications: NotificationItem[] = seedNotifications();
export const appointments: Appointment[] = [];

// Clinical safety + monitoring model
export const medications: Medication[] = [];
export const allergies: AllergyRecord[] = [];
export const vitals: Vital[] = [];
export const caregivers: CaregiverLink[] = [];
export const alerts: HealthAlert[] = [];
export const adherence: AdherenceEntry[] = [];
export const reminders: Reminder[] = [];
export const deviceConnections: DeviceConnection[] = [];
export const safetyChecks: SafetyCheck[] = [];
export const conversations: Conversation[] = [];
export const followUpTasks: FollowUpTask[] = [];

export const doctors = doctorsDatabase;
export const fitness = fitnessData;

// Keep sync status per authenticated user so one user's setting cannot affect another.
export const fitnessSyncByUser = new Map<string, boolean>();

const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'healthyfy';
const MONGODB_COLLECTION = 'app_state';

let mongoClient: MongoClient | null = null;
let mongoStateCollection: any = null;

// -------------------------------------------------------------
// Seed clinical data
//
// The flat `medications` / `allergies` strings that ship with the
// original demo family are promoted into structured records so
// the safety engine and reminders have something real to work on.
// -------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function seedClinicalData(): void {
  if (medications.length > 0) return;

  const base: Medication[] = [
    {
      id: 'med-1',
      userId: 'user-kartik-1',
      memberId: 'fam-2',
      name: 'Metformin',
      genericName: 'Metformin',
      dose: '500 mg',
      route: 'Oral',
      frequency: 'Twice daily',
      times: ['08:30', '20:30'],
      startDate: todayIso(),
      prescribedBy: 'Dr. Priya V. Nambiar',
      instructions: 'Take after food. Evening dose after dinner.',
      active: true,
      source: 'typed',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'med-2',
      userId: 'user-kartik-1',
      memberId: 'fam-2',
      name: 'Telmisartan',
      genericName: 'Telmisartan',
      dose: '40 mg',
      route: 'Oral',
      frequency: 'Once daily',
      times: ['08:00'],
      startDate: todayIso(),
      prescribedBy: 'Dr. Priya V. Nambiar',
      instructions: 'Take in the morning with water.',
      active: true,
      source: 'typed',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'med-3',
      userId: 'user-kartik-1',
      memberId: 'fam-1',
      name: 'Salbutamol',
      genericName: 'Salbutamol',
      dose: '100 mcg',
      route: 'Inhaled',
      frequency: 'As needed',
      times: [],
      startDate: todayIso(),
      prescribedBy: 'Dr. Priya V. Nambiar',
      instructions: 'Two puffs before exercise if wheezy.',
      active: true,
      source: 'typed',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'med-4',
      userId: 'user-kartik-1',
      memberId: 'fam-3',
      name: 'Thyronorm',
      genericName: 'Levothyroxine',
      dose: '50 mcg',
      route: 'Oral',
      frequency: 'Once daily (fasting)',
      times: ['06:30'],
      startDate: todayIso(),
      prescribedBy: 'Dr. Priya V. Nambiar',
      instructions: 'Empty stomach, 30 minutes before breakfast.',
      active: true,
      source: 'typed',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'med-5',
      userId: 'user-kartik-1',
      memberId: 'fam-3',
      name: 'Calcium + Vitamin D3',
      genericName: 'Calcium carbonate + Cholecalciferol',
      dose: '500 mg / 1000 IU',
      route: 'Oral',
      frequency: 'Once daily',
      times: ['13:00'],
      startDate: todayIso(),
      prescribedBy: 'Dr. Priya V. Nambiar',
      instructions: 'After lunch with food.',
      active: true,
      source: 'typed',
      createdAt: new Date().toISOString(),
    },
  ];

  const allergyBase: AllergyRecord[] = [
    {
      id: 'alg-1',
      userId: 'user-kartik-1',
      memberId: 'fam-1',
      substance: 'Penicillin',
      reaction: 'Skin rash and hives',
      severity: 'moderate',
      verifiedAt: todayIso(),
      source: 'typed',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'alg-2',
      userId: 'user-kartik-1',
      memberId: 'fam-2',
      substance: 'Sulfa drugs',
      reaction: 'Reported intolerance',
      severity: 'mild',
      verifiedAt: todayIso(),
      source: 'typed',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'alg-3',
      userId: 'user-kartik-1',
      memberId: 'fam-3',
      substance: 'Peanuts',
      reaction: 'Anaphylaxis history (reported)',
      severity: 'severe',
      verifiedAt: todayIso(),
      source: 'typed',
      createdAt: new Date().toISOString(),
    },
  ];

  const caregiverBase: CaregiverLink[] = [
    {
      id: 'care-1',
      userId: 'user-kartik-1',
      memberId: 'fam-2',
      caregiverName: 'Kartik Sharma',
      caregiverPhone: '+91 98765 43210',
      relation: 'Son',
      permission: 'manage',
      channels: ['push', 'sms'],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'care-2',
      userId: 'user-kartik-1',
      memberId: 'fam-3',
      caregiverName: 'Kartik Sharma',
      caregiverPhone: '+91 98765 43210',
      relation: 'Son',
      permission: 'manage',
      channels: ['push', 'sms'],
      createdAt: new Date().toISOString(),
    },
  ];

  const reminderBase: Reminder[] = [
    {
      id: 'rem-seed-1',
      userId: 'user-kartik-1',
      memberId: 'fam-1',
      type: 'hydration',
      title: 'Hydration check-in',
      message: 'You are about 1.2 L short of your 3.0 L goal. Take a glass of water now.',
      schedule: { kind: 'daily', times: ['11:00', '15:00', '19:30'] },
      enabled: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'rem-seed-2',
      userId: 'user-kartik-1',
      memberId: 'fam-2',
      type: 'exercise',
      title: 'Morning walk with Rajesh',
      message: '30 minutes of brisk walking is the target today. Keep it moderate and steady.',
      schedule: { kind: 'daily', times: ['07:00'] },
      enabled: true,
      createdAt: new Date().toISOString(),
    },
  ];

  const deviceBase: DeviceConnection[] = [
    {
      id: 'dev-1',
      userId: 'user-kartik-1',
      memberId: 'fam-1',
      provider: 'health_connect',
      displayName: 'Pixel Watch 3 (Android)',
      status: 'connected',
      scopes: ['heart_rate', 'steps', 'sleep_hours'],
      lastSyncAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    },
    {
      id: 'dev-2',
      userId: 'user-kartik-1',
      memberId: 'fam-2',
      provider: 'fitbit',
      displayName: 'Fitbit Versa 3',
      status: 'connected',
      scopes: ['heart_rate', 'steps', 'sleep_hours'],
      lastSyncAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    },
  ];

  medications.push(...base);
  allergies.push(...allergyBase);
  caregivers.push(...caregiverBase);
  reminders.push(...reminderBase);
  deviceConnections.push(...deviceBase);

  // Two weeks of dosing history for Rajesh.
  //
  // The morning doses are mostly taken and the evening metformin is
  // mostly missed. That gap is the point: it is what the briefing
  // connects to the rise in HbA1c from 7.1% to 8.4%, and it is the
  // single most valuable thing in the app to demonstrate.
  const adherenceSeed: AdherenceEntry[] = [];
  const nowMs = Date.now();
  for (let daysAgo = 13; daysAgo >= 1; daysAgo--) {
    const day = new Date(nowMs - daysAgo * 86400000);

    const morning = new Date(day);
    morning.setHours(8, 30, 0, 0);
    adherenceSeed.push({
      id: `adh-m-1-${daysAgo}`,
      userId: 'user-kartik-1',
      memberId: 'fam-2',
      medicationId: 'med-1',
      medicationName: 'Metformin',
      scheduledAt: morning.toISOString(),
      status: daysAgo % 7 === 0 ? 'late' : 'taken',
      respondedAt: new Date(morning.getTime() + 12 * 60000).toISOString(),
    });

    const evening = new Date(day);
    evening.setHours(20, 30, 0, 0);
    adherenceSeed.push({
      id: `adh-e-1-${daysAgo}`,
      userId: 'user-kartik-1',
      memberId: 'fam-2',
      medicationId: 'med-1',
      medicationName: 'Metformin',
      scheduledAt: evening.toISOString(),
      status: daysAgo % 4 === 0 ? 'taken' : 'skipped',
      respondedAt: new Date(evening.getTime() + 30 * 60000).toISOString(),
    });

    const telmisartan = new Date(day);
    telmisartan.setHours(8, 0, 0, 0);
    adherenceSeed.push({
      id: `adh-2-${daysAgo}`,
      userId: 'user-kartik-1',
      memberId: 'fam-2',
      medicationId: 'med-2',
      medicationName: 'Telmisartan',
      scheduledAt: telmisartan.toISOString(),
      status: 'taken',
      respondedAt: new Date(telmisartan.getTime() + 8 * 60000).toISOString(),
    });
  }
  adherence.push(...adherenceSeed);

  // A couple of follow-up tasks so the tracker has something real in it
  // on a fresh database.
  const inDays = (days: number) =>
    new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  const followUpSeed: FollowUpTask[] = [
    {
      id: 'fu-seed-1',
      userId: 'user-kartik-1',
      memberId: 'fam-2',
      title: 'Book the three-month review with Dr. Priya Nambiar',
      detail: 'Bring the repeat lipid profile and the HbA1c from September.',
      kind: 'appointment',
      dueDate: inDays(9),
      source: 'visit_instructions',
      sourceLabel: 'Visit instructions added after the September review',
      status: 'pending',
      createdAt: new Date().toISOString(),
      reminderScheduled: false,
    },
    {
      id: 'fu-seed-2',
      userId: 'user-kartik-1',
      memberId: 'fam-2',
      title: 'Repeat the lipid profile (fasting, 12 hours)',
      detail: 'Fasting bloods before the appointment so the result is ready.',
      kind: 'test',
      dueDate: inDays(6),
      dueTime: '08:00',
      source: 'visit_instructions',
      sourceLabel: 'Visit instructions added after the September review',
      status: 'pending',
      createdAt: new Date().toISOString(),
      reminderScheduled: false,
    },
    {
      id: 'fu-seed-3',
      userId: 'user-kartik-1',
      memberId: 'fam-3',
      title: 'Ask about the Vitamin D course at the next appointment',
      detail: 'Her Vitamin D3 was 18.4 ng/mL in July, which is below the reference range.',
      kind: 'medication_review',
      source: 'agent',
      sourceLabel: 'Raised by the Healthyfy assistant',
      status: 'pending',
      createdAt: new Date().toISOString(),
      reminderScheduled: false,
      safetyNote:
        'Healthyfy never changes a medication schedule. This is a question for the prescriber.',
    },
  ];
  followUpTasks.push(...followUpSeed);

  // A short vitals history so the anomaly engine has a baseline to work from.
  // Readings are laid out backwards from now so that none of them sit in
  // the future, which would otherwise confuse the rolling windows.
  const vitalSeed: Vital[] = [];
  const now = Date.now();
  const HOUR = 3600000;
  for (let daysAgo = 0; daysAgo < 7; daysAgo++) {
    for (const [offsetHours, hr] of [
      [2, 64],
      [8, 78],
      [14, 71],
    ] as Array<[number, number]>) {
      vitalSeed.push({
        id: `vit-${daysAgo}-${offsetHours}`,
        userId: 'user-kartik-1',
        memberId: 'fam-1',
        type: 'heart_rate',
        value: hr + ((daysAgo * 3) % 7) - 3,
        unit: 'bpm',
        measuredAt: new Date(now - (daysAgo * 24 + offsetHours) * HOUR).toISOString(),
        source: 'health_connect',
        context: 'resting',
      });
    }
    vitalSeed.push({
      id: `vit-steps-${daysAgo}`,
      userId: 'user-kartik-1',
      memberId: 'fam-1',
      type: 'steps',
      value: 7800 + daysAgo * 320,
      unit: 'steps',
      measuredAt: new Date(now - (daysAgo * 24 + 3) * HOUR).toISOString(),
      source: 'health_connect',
    });
  }
  vitals.push(...vitalSeed);
}

// -------------------------------------------------------------
// MongoDB Persistence
// -------------------------------------------------------------

export async function connectMongoAndLoadState(): Promise<void> {
  if (!MONGODB_URI) {
    if (isProd) {
      throw new Error('MONGODB_URI must be configured in production.');
    }
    console.warn(
      'MONGODB_URI is not configured. Running with temporary in-memory data for local development.'
    );
    return;
  }

  mongoClient = new MongoClient(MONGODB_URI);
  await mongoClient.connect();

  const db = mongoClient.db(MONGODB_DB_NAME);
  mongoStateCollection = db.collection(MONGODB_COLLECTION);

  const saved = await mongoStateCollection.findOne({ _id: 'main' });

  if (saved) {
    replaceInPlace(users, saved.users);
    replaceInPlace(familyMembers, saved.familyMembers);
    replaceInPlace(medicalReports, saved.medicalReports);
    replaceInPlace(notifications, saved.notifications);
    replaceInPlace(appointments, saved.appointments);
    replaceInPlace(medications, saved.medications);
    replaceInPlace(allergies, saved.allergies);
    replaceInPlace(vitals, saved.vitals);
    replaceInPlace(caregivers, saved.caregivers);
    replaceInPlace(alerts, saved.alerts);
    replaceInPlace(adherence, saved.adherence);
    replaceInPlace(reminders, saved.reminders);
    replaceInPlace(deviceConnections, saved.deviceConnections);
    replaceInPlace(safetyChecks, saved.safetyChecks);
    replaceInPlace(conversations, saved.conversations);
    replaceInPlace(followUpTasks, saved.followUpTasks);

    fitnessSyncByUser.clear();
    if (saved.fitnessSyncByUser && typeof saved.fitnessSyncByUser === 'object') {
      for (const [userId, enabled] of Object.entries(saved.fitnessSyncByUser)) {
        fitnessSyncByUser.set(userId, Boolean(enabled));
      }
    }

    console.log(
      `MongoDB connected. Loaded Healthyfy data from ${MONGODB_DB_NAME}.${MONGODB_COLLECTION}.`
    );
  } else {
    seedClinicalData();
    await persistState();
    console.log(
      `MongoDB connected. Created initial Healthyfy data in ${MONGODB_DB_NAME}.${MONGODB_COLLECTION}.`
    );
  }
}

/**
 * Replace the contents of an array in place so that references held by
 * other modules stay valid.
 */
function replaceInPlace<T>(target: T[], source: unknown): void {
  target.length = 0;
  if (Array.isArray(source)) target.push(...(source as T[]));
}

export async function persistState(): Promise<void> {
  if (!mongoStateCollection) return;

  await mongoStateCollection.replaceOne(
    { _id: 'main' },
    {
      _id: 'main',
      users,
      familyMembers,
      medicalReports,
      notifications,
      appointments,
      fitnessSyncByUser: Object.fromEntries(fitnessSyncByUser.entries()),
      medications,
      allergies,
      vitals,
      caregivers,
      alerts,
      adherence,
      reminders,
      deviceConnections,
      safetyChecks,
      conversations,
      followUpTasks,
      updatedAt: new Date(),
    },
    { upsert: true }
  );
}

export async function persistStateSafely(): Promise<void> {
  try {
    await persistState();
  } catch (error) {
    console.error('MongoDB persistence error:', error);
  }
}

export async function closeMongo(): Promise<void> {
  if (mongoClient) await mongoClient.close();
}
