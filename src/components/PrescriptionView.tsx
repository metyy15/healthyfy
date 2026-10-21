import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  ClipboardCheck,
  Clock3,
  FileText,
  Image as ImageIcon,
  Info,
  LoaderCircle,
  Pill,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Upload,
  Users,
} from 'lucide-react';
import { api } from '../api';
import {
  ExtractedAllergy,
  ExtractedMedication,
  FamilyMember,
  PrescriptionAnalysis,
  SafetyFinding,
  SafetyResult,
} from '../types';

interface PrescriptionViewProps {
  familyMembers: FamilyMember[];
  activeMember: FamilyMember | null;
  onSelectMember: (member: FamilyMember) => void;
  onCommitted?: () => void;
}

const CONFIDENCE_THRESHOLD = 0.7;

const qualityMeta: Record<
  PrescriptionAnalysis['extraction']['documentQuality'],
  { label: string; tone: string }
> = {
  clear: { label: 'Clear', tone: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80' },
  partial: { label: 'Partially readable', tone: 'bg-amber-50 text-amber-800 border border-amber-200/80' },
  illegible: { label: 'Illegible', tone: 'bg-rose-50 text-rose-700 border border-rose-200/80' },
};

const allergySeverityMeta: Record<
  ExtractedAllergy['severity'],
  { label: string; tone: string }
> = {
  mild: { label: 'Mild', tone: 'bg-slate-100 text-slate-600 border border-slate-200' },
  moderate: { label: 'Moderate', tone: 'bg-amber-50 text-amber-800 border border-amber-200/80' },
  severe: { label: 'Severe', tone: 'bg-rose-50 text-rose-700 border border-rose-200/80' },
  unknown: { label: 'Unknown', tone: 'bg-slate-100 text-slate-600 border border-slate-200' },
};

const severityMeta: Record<'none' | 'low' | 'moderate' | 'high', { label: string; tone: string }> = {
  none: { label: 'No severity', tone: 'bg-slate-100 text-slate-600 border border-slate-200' },
  low: { label: 'Low severity', tone: 'bg-slate-100 text-slate-600 border border-slate-200' },
  moderate: { label: 'Moderate severity', tone: 'bg-amber-100 text-amber-800 border border-amber-300' },
  high: { label: 'High severity', tone: 'bg-rose-100 text-rose-700 border border-rose-300' },
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function confidenceTone(confidence: number): { text: string; bar: string; label: string } {
  if (confidence >= 0.85) {
    return { text: 'text-emerald-700', bar: 'bg-emerald-500', label: 'High confidence' };
  }
  if (confidence >= CONFIDENCE_THRESHOLD) {
    return { text: 'text-sky-700', bar: 'bg-sky-500', label: 'Moderate confidence' };
  }
  return { text: 'text-amber-700', bar: 'bg-amber-500', label: 'Needs verification' };
}

/**
 * Shared clinical safety panel. Mirrors the visual language used in the
 * medication ledger so the same finding always looks the same.
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
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs sm:text-[13px] font-bold text-emerald-700">
            <CircleCheck className="w-4 h-4 text-emerald-600" />
            <span>No known interaction found</span>
          </div>
          {safety.message && <p className="text-xs text-emerald-700/90">{safety.message}</p>}
        </div>
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

export const PrescriptionView: React.FC<PrescriptionViewProps> = ({
  familyMembers,
  activeMember,
  onSelectMember,
  onCommitted,
}) => {
  const currentMember = activeMember || familyMembers[0] || null;
  const memberId = currentMember?.id ?? null;

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [prescriptionText, setPrescriptionText] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const [isReading, setIsReading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PrescriptionAnalysis | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setSaved(false);
    setSaveMessage(null);
    setError(null);
  }, [memberId]);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image of the prescription (PNG, JPG, WEBP or HEIC).');
      return;
    }
    setError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = event.target?.result as string;
      setImageBase64(data);
      setImageMimeType(file.type);
    };
    reader.onerror = () => {
      setError('That image could not be read. Try uploading it again.');
    };
    reader.readAsDataURL(file);
  }, []);

  const buildPayload = useCallback(() => {
    const payload: {
      memberId: string;
      imageBase64?: string;
      imageMimeType?: string;
      prescriptionText?: string;
    } = { memberId: currentMember?.id ?? '' };

    if (imageBase64) payload.imageBase64 = imageBase64;
    if (imageMimeType) payload.imageMimeType = imageMimeType;
    if (prescriptionText.trim()) payload.prescriptionText = prescriptionText.trim();
    return payload;
  }, [currentMember, imageBase64, imageMimeType, prescriptionText]);

  const handleRead = async () => {
    if (!currentMember) return;
    if (!imageBase64 && !prescriptionText.trim()) {
      setError('Upload a prescription image or paste the prescription text first.');
      return;
    }

    setIsReading(true);
    setError(null);
    setSaveMessage(null);
    setSaved(false);

    try {
      const analysis = await api.analyzePrescription(buildPayload());
      setResult(analysis);
    } catch (err) {
      setError(errorMessage(err, 'The prescription could not be read right now.'));
    } finally {
      setIsReading(false);
    }
  };

  const handleSave = async () => {
    if (!currentMember || isSaving || saved) return;

    setIsSaving(true);
    setError(null);

    try {
      const analysis = await api.analyzePrescription({ ...buildPayload(), commit: true });
      setResult(analysis);
      setSaved(true);

      const medicationCount = analysis.createdMedications.length;
      const allergyCount = analysis.createdAllergies;
      setSaveMessage(
        `${medicationCount} medication${medicationCount === 1 ? '' : 's'} and ${allergyCount} allergy record${
          allergyCount === 1 ? '' : 's'
        } recorded in the medication ledger.`,
      );

      if (onCommitted) onCommitted();

      setImageBase64(null);
      setImageMimeType(null);
      setFileName(null);
      setPrescriptionText('');
    } catch (err) {
      setError(errorMessage(err, 'The prescription could not be saved.'));
    } finally {
      setIsSaving(false);
    }
  };

  if (!currentMember) {
    return (
      <div className="space-y-4 animate-in fade-in duration-200 pb-16">
        <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-8 text-center space-y-2">
          <FileText className="w-7 h-7 mx-auto text-slate-300" />
          <p className="text-sm font-bold text-slate-700">No family member selected</p>
          <p className="text-xs text-slate-500">
            Add a family member before reading a prescription.
          </p>
        </div>
      </div>
    );
  }

  const extraction = result?.extraction;
  const quality = extraction ? qualityMeta[extraction.documentQuality] : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-200 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md mb-1">
            <ScanLine className="w-3.5 h-3.5 text-emerald-600" />
            <span>Prescription Reader &amp; Safety Screening</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Read a Prescription
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Photograph or paste a prescription for {currentMember.name}. Everything is checked for interactions
            before you decide to save it.
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

      {/* Upload + text input */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900">Upload a prescription</h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Images or plain text
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Drag & drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`rounded-2xl border-2 border-dashed px-5 py-8 text-center cursor-pointer transition-colors ${
              dragActive
                ? 'border-emerald-400 bg-emerald-50/70'
                : 'border-slate-300 bg-slate-50/60 hover:border-emerald-400 hover:bg-emerald-50/40'
            }`}
          >
            <ImageIcon className="w-7 h-7 mx-auto text-slate-300" />
            <p className="text-sm font-bold text-slate-700 mt-2">
              {fileName ? fileName : 'Drop a prescription image here'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {fileName ? 'Tap to choose a different image' : 'or click to browse your photos'}
            </p>
            {imageMimeType && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200/80 mt-2.5">
                {imageMimeType}
              </span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
              className="hidden"
            />
          </div>

          {/* Text alternative */}
          <div className="space-y-2">
            <label
              htmlFor="prescription-text"
              className="block text-[10px] font-bold uppercase tracking-wide text-slate-400"
            >
              Or paste the prescription text
            </label>
            <textarea
              id="prescription-text"
              rows={8}
              value={prescriptionText}
              onChange={(e) => setPrescriptionText(e.target.value)}
              placeholder={'Tab. Metformin 500 mg — 1 tab twice daily after meals (08:30, 20:30)\nTab. Atorvastatin 10 mg — 1 tab at night'}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs font-mono leading-relaxed focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden resize-none"
            />
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Use this when you already have the prescription typed out, or when the photo is too blurry to
              read.
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-300 bg-rose-50/70 p-3.5 flex items-start gap-2 text-xs text-rose-800">
            <TriangleAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            onClick={() => void handleRead()}
            disabled={isReading || isSaving}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            {isReading ? (
              <>
                <LoaderCircle className="w-4 h-4 animate-spin" />
                <span>Reading the prescription...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Read prescription</span>
              </>
            )}
          </button>

          <p className="text-[11px] text-slate-500 flex items-start gap-1.5 leading-relaxed">
            <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
            <span>
              Check without saving — reading a prescription only inspects the document. Nothing is written to
              the medication ledger until you press &ldquo;Save to medication ledger&rdquo;.
            </span>
          </p>
        </div>
      </section>

      {/* Results */}
      {result && extraction && (
        <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Header strip */}
          <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-emerald-600" />
                  <h2 className="text-sm font-bold text-slate-900">Prescription read</h2>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-[13px] text-slate-600">
                  {extraction.prescriber && (
                    <span>
                      Prescriber: <strong className="text-slate-800">{extraction.prescriber}</strong>
                    </span>
                  )}
                  {extraction.clinic && (
                    <span>
                      Clinic: <strong className="text-slate-800">{extraction.clinic}</strong>
                    </span>
                  )}
                  {extraction.date && (
                    <span>
                      Date: <strong className="text-slate-800">{extraction.date}</strong>
                    </span>
                  )}
                  {!extraction.prescriber && !extraction.clinic && !extraction.date && (
                    <span className="text-slate-400">
                      No prescriber, clinic or date could be read from the document.
                    </span>
                  )}
                </div>
              </div>

              {quality && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${quality.tone}`}
                >
                  Document quality: {quality.label}
                </span>
              )}
            </div>

            {result.degraded && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-3.5 flex items-start gap-2 text-xs sm:text-[13px] text-amber-900">
                <TriangleAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  <strong className="font-bold">AI service is not configured.</strong> This extraction came from
                  a basic text parser, so every field below must be checked by a person before it is trusted.
                </span>
              </div>
            )}

            {extraction.notes && (
              <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 block mb-1">
                  Document notes
                </span>
                {extraction.notes}
              </p>
            )}

            {extraction.conditionsMentioned.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Conditions mentioned
                </span>
                {extraction.conditionsMentioned.map((condition, index) => (
                  <span
                    key={`${condition}-${index}`}
                    className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200"
                  >
                    {condition}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Medications found */}
          <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-3">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Pill className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">Medications found</h3>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {extraction.medications.length} found
              </span>
            </div>

            {extraction.medications.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No medications could be read from this document.
              </p>
            ) : (
              <div className="space-y-3">
                {extraction.medications.map((medication: ExtractedMedication, index: number) => {
                  const percent = Math.max(0, Math.min(100, Math.round(medication.confidence * 100)));
                  const tone = confidenceTone(medication.confidence);
                  const needsVerification = medication.confidence < CONFIDENCE_THRESHOLD;
                  return (
                    <div
                      key={`${medication.name}-${index}`}
                      className="rounded-2xl border border-slate-200/90 bg-slate-50/50 p-4 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-slate-900">{medication.name}</div>
                          {medication.genericName && (
                            <div className="text-xs text-slate-500">Generic: {medication.genericName}</div>
                          )}
                          {medication.brandName && (
                            <div className="text-xs text-slate-400">Brand: {medication.brandName}</div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                            Confidence
                          </div>
                          <div className={`text-xs font-bold tabular-nums ${tone.text}`}>Confidence {percent}%</div>
                        </div>
                      </div>

                      <div className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${tone.bar}`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {medication.dose && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600">
                            {medication.dose}
                          </span>
                        )}
                        {medication.frequency && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600">
                            {medication.frequency}
                          </span>
                        )}
                        {medication.route && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600">
                            {medication.route}
                          </span>
                        )}
                        {medication.duration && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600">
                            {medication.duration}
                          </span>
                        )}
                        {medication.times.map((time) => (
                          <span
                            key={time}
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200/80"
                          >
                            <Clock3 className="w-3 h-3" />
                            {time}
                          </span>
                        ))}
                        {needsVerification && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-300">
                            <TriangleAlert className="w-3 h-3" />
                            Needs verification
                          </span>
                        )}
                      </div>

                      {medication.instructions && (
                        <p className="text-xs text-slate-600 leading-relaxed">{medication.instructions}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Allergies found */}
          <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-3">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <CircleAlert className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-900">Allergies found</h3>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {extraction.allergies.length} found
              </span>
            </div>

            {extraction.allergies.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No allergies or intolerances were written on this document.
              </p>
            ) : (
              <div className="space-y-2">
                {extraction.allergies.map((allergy: ExtractedAllergy, index: number) => {
                  const severity = allergySeverityMeta[allergy.severity] ?? allergySeverityMeta.unknown;
                  const percent = Math.max(0, Math.min(100, Math.round(allergy.confidence * 100)));
                  return (
                    <div
                      key={`${allergy.substance}-${index}`}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-2xl border border-slate-200/90 bg-slate-50/50 px-4 py-3"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-900">{allergy.substance}</span>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${severity.tone}`}
                        >
                          {severity.label}
                        </span>
                        {allergy.reaction && (
                          <span className="text-[11px] text-slate-500">Reaction: {allergy.reaction}</span>
                        )}
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 tabular-nums">
                        Confidence {percent}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Safety check */}
          <div className="space-y-2">
            <SafetyPanel safety={result.safety} title="Safety check" />
          </div>

          {/* Needs verification */}
          {extraction.needsVerification.length > 0 && (
            <div className="rounded-3xl border border-amber-300 bg-amber-50/70 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <TriangleAlert className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-900">Needs verification</h3>
              </div>
              <ul className="space-y-1.5">
                {extraction.needsVerification.map((item, index) => (
                  <li key={index} className="flex items-start gap-2 text-xs sm:text-[13px] text-amber-900">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Save panel */}
          <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-3">
            {saveMessage && (
              <div className="rounded-2xl border border-emerald-300 bg-emerald-50/70 p-3.5 flex items-start gap-2 text-xs sm:text-[13px] text-emerald-900">
                <CircleCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span className="font-bold">{saveMessage}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900">Save to medication ledger</h3>
                <p className="text-xs text-slate-500 max-w-xl leading-relaxed">
                  Nothing has been written yet. Saving re-reads the document and adds{' '}
                  {extraction.medications.length} medication
                  {extraction.medications.length === 1 ? '' : 's'} and {extraction.allergies.length} allergy
                  record{extraction.allergies.length === 1 ? '' : 's'} for {currentMember.name}.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isSaving || isReading || saved}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 cursor-pointer shrink-0"
                >
                  {isSaving ? (
                    <>
                      <LoaderCircle className="w-4 h-4 animate-spin" />
                      <span>Saving to the ledger...</span>
                    </>
                  ) : saved ? (
                    <>
                      <CircleCheck className="w-4 h-4" />
                      <span>Saved to medication ledger</span>
                    </>
                  ) : (
                    <>
                      <ClipboardCheck className="w-4 h-4" />
                      <span>Save to medication ledger</span>
                    </>
                  )}
                </button>

                {saved && (
                  <button
                    type="button"
                    onClick={() => {
                      setSaved(false);
                      setSaveMessage(null);
                      setResult(null);
                    }}
                    className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold cursor-pointer shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <p className="text-[11px] text-slate-400 flex items-start gap-1.5 leading-relaxed">
              <RefreshCw className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-0.5" />
              <span>
                Reading is always a dry run. Nothing is written to the medication ledger until you press save.
              </span>
            </p>
          </div>
        </section>
      )}
    </div>
  );
};
