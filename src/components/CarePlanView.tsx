import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpen,
  CalendarClock,
  Check,
  ClipboardCheck,
  Droplets,
  ExternalLink,
  FileText,
  Footprints,
  Gauge,
  Heart,
  Info,
  Mail,
  MessageSquare,
  Pill,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Users,
  Watch,
} from 'lucide-react';
import { api } from '../api';
import {
  CaregiverLink,
  DeviceConnection,
  ExerciseRecommendation,
  FamilyMember,
  Reminder,
  Vital,
} from '../types';

interface CarePlanViewProps {
  familyMembers: FamilyMember[];
  activeMember: FamilyMember | null;
  onSelectMember: (member: FamilyMember) => void;
}

type ReminderType = Reminder['type'];
type CaregiverChannel = CaregiverLink['channels'][number];
type DeviceProvider = DeviceConnection['provider'];

const REMINDER_TYPES: Array<{ value: ReminderType; label: string; icon: typeof Pill }> = [
  { value: 'medication', label: 'Medication', icon: Pill },
  { value: 'hydration', label: 'Hydration', icon: Droplets },
  { value: 'exercise', label: 'Exercise', icon: Activity },
  { value: 'checkin', label: 'Check-in', icon: ClipboardCheck },
  { value: 'report_followup', label: 'Report follow-up', icon: FileText },
];

const REMINDER_BADGE: Record<ReminderType, string> = {
  medication: 'bg-rose-50 text-rose-700',
  hydration: 'bg-sky-50 text-sky-700',
  exercise: 'bg-emerald-50 text-emerald-700',
  checkin: 'bg-violet-50 text-violet-700',
  report_followup: 'bg-slate-100 text-slate-600',
};

const CHANNEL_META: Array<{ value: CaregiverChannel; label: string; icon: typeof Smartphone }> = [
  { value: 'push', label: 'Push', icon: Smartphone },
  { value: 'sms', label: 'SMS', icon: MessageSquare },
  { value: 'email', label: 'Email', icon: Mail },
];

const DEVICE_PROVIDERS: Array<{
  value: DeviceProvider;
  label: string;
  note: string;
}> = [
  {
    value: 'health_connect',
    label: 'Health Connect (Android)',
    note: 'Reads steps and heart rate straight from the phone and any paired watch.',
  },
  {
    value: 'healthkit',
    label: 'HealthKit (Apple)',
    note: 'Reads steps and heart rate straight from the iPhone and Apple Watch.',
  },
  {
    value: 'fitbit',
    label: 'Fitbit',
    note: 'Syncs with Fitbit servers. No app on this device is involved.',
  },
  {
    value: 'garmin',
    label: 'Garmin',
    note: 'Syncs with Garmin servers. No app on this device is involved.',
  },
  {
    value: 'oura',
    label: 'Oura',
    note: 'Syncs with Oura servers. No app on this device is involved.',
  },
  {
    value: 'manual',
    label: 'Manual entry',
    note: 'Readings are typed in by hand, so nothing syncs automatically.',
  },
];

const DEVICE_SCOPES: Array<{ value: string; label: string }> = [
  { value: 'steps', label: 'Steps' },
  { value: 'heart_rate', label: 'Heart rate' },
  { value: 'sleep_hours', label: 'Sleep' },
  { value: 'spo2', label: 'Blood oxygen' },
];

const STATUS_BADGE: Record<DeviceConnection['status'], string> = {
  connected: 'bg-emerald-50 text-emerald-700',
  disconnected: 'bg-slate-100 text-slate-600',
  error: 'bg-rose-50 text-rose-700',
};

const REMINDER_PRESETS: Array<{
  label: string;
  type: ReminderType;
  title: string;
  message: string;
  times: string;
}> = [
  {
    label: 'Hydration',
    type: 'hydration',
    title: 'Drink a glass of water',
    message: 'Time for a glass of water.',
    times: '11:00, 15:00, 19:30',
  },
  {
    label: 'Evening walk',
    type: 'exercise',
    title: 'Evening walk',
    message: 'A gentle walk to close out the day.',
    times: '18:30',
  },
];

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseTimes(raw: string): string[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => TIME_PATTERN.test(value));
}

function formatDateTime(iso?: string): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

const ErrorNote: React.FC<{ message: string }> = ({ message }) => (
  <div className="inline-flex items-start gap-2 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
    <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
    <span className="leading-relaxed">{message}</span>
  </div>
);

const MicroLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{children}</span>
);

const SectionCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, description, action, children }) => (
  <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 sm:p-6 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        <span className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
          {icon}
        </span>
        <div>
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          {description ? (
            <p className="text-xs sm:text-[13px] text-slate-600 mt-0.5 leading-relaxed">{description}</p>
          ) : null}
        </div>
      </div>
      {action}
    </div>
    {children}
  </section>
);

const StatTile: React.FC<{
  label: string;
  value: string;
  unit?: string;
  hint: string;
  icon: React.ReactNode;
}> = ({ label, value, unit, hint, icon }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-1.5">
    <div className="flex items-center justify-between gap-2">
      <MicroLabel>{label}</MicroLabel>
      <span className="text-slate-400">{icon}</span>
    </div>
    <div className="text-xl font-extrabold text-slate-900 tabular-nums">
      {value}
      {unit ? <span className="text-xs font-semibold text-slate-400 ml-1">{unit}</span> : null}
    </div>
    <div className="text-[10px] text-slate-400 leading-relaxed">{hint}</div>
  </div>
);

export const CarePlanView: React.FC<CarePlanViewProps> = ({
  familyMembers,
  activeMember,
  onSelectMember,
}) => {
  const currentMember = activeMember || familyMembers[0] || null;
  const memberId = currentMember ? currentMember.id : null;

  const [plan, setPlan] = useState<ExerciseRecommendation | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [caregivers, setCaregivers] = useState<CaregiverLink[]>([]);
  const [devices, setDevices] = useState<DeviceConnection[]>([]);
  const [vitals, setVitals] = useState<Vital[]>([]);

  const [planLoading, setPlanLoading] = useState(false);
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [caregiversLoading, setCaregiversLoading] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(false);

  const [planError, setPlanError] = useState<string | null>(null);
  const [remindersError, setRemindersError] = useState<string | null>(null);
  const [caregiversError, setCaregiversError] = useState<string | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [reminderActionError, setReminderActionError] = useState<string | null>(null);
  const [caregiverError, setCaregiverError] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingReminder, setSavingReminder] = useState(false);
  const [savingCaregiver, setSavingCaregiver] = useState(false);
  const [savingDevice, setSavingDevice] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  // Reminder form
  const [reminderType, setReminderType] = useState<ReminderType>('hydration');
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderMessage, setReminderMessage] = useState('');
  const [reminderTimes, setReminderTimes] = useState('08:00, 20:00');

  // Caregiver form
  const [caregiverName, setCaregiverName] = useState('');
  const [caregiverRelation, setCaregiverRelation] = useState('');
  const [caregiverPhone, setCaregiverPhone] = useState('');
  const [caregiverPermission, setCaregiverPermission] = useState<CaregiverLink['permission']>('view');
  const [caregiverChannels, setCaregiverChannels] = useState<CaregiverChannel[]>(['push']);

  // Device form
  const [deviceProvider, setDeviceProvider] = useState<DeviceProvider>('health_connect');
  const [deviceName, setDeviceName] = useState('');
  const [deviceScopes, setDeviceScopes] = useState<string[]>(['steps', 'heart_rate']);

  const loadPlan = useCallback(async (id: string) => {
    setPlanLoading(true);
    setPlanError(null);
    try {
      const data = await api.getExercisePlan(id);
      setPlan(data);
    } catch (err) {
      setPlan(null);
      setPlanError(errorMessage(err, 'Could not load the activity plan.'));
    } finally {
      setPlanLoading(false);
    }
  }, []);

  const loadReminders = useCallback(async (id: string) => {
    setRemindersLoading(true);
    setRemindersError(null);
    try {
      const data = await api.getReminders(id);
      setReminders(data);
    } catch (err) {
      setReminders([]);
      setRemindersError(errorMessage(err, 'Could not load reminders.'));
    } finally {
      setRemindersLoading(false);
    }
  }, []);

  const loadCaregivers = useCallback(async (id: string) => {
    setCaregiversLoading(true);
    setCaregiversError(null);
    try {
      const data = await api.getCaregivers(id);
      setCaregivers(data);
    } catch (err) {
      setCaregivers([]);
      setCaregiversError(errorMessage(err, 'Could not load caregivers.'));
    } finally {
      setCaregiversLoading(false);
    }
  }, []);

  const loadDevices = useCallback(async (id: string) => {
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      const data = await api.getDevices(id);
      setDevices(data);
    } catch (err) {
      setDevices([]);
      setDevicesError(errorMessage(err, 'Could not load connected devices.'));
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  const loadVitals = useCallback(async (id: string) => {
    try {
      const data = await api.getVitals({ memberId: id, hours: 24 });
      setVitals(data);
    } catch {
      setVitals([]);
    }
  }, []);

  useEffect(() => {
    if (!memberId) {
      setPlan(null);
      setReminders([]);
      setCaregivers([]);
      setDevices([]);
      setVitals([]);
      return;
    }
    loadPlan(memberId);
    loadReminders(memberId);
    loadCaregivers(memberId);
    loadDevices(memberId);
    loadVitals(memberId);
  }, [memberId, loadPlan, loadReminders, loadCaregivers, loadDevices, loadVitals]);

  const handleToggleReminder = async (reminder: Reminder) => {
    setBusyId(reminder.id);
    setReminderActionError(null);
    try {
      const updated = await api.updateReminder(reminder.id, { enabled: !reminder.enabled });
      setReminders((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setReminderActionError(errorMessage(err, 'Could not update the reminder.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteReminder = async (reminder: Reminder) => {
    setBusyId(reminder.id);
    setReminderActionError(null);
    try {
      await api.deleteReminder(reminder.id);
      setReminders((prev) => prev.filter((item) => item.id !== reminder.id));
    } catch (err) {
      setReminderActionError(errorMessage(err, 'Could not delete the reminder.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleAddReminder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!memberId) return;
    setReminderActionError(null);

    if (!reminderTitle.trim()) {
      setReminderActionError('Give the reminder a title so it is recognisable on the phone.');
      return;
    }
    const times = parseTimes(reminderTimes);
    if (!times.length) {
      setReminderActionError('Add at least one time in HH:MM format, for example 08:00, 20:00.');
      return;
    }

    setSavingReminder(true);
    try {
      const created = await api.addReminder({
        memberId,
        type: reminderType,
        title: reminderTitle.trim(),
        message: reminderMessage.trim(),
        times,
      });
      setReminders((prev) => [...prev, created]);
      setReminderTitle('');
      setReminderMessage('');
    } catch (err) {
      setReminderActionError(errorMessage(err, 'Could not create the reminder.'));
    } finally {
      setSavingReminder(false);
    }
  };

  const applyPreset = (preset: (typeof REMINDER_PRESETS)[number]) => {
    setReminderType(preset.type);
    setReminderTitle(preset.title);
    setReminderMessage(preset.message);
    setReminderTimes(preset.times);
    setReminderActionError(null);
  };

  const handleAddCaregiver = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!memberId) return;
    setCaregiverError(null);

    if (!caregiverName.trim()) {
      setCaregiverError('Enter the name of the person who should be notified.');
      return;
    }
    if (!caregiverChannels.length) {
      setCaregiverError('Choose at least one notification channel.');
      return;
    }

    setSavingCaregiver(true);
    try {
      const created = await api.addCaregiver({
        memberId,
        caregiverName: caregiverName.trim(),
        relation: caregiverRelation.trim() || 'Family',
        caregiverPhone: caregiverPhone.trim(),
        permission: caregiverPermission,
        channels: caregiverChannels,
      });
      setCaregivers((prev) => [...prev, created]);
      setCaregiverName('');
      setCaregiverRelation('');
      setCaregiverPhone('');
      setCaregiverPermission('view');
      setCaregiverChannels(['push']);
    } catch (err) {
      setCaregiverError(errorMessage(err, 'Could not add the caregiver.'));
    } finally {
      setSavingCaregiver(false);
    }
  };

  const handleDeleteCaregiver = async (caregiver: CaregiverLink) => {
    setBusyId(caregiver.id);
    setCaregiverError(null);
    try {
      await api.deleteCaregiver(caregiver.id);
      setCaregivers((prev) => prev.filter((item) => item.id !== caregiver.id));
    } catch (err) {
      setCaregiverError(errorMessage(err, 'Could not remove the caregiver.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleAddDevice = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!memberId) return;
    setDeviceError(null);
    setSavingDevice(true);
    try {
      const providerMeta = DEVICE_PROVIDERS.find((item) => item.value === deviceProvider);
      const created = await api.addDevice({
        memberId,
        provider: deviceProvider,
        displayName: deviceName.trim() || (providerMeta ? providerMeta.label : deviceProvider),
        scopes: deviceScopes,
      });
      setDevices((prev) => [...prev, created]);
      setDeviceName('');
      setSyncNote(null);
    } catch (err) {
      setDeviceError(errorMessage(err, 'Could not connect the device.'));
    } finally {
      setSavingDevice(false);
    }
  };

  const handleDeleteDevice = async (device: DeviceConnection) => {
    setBusyId(device.id);
    setDeviceError(null);
    try {
      await api.deleteDevice(device.id);
      setDevices((prev) => prev.filter((item) => item.id !== device.id));
    } catch (err) {
      setDeviceError(errorMessage(err, 'Could not disconnect the device.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleSimulateSync = async (device: DeviceConnection) => {
    setBusyId(device.id);
    setDeviceError(null);
    setSyncNote(null);
    const now = Date.now();
    try {
      const result = await api.syncDeviceSamples(device.id, [
        { type: 'heart_rate', value: 72, unit: 'bpm', measuredAt: new Date(now - 120000).toISOString() },
        { type: 'heart_rate', value: 81, unit: 'bpm', measuredAt: new Date(now - 60000).toISOString() },
        { type: 'steps', value: 320, unit: 'steps', measuredAt: new Date(now).toISOString() },
      ]);
      setSyncNote(
        `The sync endpoint accepted ${result.accepted} sample${result.accepted === 1 ? '' : 's'} for ${device.displayName}.`
      );
      if (memberId) {
        await loadDevices(memberId);
        await loadVitals(memberId);
      }
    } catch (err) {
      setDeviceError(errorMessage(err, 'The simulated sync failed.'));
    } finally {
      setBusyId(null);
    }
  };

  const toggleChannel = (channel: CaregiverChannel) => {
    setCaregiverChannels((prev) =>
      prev.includes(channel) ? prev.filter((item) => item !== channel) : [...prev, channel]
    );
  };

  const toggleScope = (scope: string) => {
    setDeviceScopes((prev) =>
      prev.includes(scope) ? prev.filter((item) => item !== scope) : [...prev, scope]
    );
  };

  if (!currentMember) {
    return (
      <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-8 text-center text-xs sm:text-[13px] text-slate-500">
        Add a family member to build a care plan with activity targets, reminders, caregivers and devices.
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md mb-1">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            <span>Care Plan</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Care plan</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Activity targets, reminders, caregivers and devices for {currentMember.name}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={currentMember.id}
            onChange={(e) => {
              const member = familyMembers.find((item) => item.id === e.target.value);
              if (member) onSelectMember(member);
            }}
            className="text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 outline-hidden cursor-pointer"
          >
            {familyMembers.map((member) => (
              <option key={member.id} value={member.id}>
                Context: {member.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Section A - Activity and step plan */}
      <SectionCard
        title="Activity and step plan"
        icon={<Activity className="w-4 h-4" />}
        description="Targets are derived from the conditions, medications and lab values on file, so each one is traceable to a record."
      >
        {planError ? <ErrorNote message={planError} /> : null}

        {planLoading && !plan ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Building the activity plan…</span>
          </div>
        ) : null}

        {plan ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <StatTile
                label="Aerobic minutes"
                value={String(plan.targets.weeklyAerobicMinutes)}
                unit="min/wk"
                hint="Total across the week"
                icon={<Heart className="w-4 h-4 text-rose-500" />}
              />
              <StatTile
                label="Strength sessions"
                value={String(plan.targets.strengthSessionsPerWeek)}
                unit="/wk"
                hint="Resistance work per week"
                icon={<Activity className="w-4 h-4 text-emerald-600" />}
              />
              <StatTile
                label="Daily steps"
                value={plan.targets.dailySteps.toLocaleString()}
                unit="steps"
                hint="Every day of the week"
                icon={<Footprints className="w-4 h-4 text-blue-500" />}
              />
              <StatTile
                label="Hydration"
                value={String(plan.targets.hydrationLitres)}
                unit="L/day"
                hint="Unless the doctor says otherwise"
                icon={<Droplets className="w-4 h-4 text-sky-500" />}
              />
              {plan.targets.weeklyBalanceSessions > 0 ? (
                <StatTile
                  label="Balance sessions"
                  value={String(plan.targets.weeklyBalanceSessions)}
                  unit="/wk"
                  hint="Added for fall-risk reduction"
                  icon={<ShieldCheck className="w-4 h-4 text-violet-500" />}
                />
              ) : null}
            </div>

            {/* Why this plan */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <Info className="w-3.5 h-3.5 text-slate-400" />
                <h3 className="text-sm font-bold text-slate-900">Why this plan</h3>
              </div>
              {plan.basis.length ? (
                <ul className="space-y-1.5">
                  {plan.basis.map((reason, index) => (
                    <li key={index} className="flex items-start gap-2 text-xs sm:text-[13px] text-slate-600 leading-relaxed">
                      <Check className="w-3.5 h-3.5 mt-0.5 text-emerald-600 shrink-0" />
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">
                  No conditions, medications or lab results are on file yet, so these are general adult defaults.
                </p>
              )}
            </div>

            {/* Weekly plan */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-3.5 h-3.5 text-slate-400" />
                <h3 className="text-sm font-bold text-slate-900">The week ahead</h3>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full min-w-[620px] text-left">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="py-2.5 px-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">Day</th>
                      <th className="py-2.5 px-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">Focus</th>
                      <th className="py-2.5 px-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">Minutes</th>
                      <th className="py-2.5 px-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plan.weeklyPlan.map((session) => (
                      <tr key={session.day} className="align-top">
                        <td className="py-2.5 px-3 text-xs font-bold text-slate-900 whitespace-nowrap">{session.day}</td>
                        <td className="py-2.5 px-3 text-xs font-semibold text-slate-700">{session.focus}</td>
                        <td className="py-2.5 px-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                          {session.durationMinutes} min
                        </td>
                        <td className="py-2.5 px-3 text-xs text-slate-600 leading-relaxed">{session.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Intensity guidance */}
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-emerald-900">Intensity guidance</h3>
              </div>
              <p className="text-xs sm:text-[13px] text-emerald-900/90 leading-relaxed">{plan.intensityGuidance}</p>
              <p className="text-[11px] text-emerald-800/80 leading-relaxed">
                Judge the effort by how the session feels rather than by a heart-rate number. This matters when a
                medicine such as a beta blocker flattens the heart-rate response, so the watch can show a calm-looking
                reading during hard work.
              </p>
            </div>

            {/* Evidence from PubMed */}
            {plan.citations && plan.citations.length ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2.5">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-sm font-bold text-slate-800">Supporting evidence</h3>
                  <span className="text-[10px] text-slate-400">from PubMed</span>
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  The targets above are generated from the records stored here. These are the
                  published papers they rest on, so you can check them rather than take them on
                  trust.
                </p>
                <ul className="space-y-2">
                  {plan.citations.map((citation) => (
                    <li key={citation.pmid}>
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group block rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:border-emerald-300 transition-colors"
                      >
                        <p className="text-[11px] sm:text-xs font-semibold text-slate-800 leading-snug group-hover:text-emerald-700">
                          {citation.title}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-slate-600">{citation.journal}</span>
                          {citation.year && <span>· {citation.year}</span>}
                          <span className="inline-flex items-center gap-0.5 text-emerald-600">
                            PubMed
                            <ExternalLink className="w-2.5 h-2.5" />
                          </span>
                        </p>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Safety notes */}
            {plan.safetyNotes.length ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <h3 className="text-sm font-bold text-amber-900">Safety notes</h3>
                </div>
                <ul className="space-y-1.5">
                  {plan.safetyNotes.map((note, index) => (
                    <li key={index} className="flex items-start gap-2 text-xs sm:text-[13px] text-amber-900/90 leading-relaxed">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="pt-1 border-t border-slate-100 space-y-1.5">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                <strong className="text-slate-600">Progress rule:</strong> {plan.progressRule}
              </p>
              <p className="text-[10px] text-slate-400 leading-relaxed">{plan.disclaimer}</p>
            </div>
          </div>
        ) : null}
      </SectionCard>

      {/* Section B - Reminders */}
      <SectionCard
        title="Reminders"
        icon={<Bell className="w-4 h-4" />}
        description="Daily nudges sent to the family member on their phone."
        action={
          remindersLoading ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Loading</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
              {reminders.length} active
            </span>
          )
        }
      >
        {remindersError ? <ErrorNote message={remindersError} /> : null}
        {reminderActionError ? <ErrorNote message={reminderActionError} /> : null}

        {reminders.length ? (
          <div className="space-y-2.5">
            {reminders.map((reminder) => {
              const typeMeta = REMINDER_TYPES.find((item) => item.value === reminder.type);
              const TypeIcon = typeMeta ? typeMeta.icon : Bell;
              return (
                <div
                  key={reminder.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
                >
                  <div className="space-y-2 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          REMINDER_BADGE[reminder.type]
                        }`}
                      >
                        <TypeIcon className="w-3 h-3" />
                        {typeMeta ? typeMeta.label : reminder.type}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          reminder.enabled
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {reminder.enabled ? 'Enabled' : 'Paused'}
                      </span>
                    </div>
                    <div className="text-xs sm:text-[13px] font-bold text-slate-900">{reminder.title}</div>
                    {reminder.message ? (
                      <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">{reminder.message}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {reminder.schedule.times.map((time) => (
                        <span
                          key={time}
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600"
                        >
                          <CalendarClock className="w-3 h-3" />
                          {time}
                        </span>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-400">Last fired: {formatDateTime(reminder.lastFiredAt)}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleReminder(reminder)}
                      disabled={busyId === reminder.id}
                      className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {reminder.enabled ? 'Pause' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteReminder(reminder)}
                      disabled={busyId === reminder.id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : remindersLoading ? null : (
          <p className="text-xs sm:text-[13px] text-slate-500">
            No reminders yet. Add one below, or start from a preset.
          </p>
        )}

        {/* Add reminder */}
        <form onSubmit={handleAddReminder} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Plus className="w-3.5 h-3.5 text-slate-400" />
            <h3 className="text-sm font-bold text-slate-900">Add reminder</h3>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {REMINDER_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <Sparkles className="w-3 h-3 text-emerald-600" />
                {preset.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Type</label>
              <select
                value={reminderType}
                onChange={(e) => setReminderType(e.target.value as ReminderType)}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
              >
                {REMINDER_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Title</label>
              <input
                type="text"
                value={reminderTitle}
                onChange={(e) => setReminderTitle(e.target.value)}
                placeholder="Take the evening tablet"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Message</label>
            <input
              type="text"
              value={reminderMessage}
              onChange={(e) => setReminderMessage(e.target.value)}
              placeholder="One line shown on the lock screen"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Daily times</label>
            <input
              type="text"
              value={reminderTimes}
              onChange={(e) => setReminderTimes(e.target.value)}
              placeholder="08:00, 20:00"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
            />
            <p className="text-[10px] text-slate-400 mt-1">Comma separated, 24-hour clock. Example: 08:00, 13:00, 20:00</p>
          </div>

          <button
            type="submit"
            disabled={savingReminder}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {savingReminder ? 'Saving…' : 'Add reminder'}
          </button>
        </form>
      </SectionCard>

      {/* Section C - Caregivers */}
      <SectionCard
        title="Caregivers"
        icon={<Users className="w-4 h-4" />}
        description="These people are notified when an alert fires for this family member."
        action={
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
            {caregivers.length} linked
          </span>
        }
      >
        {caregiversError ? <ErrorNote message={caregiversError} /> : null}
        {caregiversLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Loading caregivers…</span>
          </div>
        ) : null}

        {caregivers.length ? (
          <div className="space-y-2.5">
            {caregivers.map((caregiver) => (
              <div
                key={caregiver.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="space-y-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs sm:text-[13px] font-bold text-slate-900">{caregiver.caregiverName}</span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                      {caregiver.relation}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                        caregiver.permission === 'manage'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {caregiver.permission === 'manage' ? 'Manage' : 'View only'}
                    </span>
                  </div>
                  {caregiver.caregiverPhone ? (
                    <p className="text-xs sm:text-[13px] text-slate-600">{caregiver.caregiverPhone}</p>
                  ) : (
                    <p className="text-xs text-slate-400">No phone number on file</p>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {caregiver.channels.length ? (
                      caregiver.channels.map((channel) => {
                        const channelMeta = CHANNEL_META.find((item) => item.value === channel);
                        const ChannelIcon = channelMeta ? channelMeta.icon : Bell;
                        return (
                          <span
                            key={channel}
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-sky-50 text-sky-700"
                          >
                            <ChannelIcon className="w-3 h-3" />
                            {channelMeta ? channelMeta.label : channel}
                          </span>
                        );
                      })
                    ) : (
                      <span className="text-[10px] text-slate-400">No notification channels</span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDeleteCaregiver(caregiver)}
                  disabled={busyId === caregiver.id}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-bold self-start shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : caregiversLoading ? null : (
          <p className="text-xs sm:text-[13px] text-slate-500">
            No caregivers linked yet. Add one so somebody is told when an alert fires.
          </p>
        )}

        <form onSubmit={handleAddCaregiver} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Plus className="w-3.5 h-3.5 text-slate-400" />
            <h3 className="text-sm font-bold text-slate-900">Add caregiver</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Name</label>
              <input
                type="text"
                value={caregiverName}
                onChange={(e) => setCaregiverName(e.target.value)}
                placeholder="Anita Sharma"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Relation</label>
              <input
                type="text"
                value={caregiverRelation}
                onChange={(e) => setCaregiverRelation(e.target.value)}
                placeholder="Daughter"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
              <input
                type="text"
                value={caregiverPhone}
                onChange={(e) => setCaregiverPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Permission</label>
              <select
                value={caregiverPermission}
                onChange={(e) => setCaregiverPermission(e.target.value as CaregiverLink['permission'])}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
              >
                <option value="view">View only — sees the record</option>
                <option value="manage">Manage — can also act on the record</option>
              </select>
            </div>
            <div>
              <span className="block text-xs font-semibold text-slate-700 mb-1">Channels</span>
              <div className="flex flex-wrap gap-2 pt-1.5">
                {CHANNEL_META.map((channel) => {
                  const active = caregiverChannels.includes(channel.value);
                  const ChannelIcon = channel.icon;
                  return (
                    <button
                      key={channel.value}
                      type="button"
                      onClick={() => toggleChannel(channel.value)}
                      className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-xl border ${
                        active
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <ChannelIcon className="w-3.5 h-3.5" />
                      {channel.label}
                      {active ? <Check className="w-3 h-3" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={savingCaregiver}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {savingCaregiver ? 'Saving…' : 'Add caregiver'}
          </button>
        </form>
      </SectionCard>

      {/* Section D - Devices */}
      <SectionCard
        title="Connected devices"
        icon={<Watch className="w-4 h-4" />}
        description="Where the steps and heart rate readings come from."
        action={
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
            {devices.length} connected
          </span>
        }
      >
        <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 space-y-1.5">
          <div className="flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-blue-600" />
            <h3 className="text-sm font-bold text-blue-900">How the readings arrive</h3>
          </div>
          <p className="text-xs sm:text-[13px] text-blue-900/85 leading-relaxed">
            Health Connect and HealthKit read steps and heart rate directly from the phone or the watch on the wrist.
            Fitbit, Garmin and Oura sync server-to-server, so no app on this device is involved at all.
          </p>
        </div>

        {devicesError ? <ErrorNote message={devicesError} /> : null}
        {syncNote ? (
          <div className="inline-flex items-start gap-2 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
            <Check className="w-3.5 h-3.5 mt-px shrink-0" />
            <span className="leading-relaxed">{syncNote}</span>
          </div>
        ) : null}

        {devicesLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Loading devices…</span>
          </div>
        ) : null}

        {devices.length ? (
          <div className="space-y-2.5">
            {devices.map((device) => {
              const providerMeta = DEVICE_PROVIDERS.find((item) => item.value === device.provider);
              return (
                <div
                  key={device.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3"
                >
                  <div className="space-y-2 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs sm:text-[13px] font-bold text-slate-900">{device.displayName}</span>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          STATUS_BADGE[device.status]
                        }`}
                      >
                        {device.status}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                        {providerMeta ? providerMeta.label : device.provider}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {providerMeta ? providerMeta.note : 'Connected source of readings.'}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {device.scopes.length ? (
                        device.scopes.map((scope) => (
                          <span
                            key={scope}
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600"
                          >
                            {scope.replace(/_/g, ' ')}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-slate-400">No scopes recorded yet</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400">Last sync: {formatDateTime(device.lastSyncAt)}</p>
                    {device.lastError ? (
                      <p className="text-[10px] text-rose-600 leading-relaxed">Last error: {device.lastError}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleSimulateSync(device)}
                      disabled={busyId === device.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busyId === device.id ? 'animate-spin' : ''}`} />
                      Simulate a sync
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteDevice(device)}
                      disabled={busyId === device.id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Disconnect
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : devicesLoading ? null : (
          <p className="text-xs sm:text-[13px] text-slate-500">No devices connected for this family member yet.</p>
        )}

        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
          <MicroLabel>How the sync works</MicroLabel>
          <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">
            A real device app is what would call the sync endpoint, posting heart rate and step samples as they are
            recorded. The button above posts the same payload from the web app so the data flow can be seen without
            any wearable hardware.
          </p>
        </div>

        {/* Latest readings on record */}
        {vitals.length ? (
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900">Latest readings on record</h3>
            <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
              {vitals.slice(0, 6).map((vital) => (
                <div key={vital.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    {vital.type === 'heart_rate' ? (
                      <Heart className="w-3.5 h-3.5 text-rose-500" />
                    ) : vital.type === 'steps' ? (
                      <Footprints className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Activity className="w-3.5 h-3.5 text-slate-400" />
                    )}
                    <span className="font-semibold text-slate-700 capitalize">{vital.type.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-500">
                    <span className="font-bold text-slate-900 tabular-nums">
                      {vital.value} {vital.unit}
                    </span>
                    <span className="text-[10px] text-slate-400">{formatDateTime(vital.measuredAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <form onSubmit={handleAddDevice} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Plus className="w-3.5 h-3.5 text-slate-400" />
            <h3 className="text-sm font-bold text-slate-900">Connect a device</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Provider</label>
              <select
                value={deviceProvider}
                onChange={(e) => setDeviceProvider(e.target.value as DeviceProvider)}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
              >
                {DEVICE_PROVIDERS.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Display name</label>
              <input
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder="Father's phone"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
              />
            </div>
          </div>

          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-1">Scopes</span>
            <div className="flex flex-wrap gap-2">
              {DEVICE_SCOPES.map((scope) => {
                const active = deviceScopes.includes(scope.value);
                return (
                  <button
                    key={scope.value}
                    type="button"
                    onClick={() => toggleScope(scope.value)}
                    className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl border ${
                      active
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {scope.label}
                    {active ? <Check className="w-3 h-3" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            disabled={savingDevice}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {savingDevice ? 'Connecting…' : 'Connect device'}
          </button>
        </form>
      </SectionCard>
    </div>
  );
};
