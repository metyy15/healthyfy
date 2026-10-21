export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  city?: string;
  preferences?: { medicationAlarms: boolean; hydrationAlerts: boolean; reportReadyAlerts: boolean; fitnessMilestones: boolean };
}

export interface FamilyMember {
  id: string;
  userId: string;
  name: string;
  relationship: 'Self' | 'Father' | 'Mother' | 'Sister' | 'Brother' | 'Child' | 'Spouse' | 'Other';
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  bloodGroup: string;
  allergies: string[];
  existingConditions: string[];
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
  syncEnabled: boolean;
  syncStatus: string;
  today: FitnessToday;
  weeklySteps: Array<{ day: string; steps: number; goal: number }>;
  heartRateTrends: Array<{ time: string; bpm: number }>;
  sleepTrends: Array<{ day: string; hours: number }>;
  recentWorkouts: Array<{ type: string; duration: string; calories: number; distance: string; date: string }>;
}

export interface MealItem {
  title: string;
  items: string[];
  calories: string;
  protein: string;
  keyBenefit: string;
}

export interface DietPlan {
  overview: string;
  calorieTarget: string;
  meals: {
    breakfast: MealItem;
    midMorningSnack: MealItem;
    lunch: MealItem;
    eveningSnack: MealItem;
    dinner: MealItem;
  };
  weeklyMealIdeas: string[];
  hydrationTips: string[];
  groceryList: string[];
  healthyAlternatives: Array<{ craving: string; swap: string; benefit: string }>;
  disclaimer: string;
}

// -------------------------------------------------------------
// Clinical safety model
// -------------------------------------------------------------

export interface Medication {
  id: string;
  userId: string;
  memberId: string;
  name: string;
  genericName?: string;
  rxNormId?: string;
  dose: string;
  route?: string;
  frequency: string;
  times: string[];
  startDate: string;
  endDate?: string;
  prescribedBy?: string;
  instructions?: string;
  active: boolean;
  source: 'typed' | 'prescription_upload' | 'lab_report' | 'health_connect' | 'healthkit' | 'wearable_api' | 'imported';
  createdAt: string;
}

export interface AllergyRecord {
  id: string;
  userId: string;
  memberId: string;
  substance: string;
  reaction?: string;
  severity: 'mild' | 'moderate' | 'severe' | 'unknown';
  verifiedAt: string;
  source: string;
  createdAt: string;
}

export type VitalType = 'heart_rate' | 'steps' | 'spo2' | 'blood_pressure' | 'sleep_hours' | 'weight' | 'temperature';

export interface Vital {
  id: string;
  userId: string;
  memberId: string;
  type: VitalType;
  value: number;
  secondaryValue?: number;
  unit: string;
  measuredAt: string;
  source: string;
  deviceId?: string;
  context?: 'resting' | 'active' | 'post-exercise' | 'sleep' | 'unknown';
}

export interface CaregiverLink {
  id: string;
  userId: string;
  memberId: string;
  caregiverUserId?: string;
  caregiverName: string;
  caregiverEmail?: string;
  caregiverPhone?: string;
  relation: string;
  permission: 'view' | 'manage';
  channels: Array<'push' | 'sms' | 'email'>;
  createdAt: string;
}

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
  type: 'heart_rate' | 'fall' | 'spo2' | 'inactivity' | 'medication_missed' | 'safety' | 'manual';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  status: 'open' | 'acknowledged' | 'resolved' | 'cancelled';
  detectedAt: string;
  snapshot: Record<string, any>;
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

export interface Reminder {
  id: string;
  userId: string;
  memberId: string;
  type: 'medication' | 'hydration' | 'exercise' | 'checkin' | 'report_followup';
  title: string;
  message: string;
  schedule: { kind: string; times: string[]; days?: number[]; everyMinutes?: number; at?: string };
  enabled: boolean;
  lastFiredAt?: string;
  nextDueAt?: string;
  createdAt: string;
}

export interface DeviceConnection {
  id: string;
  userId: string;
  memberId: string;
  provider: 'health_connect' | 'healthkit' | 'fitbit' | 'garmin' | 'oura' | 'manual';
  displayName: string;
  status: 'connected' | 'disconnected' | 'error';
  scopes: string[];
  lastSyncAt?: string;
  lastError?: string;
  createdAt: string;
}

export interface SafetyFinding {
  kind: 'drug_drug' | 'drug_allergy' | 'drug_condition' | 'duplicate_therapy';
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
  notes?: string[];
  highestSeverity: 'none' | 'low' | 'moderate' | 'high';
  createdAt: string;
}

export interface SafetyResult {
  highestSeverity: 'none' | 'low' | 'moderate' | 'high';
  findings: SafetyFinding[];
  notes: string[];
  message: string;
  checkId?: string;
}

export interface ExtractedMedication {
  name: string;
  genericName?: string;
  dose: string;
  frequency: string;
  times: string[];
  route?: string;
  duration?: string;
  instructions?: string;
  confidence: number;
  brandName?: string;
}

export interface ExtractedAllergy {
  substance: string;
  reaction?: string;
  severity: 'mild' | 'moderate' | 'severe' | 'unknown';
  confidence: number;
}

export interface PrescriptionExtraction {
  prescriber?: string;
  clinic?: string;
  date?: string;
  medications: ExtractedMedication[];
  allergies: ExtractedAllergy[];
  conditionsMentioned: string[];
  notes?: string;
  documentQuality: 'clear' | 'partial' | 'illegible';
  needsVerification: string[];
}

export interface PrescriptionAnalysis {
  extraction: PrescriptionExtraction;
  safety: SafetyResult;
  committed: boolean;
  createdMedications: Medication[];
  createdAllergies: number;
  degraded: boolean;
}

// -------------------------------------------------------------
// Monitoring + agent
// -------------------------------------------------------------

export interface HeartRateAnalysis {
  baseline: number;
  latest: number;
  latestAt: string;
  samplesInWindow: number;
  sustained: boolean;
  likelyExercise: boolean;
  stepsLast30Min: number;
  classification: 'normal' | 'elevated' | 'critical' | 'bradycardia';
  rationale: string;
}

export interface MonitorOverview {
  members: Array<{
    memberId: string;
    memberName: string;
    relationship: string;
    heartRate: HeartRateAnalysis | null;
    openAlerts: number;
    caregivers: Array<{ name: string; relation: string; permission: string; channels: string[] }>;
    devices: Array<{ id: string; provider: string; displayName: string; status: string; lastSyncAt?: string }>;
  }>;
  push: { inApp: boolean; fcm: boolean; sms: boolean; note: string };
  scheduler: { enabled: boolean; running: boolean; tickMs: number; ticks: number };
}

export interface BriefingInsight {
  memberId: string;
  memberName: string;
  kind: 'adherence' | 'labs' | 'vitals' | 'alert' | 'plan' | 'medication';
  severity: 'info' | 'warning' | 'critical';
  headline: string;
  detail: string;
  action?: string;
}

export interface BriefingMember {
  memberId: string;
  memberName: string;
  relationship: string;
  dosesScheduledToday: number;
  dosesDueToday: number;
  dosesTakenToday: number;
  dosesMissedToday: number;
  adherenceRate14d: number | null;
  medicationsNeedingAttention: string[];
  latestAbnormalValues: Array<{ test: string; result: string; date: string; status: string }>;
  openAlerts: number;
  heartRateNote: string | null;
  exerciseTarget: string | null;
}

export interface DailyBriefing {
  userId: string;
  generatedAt: string;
  members: BriefingMember[];
  insights: BriefingInsight[];
  narrative: string;
  questionsForTheDoctor: string[];
  degraded: boolean;
}

export interface Citation {
  pmid: string;
  title: string;
  journal: string;
  year: string;
  url: string;
}

export interface ExerciseRecommendation {
  memberId: string;
  memberName: string;
  generatedAt: string;
  basis: string[];
  targets: {
    weeklyAerobicMinutes: number;
    strengthSessionsPerWeek: number;
    dailySteps: number;
    hydrationLitres: number;
    weeklyBalanceSessions: number;
  };
  intensityGuidance: string;
  safetyNotes: string[];
  weeklyPlan: Array<{ day: string; focus: string; durationMinutes: number; detail: string }>;
  progressRule: string;
  /** Real papers from PubMed that support the targets, when available. */
  citations: Citation[];
  disclaimer: string;
}

export interface ToolTraceEntry {
  step: number;
  name: string;
  args: Record<string, any>;
  result?: any;
  ok: boolean;
  error?: string;
  durationMs: number;
  pending: boolean;
}

export interface PendingAction {
  id: string;
  toolName: string;
  args: Record<string, any>;
  label: string;
  createdAt: string;
  userId: string;
  memberId: string;
}

export interface ChatResponse {
  reply: string;
  trace: ToolTraceEntry[];
  conversationId: string;
  pendingActionIds: string[];
  turns: number;
  usedFallbackModel: boolean;
  error?: string;
}

export interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  geminiConfigured: boolean;
  asiOneConfigured: boolean;
  model: string;
  fallbackModel: string;
  roles: {
    app: { id: string; label: string; configured: boolean };
    vision: { id: string; label: string; configured: boolean };
    agent: { id: string; label: string; configured: boolean };
  };
  chain: Array<{ id: string; label: string; configured: boolean }>;
  agent: {
    name: string;
    address: string;
    seed: boolean;
    registered: boolean;
    agentverseUrl: string;
    live: {
      reachable: boolean;
      status?: string;
      asi1Configured?: boolean;
      healthyfyBaseUrl?: string;
      mailbox?: boolean;
      address?: string;
    };
  };
  asiOne: {
    baseUrl: string;
    configured: boolean;
    docsUrl: string;
    signupUrl: string;
    agentverseUrl: string;
  };
  freeData: {
    openfda: { enabled: boolean; baseUrl: string; requiresKey: boolean; note: string };
    pubmed: { enabled: boolean; baseUrl: string; requiresKey: boolean; note: string };
    rxnorm: { enabled: boolean; baseUrl: string; requiresKey: boolean; note: string };
  };
}

// -------------------------------------------------------------
// Report comparison
// -------------------------------------------------------------

export interface ReportOption {
  id: string;
  reportType: string;
  title: string;
  date: string;
}

export interface ValueSide {
  raw: string;
  value: number | null;
  unit?: string;
  date: string;
  inRange?: boolean;
  rangeText?: string;
}

export type ComparisonDirection = 'increased' | 'decreased' | 'unchanged' | 'not_comparable';

export type ComparisonSignificance =
  | 'moved_out_of_range'
  | 'moved_into_range'
  | 'notable_change'
  | 'minor_change'
  | 'stable'
  | 'not_comparable';

export interface ValueChange {
  testName: string;
  unit?: string;
  previous: ValueSide;
  latest: ValueSide;
  direction: ComparisonDirection;
  absoluteChange?: number;
  percentChange?: number;
  significance: ComparisonSignificance;
  rangeChanged: boolean;
  note?: string;
}

export interface SkippedComparison {
  testName: string;
  reason: string;
}

export interface ComparisonResponse {
  comparable: boolean;
  reason?: string;
  memberId?: string;
  memberName?: string;
  older?: { id: string; title: string; reportType: string; date: string; laboratory: string };
  latest?: { id: string; title: string; reportType: string; date: string; laboratory: string };
  changes: ValueChange[];
  skipped: SkippedComparison[];
  questions: string[];
  summary: string;
  disclaimer: string;
  availableReports: ReportOption[];
}

// -------------------------------------------------------------
// Follow-up tracker
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
  detail?: string;
  kind: FollowUpKind;
  dueDate?: string;
  dueTime?: string;
  source: 'visit_instructions' | 'manual' | 'agent';
  sourceLabel?: string;
  status: FollowUpStatus;
  createdAt: string;
  completedAt?: string;
  reminderId?: string;
  reminderScheduled: boolean;
  safetyNote?: string;
}

export interface ExtractedTask {
  title: string;
  kind: FollowUpKind;
  detail: string;
  dueDate?: string;
  dueTime?: string;
  confidence: number;
  unsupported: boolean;
  safetyNote?: string;
}

export interface FollowUpExtraction {
  memberId: string;
  memberName: string;
  tasks: ExtractedTask[];
  unreadableParts: string[];
  visitDate?: string;
  prescriber?: string;
  notes?: string;
  degraded: boolean;
  saved: boolean;
  notice: string;
}

export interface UpcomingFollowUps {
  overdue: FollowUpTask[];
  today: FollowUpTask[];
  thisWeek: FollowUpTask[];
  later: FollowUpTask[];
  days: number;
  summary: string;
}
