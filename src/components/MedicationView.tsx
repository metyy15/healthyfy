import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CalendarDays,
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  Info,
  ListChecks,
  Pill,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react';
import { api } from '../api';
import {
  AdherenceEntry,
  AdherenceStatus,
  FamilyMember,
  Medication,
  SafetyFinding,
  SafetyResult,
} from '../types';

interface MedicationViewProps {
  familyMembers: FamilyMember[];
  activeMember: FamilyMember | null;
  onSelectMember: (member: FamilyMember) => void;
}

const ADHERENCE_WINDOW_DAYS = 14;

type DayState = 'all-taken' | 'partial' | 'none';

interface DayCell {
  key: string;
  dayLabel: string;
  fullLabel: string;
  state: DayState;
  total: number;
  taken: number;
}

interface AdherenceSummary {
  total: number;
  taken: number;
  skipped: number;
  late: number;
  pending: number;
  adherenceRate: number | null;
}

const sourceMeta: Record<Medication['source'], { label: string; tone: string }> = {
  typed: { label: 'Typed', tone: 'bg-slate-100 text-slate-600 border border-slate-200' },
  prescription_upload: {
    label: 'Prescription upload',
    tone: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80',
  },
  lab_report: { label: 'Lab report', tone: 'bg-sky-50 text-sky-700 border border-sky-200/80' },
  health_connect: { label: 'Health Connect', tone: 'bg-teal-50 text-teal-700 border border-teal-200/80' },
  healthkit: { label: 'HealthKit', tone: 'bg-teal-50 text-teal-700 border border-teal-200/80' },
  wearable_api: {
    label: 'Wearable API',
    tone: 'bg-indigo-50 text-indigo-700 border border-indigo-200/80',
  },
  imported: { label: 'Imported', tone: 'bg-violet-50 text-violet-700 border border-violet-200/80' },
};

const statusMeta: Record<AdherenceStatus, { label: string; tone: string }> = {
  taken: { label: 'Taken', tone: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80' },
  skipped: { label: 'Skipped', tone: 'bg-rose-50 text-rose-700 border border-rose-200/80' },
  late: { label: 'Late', tone: 'bg-amber-50 text-amber-800 border border-amber-200/80' },
  pending: { label: 'Pending', tone: 'bg-slate-100 text-slate-600 border border-slate-200/80' },
};

const severityMeta: Record<'none' | 'low' | 'moderate' | 'high', { label: string; tone: string }> = {
  none: { label: 'No severity', tone: 'bg-slate-100 text-slate-600 border border-slate-200' },
  low: { label: 'Low severity', tone: 'bg-slate-100 text-slate-600 border border-slate-200' },
  moderate: { label: 'Moderate severity', tone: 'bg-amber-100 text-amber-800 border border-amber-300' },
  high: { label: 'High severity', tone: 'bg-rose-100 text-rose-700 border border-rose-300' },
};

const dayStateTone: Record<DayState, string> = {
  'all-taken': 'bg-emerald-500',
  partial: 'bg-amber-400',
  none: 'bg-slate-200',
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatScheduled(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Shared clinical safety panel. Mirrors the visual language used across
 * the medication and prescription flows.
 */
const SafetyPanel: React.FC<{ safety: SafetyResult; title?: string }> = ({
  safety,
  title = 'Safety check',
}) => {
  const hasFindings = safety.findings.length > 0;
  const isHigh = safety.highestSeverity === 'high';

  return (
    <div
      className={`rounded-2xl border p-4 space-y-3 ${
        hasFindings
          ? isHigh
            ? 'bg-rose-50/70 border-rose-300'
            : 'bg-amber-50/70 border-amber-300'
          : 'bg-emerald-50/60 border-emerald-200'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {hasFindings ? (
            <ShieldAlert className={`w-4 h-4 ${isHigh ? 'text-rose-600' : 'text-amber-600'}`} />
          ) : (
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          )}
          <span className="text-sm font-bold text-slate-900">{title}</span>
        </div>
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
            hasFindings
              ? isHigh
                ? 'bg-rose-100 text-rose-700'
                : 'bg-amber-100 text-amber-800'
              : 'bg-emerald-100 text-emerald-700'
          }`}
        >
          {hasFindings ? `Highest: ${severityMeta[safety.highestSeverity].label}` : 'All clear'}
        </span>
      </div>

      {hasFindings ? (
        <>
          <p className="text-xs sm:text-[13px] font-bold text-slate-800">{safety.message}</p>
          <div className="space-y-2">
            {safety.findings.map((finding: SafetyFinding, index: number) => (
              <div
                key={`${finding.medication}-${finding.interactsWith}-${index}`}
                className="rounded-xl bg-white border border-slate-200 p-3 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900">{finding.medication}</span>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                      severityMeta[finding.severity].tone
                    }`}
                  >
                    {severityMeta[finding.severity].label}
                  </span>
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Interacts with: {finding.interactsWith || 'unknown'}
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{finding.description}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 text-xs sm:text-[13px] font-bold text-emerald-700">
          <CircleCheck className="w-4 h-4 text-emerald-600" />
          <span>No known interaction found</span>
        </div>
      )}

      {safety.message && hasFindings === false && (
        <p className="text-xs text-emerald-700/90">{safety.message}</p>
      )}

      {safety.notes && safety.notes.length > 0 && (
        <div className="rounded-xl bg-white/70 border border-slate-200 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <Info className="w-3 h-3" />
            <span>Notes</span>
          </div>
          {safety.notes.map((note, index) => (
            <p key={index} className="text-[11px] text-slate-500 leading-relaxed">
              {note}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};

export const MedicationView: React.FC<MedicationViewProps> = ({
  familyMembers,
  activeMember,
  onSelectMember,
}) => {
  const currentMember = activeMember || familyMembers[0] || null;
  const memberId = currentMember?.id ?? null;

  const [medications, setMedications] = useState<Medication[]>([]);
  const [entries, setEntries] = useState<AdherenceEntry[]>([]);
  const [summary, setSummary] = useState<AdherenceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyMedicationId, setBusyMedicationId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [recordingKey, setRecordingKey] = useState<string | null>(null);
  const [safety, setSafety] = useState<SafetyResult | null>(null);

  const [form, setForm] = useState({
    name: '',
    dose: '',
    frequency: '',
    times: '',
    route: '',
    instructions: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (targetMemberId: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const [meds, adherence] = await Promise.all([
        api.getMedications(targetMemberId),
        api.getAdherence(targetMemberId, ADHERENCE_WINDOW_DAYS),
      ]);
      setMedications(meds);
      setEntries(adherence.entries);
      setSummary(adherence.summary);
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load the medication ledger.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSafety(null);
    setActionError(null);
    setConfirmDeleteId(null);
    if (!memberId) {
      setMedications([]);
      setEntries([]);
      setSummary(null);
      return;
    }
    void load(memberId);
  }, [memberId, load]);

  const reload = useCallback(async () => {
    if (!memberId) return;
    await load(memberId);
  }, [memberId, load]);

  const dayCells = useMemo<DayCell[]>(() => {
    const buckets = new Map<string, AdherenceEntry[]>();
    for (const entry of entries) {
      const key = localDayKey(new Date(entry.scheduledAt));
      const bucket = buckets.get(key);
      if (bucket) bucket.push(entry);
      else buckets.set(key, [entry]);
    }

    const now = new Date();
    const cells: DayCell[] = [];
    for (let offset = ADHERENCE_WINDOW_DAYS - 1; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      const key = localDayKey(date);
      const dayEntries = buckets.get(key) || [];
      const taken = dayEntries.filter((entry) => entry.status === 'taken').length;
      const state: DayState =
        dayEntries.length === 0
          ? 'none'
          : dayEntries.every((entry) => entry.status === 'taken')
            ? 'all-taken'
            : 'partial';

      cells.push({
        key,
        dayLabel: date.toLocaleDateString('en-GB', { day: 'numeric' }),
        fullLabel: date.toLocaleDateString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }),
        state,
        total: dayEntries.length,
        taken,
      });
    }
    return cells;
  }, [entries]);

  const todayCounts = useMemo(() => {
    const todayKey = localDayKey(new Date());
    const todayEntries = entries.filter(
      (entry) => localDayKey(new Date(entry.scheduledAt)) === todayKey,
    );
    return {
      taken: todayEntries.filter((entry) => entry.status === 'taken').length,
      skipped: todayEntries.filter((entry) => entry.status === 'skipped').length,
      late: todayEntries.filter((entry) => entry.status === 'late').length,
      pending: todayEntries.filter((entry) => entry.status === 'pending').length,
    };
  }, [entries]);

  const handleToggleActive = async (medication: Medication) => {
    setBusyMedicationId(medication.id);
    setActionError(null);
    try {
      await api.updateMedication(medication.id, { active: !medication.active });
      await reload();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not update the medication.'));
    } finally {
      setBusyMedicationId(null);
    }
  };

  const handleDelete = async (medication: Medication) => {
    setBusyMedicationId(medication.id);
    setActionError(null);
    try {
      await api.deleteMedication(medication.id);
      setConfirmDeleteId(null);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not delete the medication.'));
    } finally {
      setBusyMedicationId(null);
    }
  };

  const handleRecord = async (entry: AdherenceEntry, status: 'taken' | 'skipped') => {
    const key = `${entry.medicationId}-${entry.scheduledAt}`;
    setRecordingKey(key);
    setActionError(null);
    try {
      await api.recordAdherence({
        medicationId: entry.medicationId,
        scheduledAt: entry.scheduledAt,
        status,
      });
      await reload();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not record the dose.'));
    } finally {
      setRecordingKey(null);
    }
  };

  const handleAddMedication = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentMember) return;

    const times = form.times
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (!form.name.trim()) {
      setFormError('Medication name is required.');
      return;
    }
    const invalidTime = times.find((value) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(value));
    if (invalidTime) {
      setFormError(`"${invalidTime}" is not a valid dose time. Use 24-hour HH:MM, for example 08:30.`);
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setSafety(null);

    try {
      const response = await api.addMedication({
        memberId: currentMember.id,
        name: form.name.trim(),
        dose: form.dose.trim(),
        frequency: form.frequency.trim() || 'As directed',
        times,
        ...(form.route.trim() ? { route: form.route.trim() } : {}),
        ...(form.instructions.trim() ? { instructions: form.instructions.trim() } : {}),
      });

      setSafety(response.safety);
      setForm({ name: '', dose: '', frequency: '', times: '', route: '', instructions: '' });
      await reload();
    } catch (err) {
      setFormError(errorMessage(err, 'Could not save the medication.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!currentMember) {
    return (
      <div className="space-y-4 animate-in fade-in duration-200 pb-16">
        <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-8 text-center space-y-2">
          <Pill className="w-7 h-7 mx-auto text-slate-300" />
          <p className="text-sm font-bold text-slate-700">No family member selected</p>
          <p className="text-xs text-slate-500">
            Add a family member to start a medication ledger and track adherence.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Medication Ledger &amp; Adherence
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            A structured medication schedule for {currentMember.name}, with dose-level adherence tracking and
            automatic interaction screening.
          </p>
        </div>

        {/* Member Switcher */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
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

      {loadError && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50/70 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2 text-xs sm:text-[13px] text-rose-800">
            <CircleAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => void reload()}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {actionError && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50/70 p-3.5 flex items-start gap-2 text-xs text-rose-800">
          <TriangleAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Section A — Medication schedule */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Pill className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900">Medication schedule</h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {medications.length} {medications.length === 1 ? 'medication' : 'medications'}
          </span>
        </div>

        {loading && medications.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
            <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
            <span>Loading the medication ledger...</span>
          </div>
        ) : medications.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-5 py-8 text-center space-y-2">
            <Pill className="w-7 h-7 mx-auto text-slate-300" />
            <p className="text-sm font-bold text-slate-700">No medications recorded yet</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              Add {currentMember.name}&apos;s first medication below, or upload a prescription to fill the
              ledger automatically.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {medications.map((medication) => {
              const source = sourceMeta[medication.source] ?? sourceMeta.typed;
              const isBusy = busyMedicationId === medication.id;
              return (
                <div
                  key={medication.id}
                  className="rounded-2xl border border-slate-200/90 bg-slate-50/40 p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900">{medication.name}</span>
                        {medication.genericName && (
                          <span className="text-xs text-slate-500">{medication.genericName}</span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${source.tone}`}
                        >
                          {source.label}
                        </span>
                        {!medication.active && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-500">
                            Paused
                          </span>
                        )}
                      </div>
                      <p className="text-xs sm:text-[13px] text-slate-600 mt-1">
                        {[medication.dose, medication.frequency, medication.route]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {medication.prescribedBy && (
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          Prescribed by {medication.prescribedBy}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(medication)}
                        disabled={isBusy}
                        aria-label={medication.active ? 'Pause medication' : 'Resume medication'}
                        title={medication.active ? 'Pause medication' : 'Resume medication'}
                        className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                          medication.active ? 'bg-emerald-500' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                            medication.active ? 'left-[18px]' : 'left-[2px]'
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(medication.id)}
                        aria-label="Delete medication"
                        title="Delete medication"
                        className="px-2 py-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {medication.times.length > 0 ? (
                      medication.times.map((time) => (
                        <span
                          key={time}
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600"
                        >
                          <Clock3 className="w-3 h-3 text-slate-400" />
                          {time}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-slate-400">No fixed dose times</span>
                    )}
                  </div>

                  {medication.instructions && (
                    <p className="text-xs text-slate-600 leading-relaxed">{medication.instructions}</p>
                  )}

                  {confirmDeleteId === medication.id && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2">
                      <span className="text-[11px] font-semibold text-rose-700">
                        Remove {medication.name} from the ledger?
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleDelete(medication)}
                          disabled={isBusy}
                          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-bold cursor-pointer disabled:opacity-50"
                        >
                          Confirm delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2.5 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] font-bold cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section B — Today and the last 14 days */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900">Today and the last 14 days</h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {summary ? `${summary.total} doses scheduled` : 'No doses yet'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Taken</span>
              <CircleCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-extrabold text-slate-900 tabular-nums">{todayCounts.taken}</div>
            <div className="text-[10px] text-slate-400">14 days: {summary?.taken ?? 0}</div>
          </div>

          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Missed</span>
              <X className="w-4 h-4 text-rose-500" />
            </div>
            <div className="text-2xl font-extrabold text-slate-900 tabular-nums">{todayCounts.skipped}</div>
            <div className="text-[10px] text-slate-400">14 days: {summary?.skipped ?? 0}</div>
          </div>

          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Late</span>
              <Clock3 className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-extrabold text-slate-900 tabular-nums">{todayCounts.late}</div>
            <div className="text-[10px] text-slate-400">14 days: {summary?.late ?? 0}</div>
          </div>

          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Still due</span>
              <ListChecks className="w-4 h-4 text-slate-400" />
            </div>
            <div className="text-2xl font-extrabold text-slate-900 tabular-nums">{todayCounts.pending}</div>
            <div className="text-[10px] text-slate-400">14 days: {summary?.pending ?? 0}</div>
          </div>

          <div className="rounded-2xl border border-slate-200/90 bg-emerald-50/60 p-4 space-y-1 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Adherence rate
              </span>
              <CalendarDays className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-extrabold text-emerald-700 tabular-nums">
              {summary?.adherenceRate !== null && summary?.adherenceRate !== undefined
                ? `${summary.adherenceRate}%`
                : '—'}
            </div>
            <div className="text-[10px] text-slate-400">Last 14 days</div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            14-day adherence strip
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dayCells.map((cell) => (
              <div key={cell.key} className="flex flex-col items-center gap-1">
                <div
                  title={`${cell.fullLabel} · ${cell.taken}/${cell.total} taken`}
                  className={`w-6 h-6 rounded-md ${dayStateTone[cell.state]}`}
                />
                <span className="text-[9px] text-slate-400 tabular-nums">{cell.dayLabel}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-md bg-emerald-500" />
              All doses taken
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-md bg-amber-400" />
              Late, skipped or still due
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-md bg-slate-200" />
              No doses scheduled
            </span>
          </div>
        </div>
      </section>

      {/* Section C — Adherence log */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900">Adherence log</h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {entries.length} entries
          </span>
        </div>

        {entries.length === 0 ? (
          <div className="px-5 py-10 text-center space-y-2">
            <ListChecks className="w-7 h-7 mx-auto text-slate-300" />
            <p className="text-sm font-bold text-slate-700">No doses logged yet</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              Once a medication schedule is running, every scheduled dose appears here so you can mark it
              taken or skipped.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-5">Medication</th>
                  <th className="py-3 px-4">Scheduled time</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-5">Mark dose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry) => {
                  const status = statusMeta[entry.status] ?? statusMeta.pending;
                  const key = `${entry.medicationId}-${entry.scheduledAt}`;
                  const isRecording = recordingKey === key;
                  return (
                    <tr key={entry.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-5 font-bold text-slate-800">{entry.medicationName}</td>
                      <td className="py-3 px-4 text-slate-500 tabular-nums">
                        {formatScheduled(entry.scheduledAt)}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${status.tone}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleRecord(entry, 'taken')}
                            disabled={isRecording || entry.status === 'taken'}
                            className="px-2.5 py-1 bg-white border border-slate-200 text-slate-700 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 rounded-lg text-[10px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" />
                            Taken
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRecord(entry, 'skipped')}
                            disabled={isRecording || entry.status === 'skipped'}
                            className="px-2.5 py-1 bg-white border border-slate-200 text-slate-700 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 rounded-lg text-[10px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                          >
                            <X className="w-3 h-3" />
                            Skipped
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section D — Add a medication */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900">Add a medication</h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Safety screened on save
          </span>
        </div>

        <form onSubmit={handleAddMedication} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="med-name"
                className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1"
              >
                Medication name
              </label>
              <input
                id="med-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Metformin 500 mg"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
              />
            </div>

            <div>
              <label
                htmlFor="med-dose"
                className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1"
              >
                Dose
              </label>
              <input
                id="med-dose"
                type="text"
                value={form.dose}
                onChange={(e) => setForm({ ...form, dose: e.target.value })}
                placeholder="e.g. 500 mg"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
              />
            </div>

            <div>
              <label
                htmlFor="med-frequency"
                className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1"
              >
                Frequency
              </label>
              <input
                id="med-frequency"
                type="text"
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value })}
                placeholder="e.g. Twice daily after meals"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
              />
            </div>

            <div>
              <label
                htmlFor="med-times"
                className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1"
              >
                Dose times
              </label>
              <input
                id="med-times"
                type="text"
                value={form.times}
                onChange={(e) => setForm({ ...form, times: e.target.value })}
                placeholder="08:30, 20:30"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
              />
            </div>

            <div>
              <label
                htmlFor="med-route"
                className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1"
              >
                Route
              </label>
              <input
                id="med-route"
                type="text"
                value={form.route}
                onChange={(e) => setForm({ ...form, route: e.target.value })}
                placeholder="e.g. Oral"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
              />
            </div>

            <div>
              <label
                htmlFor="med-instructions"
                className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1"
              >
                Instructions
              </label>
              <input
                id="med-instructions"
                type="text"
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                placeholder="e.g. Take with food"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
              />
            </div>
          </div>

          {formError && (
            <div className="rounded-2xl border border-rose-300 bg-rose-50/70 p-3.5 flex items-start gap-2 text-xs text-rose-800">
              <TriangleAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2 cursor-pointer"
          >
            {submitting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Saving and screening...</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>Add medication</span>
              </>
            )}
          </button>
        </form>

        {safety && (
          <div className="pt-1">
            <SafetyPanel safety={safety} title="Interaction screening" />
          </div>
        )}
      </section>
    </div>
  );
};
