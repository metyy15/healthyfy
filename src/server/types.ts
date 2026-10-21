// -------------------------------------------------------------
// Backend domain types
// -------------------------------------------------------------

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  phone: string;
  city: string;
  emergencyContact: {
    name: string;
    relationship: string;
    phone: string;
  };
  preferences: {
    medicationAlarms: boolean;
    hydrationAlerts: boolean;
    reportReadyAlerts: boolean;
    fitnessMilestones: boolean;
  };
}

export type Relationship =
  | 'Self'
  | 'Father'
  | 'Mother'
  | 'Sister'
  | 'Brother'
  | 'Child'
  | 'Spouse'
  | 'Other';

export interface FamilyMember {
  id: string;
  userId: string;
  name: string;
  relationship: Relationship;
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  bloodGroup: string;
  /** Kept for backwards compatibility with the original flat model. */
  allergies: string[];
  existingConditions: string[];
  /** Kept for backwards compatibility with the original flat model. */
  medications: string[];
  emergencyContact: string;
  notes: string;
  avatarColor: string;
}

export interface ReportValueItem {
  testName: string;
  result: string;
  referenceRange: string;
  status: 'Within range' | 'Higher than reference range' | 'Lower than reference range';
  unit?: string;
  clinicalSignificance?: string;
}

export interface MedicalReport {
  id: string;
  userId: string;
  memberId: string;
  memberName: string;
  reportType: string;
  title: string;
  date: string;
  laboratory: string;
  rawText?: string;
  summary: string;
  isUrgent: boolean;
  emergencyWarning?: string;
  values: ReportValueItem[];
  aiExplanation: string;
  possibleIndications: string[];
  suggestedQuestions: string[];
  nextSteps: string[];
  disclaimer: string;
}

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  qualification: string;
  experienceYears: number;
  hospital: string;
  distanceKm: number;
  rating: number;
  reviewsCount: number;
  address: string;
  consultationFee: number;
  availableTimings: string;
  isAvailableToday: boolean;
  avatarUrl?: string;
}

export type NotificationType =
  | 'health'
  | 'medication'
  | 'hydration'
  | 'fitness'
  | 'report'
  | 'appointment'
  | 'alert'
  | 'caregiver'
  | 'exercise'
  | 'safety';

export interface NotificationItem {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  priority: 'low' | 'medium' | 'high';
}

// -------------------------------------------------------------
// Clinical safety model
// -------------------------------------------------------------

export type MedicationSource =
  | 'typed'
  | 'prescription_upload'
  | 'lab_report'
  | 'health_connect'
  | 'healthkit'
  | 'wearable_api'
  | 'imported';

export interface Medication {
  id: string;
  userId: string;
  memberId: string;
  name: string;
  genericName?: string;
  /** RxNorm concept id (rxcui) when the name could be canonicalised. */
  rxNormId?: string;
  dose: string;
  route?: string;
  frequency: string;
  /** Local 24h "HH:MM" dose times. */
  times: string[];
  startDate: string;
  endDate?: string;
  prescribedBy?: string;
  instructions?: string;
  active: boolean;
  source: MedicationSource;
  createdAt: string;
}

export type AllergySeverity = 'mild' | 'moderate' | 'severe' | 'unknown';

export interface AllergyRecord {
  id: string;
  userId: string;
  memberId: string;
  substance: string;
  reaction?: string;
  severity: AllergySeverity;
  verifiedAt: string;
  source: MedicationSource;
  createdAt: string;
}

export type VitalType =
  | 'heart_rate'
  | 'steps'
  | 'spo2'
  | 'blood_pressure'
  | 'sleep_hours'
  | 'weight'
  | 'temperature';

export interface Vital {
  id: string;
  userId: string;
  memberId: string;
  type: VitalType;
  value: number;
  /** Systolic value for blood pressure readings. */
  secondaryValue?: number;
  unit: string;
  measuredAt: string;
  source: 'manual' | 'health_connect' | 'healthkit' | 'fitbit' | 'garmin' | 'wearable_api' | 'watch';
  deviceId?: string;
  context?: 'resting' | 'active' | 'post-exercise' | 'sleep' | 'unknown';
}

export type CaregiverPermission = 'view' | 'manage';

export interface CaregiverLink {
  id: string;
  userId: string;
  memberId: string;
  caregiverUserId?: string;
  caregiverName: string;
  caregiverEmail?: string;
  caregiverPhone?: string;
  relation: string;
  permission: CaregiverPermission;
  channels: Array<'push' | 'sms' | 'email'>;
  createdAt: string;
}

export type AlertType =
  | 'heart_rate'
  | 'fall'
  | 'spo2'
  | 'inactivity'
  | 'medication_missed'
  | 'safety'
  | 'manual';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertLocation {
  lat: number;
  lng: number;
  accuracyM?: number;
  label?: string;
  capturedAt: string;
}

export interface EscalationStep {
  level: number;
  at: string;
  channel: 'push' | 'sms' | 'email' | 'in_app';
  recipient: string;
  delivered: boolean;
  note?: string;
}

export interface HealthAlert {
  id: string;
  userId: string;
  memberId: string;
  memberName: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  status: 'open' | 'acknowledged' | 'resolved' | 'cancelled';
  detectedAt: string;
  snapshot: Record<string, unknown>;
  location?: AlertLocation;
  escalation: EscalationStep[];
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  resolutionNote?: string;
}

export type AdherenceStatus = 'pending' | 'taken' | 'skipped' | 'late';

export interface AdherenceEntry {
  id: string;
  userId: string;
  memberId: string;
  medicationId: string;
  medicationName: string;
  scheduledAt: string;
  status: AdherenceStatus;
  respondedAt?: string;
  note?: string;
}

export interface ReminderSchedule {
  kind: 'daily' | 'weekly' | 'interval' | 'once';
  times: string[];
  days?: number[];
  everyMinutes?: number;
  at?: string;
}

export interface Reminder {
  id: string;
  userId: string;
  memberId: string;
  type: 'medication' | 'hydration' | 'exercise' | 'checkin' | 'report_followup';
  title: string;
  message: string;
  schedule: ReminderSchedule;
  enabled: boolean;
  lastFiredAt?: string;
  nextDueAt?: string;
  createdAt: string;
}

export type DeviceProvider =
  | 'health_connect'
  | 'healthkit'
  | 'fitbit'
  | 'garmin'
  | 'oura'
  | 'manual';

export interface DeviceConnection {
  id: string;
  userId: string;
  memberId: string;
  provider: DeviceProvider;
  displayName: string;
  status: 'connected' | 'disconnected' | 'error';
  scopes: string[];
  lastSyncAt?: string;
  lastError?: string;
  createdAt: string;
}

export type SafetyFindingKind =
  | 'drug_drug'
  | 'drug_allergy'
  | 'drug_condition'
  | 'duplicate_therapy';

export interface SafetyFinding {
  kind: SafetyFindingKind;
  severity: 'low' | 'moderate' | 'high';
  medication: string;
  interactsWith: string;
  description: string;
  source: string;
}

export interface SafetyCheck {
  id: string;
  userId: string;
  memberId: string;
  trigger: 'prescription_upload' | 'medication_add' | 'manual';
  sourceLabel: string;
  medications: Array<{ name: string; dose?: string }>;
  findings: SafetyFinding[];
  /** Non-alarming observations, e.g. an expected condition match. */
  notes?: string[];
  highestSeverity: 'none' | 'low' | 'moderate' | 'high';
  createdAt: string;
}

// -------------------------------------------------------------
// Conversation memory (agent)
// -------------------------------------------------------------

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

export interface Conversation {
  id: string;
  userId: string;
  memberId: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

// -------------------------------------------------------------
// Follow-up tracker
//
// Tasks that come out of a visit or a report, and what still has to
// happen. A task is a thing the person has to do, not something the
// app has already done on their behalf.
// -------------------------------------------------------------

export type FollowUpKind =
  | 'appointment'
  | 'test'
  | 'bring_records'
  | 'review_instructions'
  | 'medication_review'
  | 'other';

export type FollowUpStatus = 'pending' | 'done' | 'dismissed';

export interface FollowUpTask {
  id: string;
  userId: string;
  memberId: string;
  title: string;
  /** The wording taken from the source document, where possible. */
  detail?: string;
  kind: FollowUpKind;
  /** YYYY-MM-DD. Only set when a date was actually written down. */
  dueDate?: string;
  /** HH:MM. Only set when a time was actually written down. */
  dueTime?: string;
  source: 'visit_instructions' | 'manual' | 'agent';
  sourceLabel?: string;
  status: FollowUpStatus;
  createdAt: string;
  completedAt?: string;
  /** The reminder this task was turned into, if any. */
  reminderId?: string;
  /**
   * True only when a notification is genuinely scheduled to fire.
   * The app never claims to have notified anyone otherwise.
   */
  reminderScheduled: boolean;
  /** Set when the task was rewritten to keep it safe. */
  safetyNote?: string;
}

// -------------------------------------------------------------
// Fitness
// -------------------------------------------------------------

export interface FitnessToday {
  steps: number;
  stepGoal: number;
  heartRateBpm: number;
  restingHeartRate: number;
  sleepHours: number;
  sleepQuality: string;
  deepSleepMinutes: number;
  remSleepMinutes: number;
  caloriesBurned: number;
  activeMinutes: number;
  distanceKm: number;
  bloodPressure: string;
  wellnessScore: number;
}

export interface FitnessData {
  syncStatus: string;
  today: FitnessToday;
  weeklySteps: Array<{ day: string; steps: number; goal: number }>;
  heartRateTrends: Array<{ time: string; bpm: number }>;
  sleepTrends: Array<{ day: string; hours: number }>;
  recentWorkouts: Array<{ type: string; duration: string; calories: number; distance: string; date: string }>;
}

export interface Appointment {
  id: string;
  userId: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
  date: string;
  slot: string;
  status: 'confirmed' | 'cancelled';
  createdAt: string;
}
