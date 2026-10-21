import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  History,
  Info,
  Pill,
  RefreshCw,
  Search,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { api } from '../api';
import {
  AllergyRecord,
  FamilyMember,
  Medication,
  SafetyCheck,
  SafetyFinding,
  SafetyResult,
} from '../types';

interface SafetyLedgerViewProps {
  familyMembers: FamilyMember[];
  activeMember: FamilyMember | null;
  onSelectMember: (member: FamilyMember) => void;
}

type SafetySeverity = SafetyCheck['highestSeverity'];

interface CheckRun {
  id: string;
  medications: Array<{ name: string; dose?: string }>;
  result: SafetyResult;
  at: string;
}

const SEVERITY_RANK: Record<SafetySeverity, number> = {
  none: 0,
  low: 1,
  moderate: 2,
  high: 3,
};

const SEVERITY_BADGE: Record<SafetySeverity, string> = {
  none: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80',
  low: 'bg-slate-100 text-slate-700 border border-slate-200',
  moderate: 'bg-amber-50 text-amber-800 border border-amber-200/80',
  high: 'bg-rose-50 text-rose-700 border border-rose-200/80',
};

const SEVERITY_BANNER: Record<SafetySeverity, string> = {
  none: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  low: 'bg-slate-50 border-slate-200 text-slate-800',
  moderate: 'bg-amber-50 border-amber-200 text-amber-900',
  high: 'bg-rose-50 border-rose-200 text-rose-900',
};

const SEVERITY_WORD: Record<SafetySeverity, string> = {
  none: 'No known interaction',
  low: 'Low severity',
  moderate: 'Moderate severity',
  high: 'High severity',
};

const KIND_LABELS: Record<SafetyFinding['kind'], string> = {
  drug_drug: 'Drug-drug',
  drug_allergy: 'Allergy',
  drug_condition: 'Condition',
  duplicate_therapy: 'Duplicate therapy',
};

const TRIGGER_LABELS: Record<SafetyCheck['trigger'], string> = {
  prescription_upload: 'Prescription upload',
  medication_add: 'Medication added',
  manual: 'Manual check',
};

const ALLERGY_BADGE: Record<AllergyRecord['severity'], string> = {
  mild: 'bg-slate-100 text-slate-700 border border-slate-200',
  moderate: 'bg-amber-50 text-amber-800 border border-amber-200/80',
  severe: 'bg-rose-50 text-rose-700 border border-rose-200/80',
  unknown: 'bg-slate-100 text-slate-500 border border-slate-200',
};

function formatDateTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date);
}

function parseMedicationInput(
  raw: string,
  dose: string
): Array<{ name: string; dose?: string }> {
  const names = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const cleanDose = dose.trim();
  return names.map((name) => (cleanDose ? { name, dose: cleanDose } : { name }));
}

function severityForMedication(findings: SafetyFinding[], name: string): SafetySeverity {
  let highest: SafetySeverity = 'none';
  for (const finding of findings) {
    if (finding.medication !== name && finding.interactsWith !== name) continue;
    if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[highest]) {
      highest = finding.severity;
    }
  }
  return highest;
}

function countFindingsForMedication(findings: SafetyFinding[], name: string): number {
  return findings.filter(
    (finding) => finding.medication === name || finding.interactsWith === name
  ).length;
}

function SeverityGlyph({ severity }: { severity: SafetySeverity }) {
  if (severity === 'high') return <TriangleAlert className="w-4 h-4 shrink-0" />;
  if (severity === 'moderate') return <ShieldAlert className="w-4 h-4 shrink-0" />;
  if (severity === 'low') return <Info className="w-4 h-4 shrink-0" />;
  return <CheckCircle2 className="w-4 h-4 shrink-0" />;
}

export const SafetyLedgerView: React.FC<SafetyLedgerViewProps> = ({
  familyMembers,
  activeMember,
  onSelectMember,
}) => {
  const currentMember = activeMember || familyMembers[0] || null;
  const memberId = currentMember ? currentMember.id : null;

  const [checks, setChecks] = useState<SafetyCheck[]>([]);
  const [medicationList, setMedicationList] = useState<Medication[]>([]);
  const [allergyList, setAllergyList] = useState<AllergyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [medicineInput, setMedicineInput] = useState('');
  const [doseInput, setDoseInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [runs, setRuns] = useState<CheckRun[]>([]);
  const [expandedChecks, setExpandedChecks] = useState<Set<string>>(() => new Set());

  const loadLedger = useCallback(async () => {
    if (!memberId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [checkList, meds, allergies] = await Promise.all([
        api.getSafetyChecks(memberId),
        api.getMedications(memberId),
        api.getAllergies(memberId),
      ]);
      setChecks(checkList);
      setMedicationList(meds);
      setAllergyList(allergies);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'The safety ledger could not be loaded right now.'
      );
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    setRuns([]);
    setCheckError(null);
    setExpandedChecks(new Set());
    if (!memberId) {
      setChecks([]);
      setMedicationList([]);
      setAllergyList([]);
      setLoading(false);
      return;
    }
    void loadLedger();
  }, [memberId, loadLedger]);

  const handleRunCheck = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentMember) return;

    const medicines = parseMedicationInput(medicineInput, doseInput);
    if (medicines.length === 0) {
      setCheckError('Enter at least one medicine name to run a safety check.');
      return;
    }

    setChecking(true);
    setCheckError(null);
    try {
      const result = await api.runSafetyCheck(currentMember.id, medicines);
      setRuns((previous) => [
        {
          id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          medications: medicines,
          result,
          at: new Date().toISOString(),
        },
        ...previous,
      ]);
      setMedicineInput('');
      setDoseInput('');
      // The check is written to the ledger, so pull the fresh history down.
      await loadLedger();
    } catch (err) {
      setCheckError(
        err instanceof Error ? err.message : 'The safety check could not be completed.'
      );
    } finally {
      setChecking(false);
    }
  };

  const toggleCheck = (id: string) => {
    setExpandedChecks((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!currentMember) {
    return (
      <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-8 text-center animate-in fade-in duration-200">
        <ShieldAlert className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm font-bold text-slate-800">No family member selected</p>
        <p className="text-xs sm:text-[13px] text-slate-600 mt-1">
          Add a family member to start a permanent safety ledger for them.
        </p>
      </div>
    );
  }

  const activeMedications = medicationList.filter((med) => med.active);
  const ledgerMedications = [...medicationList].sort((a, b) =>
    String(b.startDate || '').localeCompare(String(a.startDate || ''))
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-200 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md mb-1">
            <ShieldAlert className="w-3.5 h-3.5 text-emerald-600" />
            <span>Permanent Safety Record</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Safety Ledger
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Every interaction check, allergy and medication recorded for {currentMember.name} —
            kept permanently rather than replaced by the latest value.
          </p>
        </div>

        {/* Family member context selector */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
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

      {/* Summary chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Recorded checks
          </div>
          <div className="text-xl font-extrabold text-slate-900 tabular-nums">{checks.length}</div>
        </div>
        <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Allergies on file
          </div>
          <div className="text-xl font-extrabold text-slate-900 tabular-nums">
            {allergyList.length}
          </div>
        </div>
        <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Medications (all time)
          </div>
          <div className="text-xl font-extrabold text-slate-900 tabular-nums">
            {medicationList.length}
          </div>
        </div>
        <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Currently active
          </div>
          <div className="text-xl font-extrabold text-emerald-700 tabular-nums">
            {activeMedications.length}
          </div>
        </div>
      </div>

      {loadError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-xs sm:text-[13px] text-rose-800">
            <strong className="font-bold">Could not load the ledger:</strong> {loadError}
          </p>
          <button
            type="button"
            onClick={() => void loadLedger()}
            className="mt-2 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-[11px] font-bold flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Try again</span>
          </button>
        </div>
      )}

      {/* -------------------------------------------------------------
          Section A — Interaction checker
      ------------------------------------------------------------- */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900">Interaction checker</h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Checked against {currentMember.name}&apos;s record
          </span>
        </div>

        <form
          onSubmit={handleRunCheck}
          className="grid grid-cols-1 sm:grid-cols-[1fr_170px_auto] gap-2.5 items-end"
        >
          <div>
            <label
              htmlFor="safety-medicine-input"
              className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1"
            >
              Medicine name(s)
            </label>
            <input
              id="safety-medicine-input"
              type="text"
              value={medicineInput}
              onChange={(e) => setMedicineInput(e.target.value)}
              placeholder="Aspirin, Ibuprofen"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
            />
          </div>
          <div>
            <label
              htmlFor="safety-dose-input"
              className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1"
            >
              Dose (optional)
            </label>
            <input
              id="safety-dose-input"
              type="text"
              value={doseInput}
              onChange={(e) => setDoseInput(e.target.value)}
              placeholder="500 mg"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
            />
          </div>
          <button
            type="submit"
            disabled={checking}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {checking ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5" />
            )}
            <span>{checking ? 'Checking' : 'Check'}</span>
          </button>
        </form>

        <p className="text-[11px] text-slate-400">
          Separate several medicines with commas — each one is checked against the other
          medicines, the recorded allergies and the recorded conditions. The optional dose is
          recorded with every medicine listed. Every check is written to the ledger below
          permanently.
        </p>

        {checkError && (
          <p className="text-xs sm:text-[13px] text-rose-600 font-semibold">{checkError}</p>
        )}

        {runs.length === 0 ? (
          <p className="text-xs sm:text-[13px] text-slate-500">
            No check has been run in this session yet.
          </p>
        ) : (
          <div className="space-y-3">
            {runs.map((run) => (
              <div
                key={run.id}
                className="rounded-2xl border border-slate-200 overflow-hidden bg-white"
              >
                {/* Severity banner */}
                <div
                  className={`px-4 py-3 border-b flex items-start gap-2.5 ${
                    SEVERITY_BANNER[run.result.highestSeverity]
                  }`}
                >
                  <SeverityGlyph severity={run.result.highestSeverity} />
                  <div className="min-w-0">
                    <div className="text-xs font-bold">
                      {SEVERITY_WORD[run.result.highestSeverity]}
                    </div>
                    <p className="text-xs sm:text-[13px] leading-relaxed mt-0.5">
                      {run.result.message}
                    </p>
                  </div>
                </div>

                {/* Checked medicines */}
                <div className="px-4 pt-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">
                    Checked {run.medications.length} medicine
                    {run.medications.length === 1 ? '' : 's'}
                  </div>
                  <div className="space-y-1.5">
                    {run.medications.map((medicine) => {
                      const severity = severityForMedication(run.result.findings, medicine.name);
                      const count = countFindingsForMedication(run.result.findings, medicine.name);
                      return (
                        <div
                          key={`${run.id}-${medicine.name}`}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80"
                        >
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-slate-800">
                              {medicine.name}
                            </span>
                            {medicine.dose ? (
                              <span className="text-[11px] text-slate-500"> · {medicine.dose}</span>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400">
                              {count === 0
                                ? 'No finding for this medicine'
                                : `${count} finding${count === 1 ? '' : 's'}`}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${SEVERITY_BADGE[severity]}`}
                            >
                              {severity === 'none' ? 'Clear' : SEVERITY_WORD[severity]}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Findings */}
                {run.result.findings.length > 0 && (
                  <div className="px-4 py-3 space-y-2">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      Findings ({run.result.findings.length})
                    </div>
                    {run.result.findings.map((finding, index) => (
                      <div
                        key={`${run.id}-finding-${index}`}
                        className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-900">
                              {KIND_LABELS[finding.kind]}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${SEVERITY_BADGE[finding.severity]}`}
                            >
                              {SEVERITY_WORD[finding.severity]}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400">Source: {finding.source}</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          <span className="font-bold text-slate-700">{finding.medication}</span>
                          <span> interacts with </span>
                          <span className="font-bold text-slate-700">{finding.interactsWith}</span>
                        </div>
                        <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">
                          {finding.description}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Notes */}
                {run.result.notes && run.result.notes.length > 0 && (
                  <div className="px-4 pb-4 space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      Notes
                    </div>
                    {run.result.notes.map((note, index) => (
                      <p key={`${run.id}-note-${index}`} className="text-[11px] text-slate-400">
                        · {note}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* -------------------------------------------------------------
          Section B — Safety ledger
      ------------------------------------------------------------- */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900">Safety ledger</h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {checks.length} recorded check{checks.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading && (
          <p className="text-xs sm:text-[13px] text-slate-500 flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
            <span>Loading the safety history…</span>
          </p>
        )}

        {!loading && checks.length === 0 && (
          <p className="text-xs sm:text-[13px] text-slate-500">
            No safety check has been recorded for {currentMember.name} yet. Running a check
            above will add the first entry.
          </p>
        )}

        {checks.length > 0 && (
          <ol className="relative ml-2 pl-5 border-l border-slate-200 space-y-3">
            {checks.map((check) => {
              const isExpanded = expandedChecks.has(check.id);
              const medicationNames = check.medications.map((med) => med.name).join(', ');
              return (
                <li key={check.id} className="relative">
                  <span className="absolute -left-[26px] top-3 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-white" />
                  <div className="rounded-2xl border border-slate-200 bg-white p-3.5 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900">{check.sourceLabel}</div>
                        <div className="text-[11px] text-slate-500">
                          {TRIGGER_LABELS[check.trigger]} · {formatDateTime(check.createdAt)}
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${SEVERITY_BADGE[check.highestSeverity]}`}
                      >
                        {check.highestSeverity === 'none'
                          ? 'No known interaction'
                          : SEVERITY_WORD[check.highestSeverity]}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500">
                      <span className="font-bold uppercase tracking-wide text-slate-400 mr-1.5">
                        Medicines checked
                      </span>
                      {medicationNames || 'None recorded'}
                    </div>

                    {check.findings.length === 0 ? (
                      <p className="text-xs sm:text-[13px] text-emerald-700 font-semibold">
                        No known interaction found
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => toggleCheck(check.id)}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-emerald-700 transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {isExpanded ? 'Hide' : 'Show'} {check.findings.length} finding
                            {check.findings.length === 1 ? '' : 's'}
                          </span>
                        </button>

                        {isExpanded && (
                          <div className="space-y-2">
                            {check.findings.map((finding, index) => (
                              <div
                                key={`${check.id}-finding-${index}`}
                                className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 space-y-1.5"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-slate-900">
                                      {KIND_LABELS[finding.kind]}
                                    </span>
                                    <span
                                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${SEVERITY_BADGE[finding.severity]}`}
                                    >
                                      {SEVERITY_WORD[finding.severity]}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-slate-400">
                                    Source: {finding.source}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  <span className="font-bold text-slate-700">{finding.medication}</span>
                                  <span> interacts with </span>
                                  <span className="font-bold text-slate-700">
                                    {finding.interactsWith}
                                  </span>
                                </div>
                                <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">
                                  {finding.description}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {check.notes && check.notes.length > 0 && (
                      <div className="space-y-1">
                        {check.notes.map((note, index) => (
                          <p key={`${check.id}-note-${index}`} className="text-[11px] text-slate-400">
                            · {note}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* -------------------------------------------------------------
          Section C — Allergy history
      ------------------------------------------------------------- */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <TriangleAlert className="w-4 h-4 text-rose-500" />
            <h2 className="text-sm font-bold text-slate-900">Allergy history</h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {allergyList.length} record{allergyList.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <p className="text-xs sm:text-[13px] text-slate-500">Loading allergies…</p>
        ) : allergyList.length === 0 ? (
          <p className="text-xs sm:text-[13px] text-slate-500">
            No allergy has been recorded for {currentMember.name}.
          </p>
        ) : (
          <div className="space-y-2">
            {allergyList.map((allergy) => (
              <div
                key={allergy.id}
                className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900">{allergy.substance}</div>
                  <div className="text-[11px] text-slate-500">
                    {allergy.reaction || 'Reaction not recorded'}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${ALLERGY_BADGE[allergy.severity]}`}
                  >
                    {allergy.severity}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Verified {formatDate(allergy.verifiedAt)}
                  </span>
                  <span className="text-[10px] text-slate-400">Source: {allergy.source}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* -------------------------------------------------------------
          Section D — Medication history
      ------------------------------------------------------------- */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Pill className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900">Medication history</h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {medicationList.length} ever recorded
          </span>
        </div>

        <p className="text-[11px] text-slate-400">
          Every medication that has ever been on the record is kept here, including courses
          that are no longer active, so the ledger reads as a cumulative history.
        </p>

        {loading ? (
          <p className="text-xs sm:text-[13px] text-slate-500">Loading medications…</p>
        ) : ledgerMedications.length === 0 ? (
          <p className="text-xs sm:text-[13px] text-slate-500">
            No medication has been recorded for {currentMember.name}.
          </p>
        ) : (
          <div className="space-y-2">
            {ledgerMedications.map((medication) => (
              <div
                key={medication.id}
                className="rounded-2xl border border-slate-200 bg-white p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-900">{medication.name}</span>
                    {medication.dose ? (
                      <span className="text-[11px] text-slate-500">{medication.dose}</span>
                    ) : null}
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                        medication.active
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                          : 'bg-slate-100 text-slate-500 border border-slate-200'
                      }`}
                    >
                      {medication.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {medication.frequency}
                    {medication.route ? ` · ${medication.route}` : ''}
                    {medication.times && medication.times.length > 0
                      ? ` · ${medication.times.join(', ')}`
                      : ''}
                  </div>
                  {medication.instructions ? (
                    <p className="text-[11px] text-slate-400 mt-1">{medication.instructions}</p>
                  ) : null}
                </div>
                <div className="text-[10px] text-slate-400 sm:text-right">
                  <div>
                    Started {formatDate(medication.startDate)}
                    {medication.endDate ? ` · Ended ${formatDate(medication.endDate)}` : ''}
                  </div>
                  <div>Source: {medication.source}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
