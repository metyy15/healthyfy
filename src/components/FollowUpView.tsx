import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellRing,
  CalendarClock,
  Check,
  CheckSquare,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  ClipboardList,
  Clock,
  FileText,
  Info,
  Sparkles,
  Square,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { api } from '../api';
import {
  ExtractedTask,
  FamilyMember,
  FollowUpExtraction,
  FollowUpKind,
  FollowUpTask,
  UpcomingFollowUps,
} from '../types';

interface FollowUpViewProps {
  familyMembers: FamilyMember[];
  activeMember: FamilyMember | null;
  onSelectMember: (member: FamilyMember) => void;
}

/** Below this the reading is treated as uncertain and must be checked by a person. */
const CONFIDENCE_THRESHOLD = 0.7;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const KIND_LABELS: Record<FollowUpKind, string> = {
  appointment: 'Appointment',
  test: 'Test',
  bring_records: 'Bring records',
  review_instructions: 'Read instructions',
  medication_review: 'Ask the doctor',
  other: 'Other',
};

const KIND_BADGE: Record<FollowUpKind, string> = {
  appointment: 'bg-sky-50 text-sky-700',
  test: 'bg-violet-50 text-violet-700',
  bring_records: 'bg-teal-50 text-teal-700',
  review_instructions: 'bg-indigo-50 text-indigo-700',
  medication_review: 'bg-emerald-50 text-emerald-700',
  other: 'bg-slate-100 text-slate-600',
};

interface ReminderFeedback {
  scheduled: boolean;
  message: string;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * "20 Jan 2027 at 08:00" for a due date and time pair.
 * Dates are usually YYYY-MM-DD, so they are formatted without a
 * timezone shift rather than being pushed through Date.
 */
function formatDue(dueDate?: string, dueTime?: string): string | null {
  if (!dueDate || !dueDate.trim()) return null;
  const raw = dueDate.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);

  let dayPart: string;
  if (iso) {
    const month = MONTHS[Number(iso[2]) - 1] ?? iso[2];
    dayPart = `${Number(iso[3])} ${month} ${iso[1]}`;
  } else {
    const parsed = new Date(raw);
    dayPart = Number.isNaN(parsed.getTime())
      ? raw
      : new Intl.DateTimeFormat('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }).format(parsed);
  }

  const time = dueTime && dueTime.trim() ? ` at ${dueTime.trim()}` : '';
  return `${dayPart}${time}`;
}

function formatTimestamp(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function confidenceText(confidence: number): string {
  if (confidence >= 0.85) return 'text-emerald-700';
  if (confidence >= CONFIDENCE_THRESHOLD) return 'text-sky-700';
  return 'text-amber-700';
}

const KindBadge: React.FC<{ kind: FollowUpKind }> = ({ kind }) => (
  <span
    className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
      KIND_BADGE[kind] ?? KIND_BADGE.other
    }`}
  >
    {KIND_LABELS[kind] ?? KIND_LABELS.other}
  </span>
);

const ErrorNote: React.FC<{ message: string }> = ({ message }) => (
  <div className="rounded-2xl border border-rose-300 bg-rose-50/70 p-3.5 flex items-start gap-2 text-xs text-rose-800">
    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
    <span className="leading-relaxed">{message}</span>
  </div>
);

export const FollowUpView: React.FC<FollowUpViewProps> = ({
  familyMembers,
  activeMember,
  onSelectMember,
}) => {
  const currentMember = activeMember || familyMembers[0] || null;
  const memberId = currentMember ? currentMember.id : null;

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // -------------------------------------------------------------
  // Section A — the visit instructions
  // -------------------------------------------------------------
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [instructionsText, setInstructionsText] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // -------------------------------------------------------------
  // Section B — the proposed tasks
  // -------------------------------------------------------------
  const [extraction, setExtraction] = useState<FollowUpExtraction | null>(null);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // -------------------------------------------------------------
  // Section C — the tracker
  // -------------------------------------------------------------
  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingFollowUps | null>(null);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerError, setTrackerError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const [reminderTaskId, setReminderTaskId] = useState<string | null>(null);
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [reminderFeedback, setReminderFeedback] = useState<Record<string, ReminderFeedback>>({});

  const resetForm = useCallback(() => {
    setImageBase64(null);
    setImageMimeType(null);
    setFileName(null);
    setInstructionsText('');
    setExtraction(null);
    setSelected([]);
    setSaveError(null);
    setReadError(null);
  }, []);

  useEffect(() => {
    setExtraction(null);
    setSelected([]);
    setSaveMessage(null);
    setSaveError(null);
    setReadError(null);
    setImageBase64(null);
    setImageMimeType(null);
    setFileName(null);
    setInstructionsText('');
  }, [memberId]);

  const loadTracker = useCallback(async (id: string) => {
    setTrackerLoading(true);
    setTrackerError(null);
    try {
      const [taskList, upcomingData] = await Promise.all([
        api.getFollowUps({ memberId: id }),
        api.getUpcomingFollowUps({ memberId: id, days: 7 }),
      ]);
      setTasks(taskList);
      setUpcoming(upcomingData);
    } catch (err) {
      setTrackerError(errorMessage(err, 'The follow-up tracker could not be loaded right now.'));
    } finally {
      setTrackerLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!memberId) {
      setTasks([]);
      setUpcoming(null);
      return;
    }
    void loadTracker(memberId);
  }, [memberId, loadTracker]);

  // -------------------------------------------------------------
  // Section A handlers
  // -------------------------------------------------------------
  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setReadError('Please upload a photo of the visit instructions (PNG, JPG or WEBP).');
      return;
    }
    setReadError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = event.target?.result as string;
      setImageBase64(data);
      setImageMimeType(file.type);
      setFileName(file.name);
    };
    reader.onerror = () => {
      setReadError('That photo could not be read. Try uploading it again.');
    };
    reader.readAsDataURL(file);
  }, []);

  const handleRead = async () => {
    if (!currentMember) return;
    if (!imageBase64 && !instructionsText.trim()) {
      setReadError('Upload a photo of the visit instructions or paste the text first.');
      return;
    }

    setIsReading(true);
    setReadError(null);
    setSaveError(null);
    setSaveMessage(null);

    try {
      const result = await api.extractFollowUps({
        memberId: currentMember.id,
        ...(imageBase64 ? { imageBase64 } : {}),
        ...(imageMimeType ? { imageMimeType } : {}),
        ...(instructionsText.trim() ? { text: instructionsText.trim() } : {}),
      });
      setExtraction(result);
      setSelected(result.tasks.map(() => true));
    } catch (err) {
      setExtraction(null);
      setReadError(errorMessage(err, 'The visit instructions could not be read right now.'));
    } finally {
      setIsReading(false);
    }
  };

  // -------------------------------------------------------------
  // Section B handlers
  // -------------------------------------------------------------
  const toggleTask = useCallback((index: number) => {
    setSelected((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  }, []);

  const handleSaveTasks = async () => {
    if (!currentMember || !extraction) return;

    const chosen: ExtractedTask[] = extraction.tasks.filter((_, index) => selected[index] !== false);
    if (chosen.length === 0) {
      setSaveError('Tick at least one task before saving. Nothing was saved.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const response = await api.saveFollowUps({
        memberId: currentMember.id,
        items: chosen.map((task) => ({
          title: task.title,
          kind: task.kind,
          ...(task.detail ? { detail: task.detail } : {}),
          ...(task.dueDate ? { dueDate: task.dueDate } : {}),
          ...(task.dueTime ? { dueTime: task.dueTime } : {}),
          ...(task.safetyNote ? { safetyNote: task.safetyNote } : {}),
        })),
        sourceLabel: `Visit instructions added on ${new Date().toLocaleDateString('en-GB')}`,
      });

      const count = response.count ?? chosen.length;
      setSaveMessage(
        `${count} task${count === 1 ? '' : 's'} saved to the tracker for ${currentMember.name}. ` +
          `Nothing was booked or sent to anyone — these are reminders for you to act on.`,
      );
      resetForm();
      if (memberId) void loadTracker(memberId);
    } catch (err) {
      setSaveError(errorMessage(err, 'The selected tasks could not be saved.'));
    } finally {
      setIsSaving(false);
    }
  };

  // -------------------------------------------------------------
  // Section C handlers
  // -------------------------------------------------------------
  const handleComplete = async (task: FollowUpTask) => {
    setBusyId(task.id);
    setActionError(null);
    try {
      await api.completeFollowUp(task.id);
      if (memberId) await loadTracker(memberId);
    } catch (err) {
      setActionError(errorMessage(err, 'That task could not be marked as done.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = async (task: FollowUpTask) => {
    setBusyId(task.id);
    setActionError(null);
    try {
      await api.dismissFollowUp(task.id);
      if (memberId) await loadTracker(memberId);
    } catch (err) {
      setActionError(errorMessage(err, 'That task could not be dismissed.'));
    } finally {
      setBusyId(null);
    }
  };

  const openReminderForm = (task: FollowUpTask) => {
    setReminderTaskId(task.id);
    setReminderDate(task.dueDate ?? '');
    setReminderTime(task.dueTime ?? '');
    setReminderError(null);
  };

  const closeReminderForm = () => {
    setReminderTaskId(null);
    setReminderError(null);
  };

  const handleSetReminder = async (task: FollowUpTask) => {
    if (!reminderDate.trim() || !reminderTime.trim()) {
      setReminderError('Choose both a date and a time for the reminder.');
      return;
    }

    setBusyId(task.id);
    setReminderError(null);

    try {
      const response = await api.remindFollowUp(task.id, {
        dueDate: reminderDate.trim(),
        dueTime: reminderTime.trim(),
      });

      setReminderFeedback((prev) => ({
        ...prev,
        [task.id]: { scheduled: response.scheduled, message: response.message },
      }));

      setTasks((prev) =>
        prev.map((item) => (item.id === response.task.id ? response.task : item))
      );

      if (response.scheduled) {
        setReminderTaskId(null);
        if (memberId) await loadTracker(memberId);
      }
    } catch (err) {
      setReminderError(errorMessage(err, 'The reminder could not be set.'));
    } finally {
      setBusyId(null);
    }
  };

  if (!currentMember) {
    return (
      <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-8 text-center space-y-2">
        <FileText className="w-7 h-7 mx-auto text-slate-300" />
        <p className="text-sm font-bold text-slate-700">No family member selected</p>
        <p className="text-xs text-slate-500">
          Add a family member before adding visit instructions.
        </p>
      </div>
    );
  }

  const pendingTasks = tasks.filter((task) => task.status === 'pending');
  const closedTasks = tasks.filter((task) => task.status !== 'pending');
  const selectedCount = extraction ? extraction.tasks.filter((_, i) => selected[i] !== false).length : 0;

  const upcomingGroups: Array<{ label: string; items: FollowUpTask[] }> = upcoming
    ? [
        { label: 'Overdue', items: upcoming.overdue },
        { label: 'Due today', items: upcoming.today },
        { label: 'This week', items: upcoming.thisWeek },
        { label: 'Later', items: upcoming.later },
      ]
    : [];

  return (
    <div className="space-y-6 animate-in fade-in duration-200 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md mb-1">
            <ClipboardList className="w-3.5 h-3.5 text-emerald-600" />
            <span>Visit Instructions &amp; Follow-up Tracker</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Follow-up tracker
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Turn the instructions from a visit into a short list of things to do for{' '}
            {currentMember.name}. You confirm each one before it is saved.
          </p>
        </div>

        {/* Member switcher */}
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

      {/* =========================================================
          Section A — add visit instructions
          ========================================================= */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900">Add visit instructions</h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Photo or pasted text
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
            <FileText className="w-7 h-7 mx-auto text-slate-300" />
            <p className="text-sm font-bold text-slate-700 mt-2">
              {fileName ? fileName : 'Drop a photo of the visit notes here'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {fileName ? 'Tap to choose a different photo' : 'or click to browse your photos'}
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
              htmlFor="visit-instructions-text"
              className="block text-[10px] font-bold uppercase tracking-wide text-slate-400"
            >
              Or paste the instructions
            </label>
            <textarea
              id="visit-instructions-text"
              rows={8}
              value={instructionsText}
              onChange={(e) => setInstructionsText(e.target.value)}
              placeholder={
                'Follow-up visit in 3 months.\nBring the last lipid panel report.\nAsk Dr Rao whether to continue the current dose of the tablet.'
              }
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs font-mono leading-relaxed focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden resize-none"
            />
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Use this when you already have the instructions typed out, or when the photo is too blurry to
              read.
            </p>
          </div>
        </div>

        {readError && <ErrorNote message={readError} />}

        {saveMessage && (
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50/70 p-3.5 flex items-start gap-2 text-xs sm:text-[13px] text-emerald-900">
            <CircleCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span className="font-bold leading-relaxed">{saveMessage}</span>
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
                <Clock className="w-4 h-4 animate-spin" />
                <span>Reading the instructions...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Read the instructions</span>
              </>
            )}
          </button>

          <p className="text-[11px] text-slate-500 flex items-start gap-1.5 leading-relaxed">
            <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
            <span>
              Reading is a dry run. Nothing is written to the tracker until you tick the tasks that are right
              and press &ldquo;Save selected tasks&rdquo;.
            </span>
          </p>
        </div>
      </section>

      {/* =========================================================
          Section B — confirm the extracted tasks
          ========================================================= */}
      {extraction && (
        <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Notice: nothing is saved yet */}
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-emerald-600" />
              <h2 className="text-sm font-bold text-emerald-900">Suggested follow-up tasks</h2>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-white/80 p-3.5 space-y-1.5">
              <p className="text-xs sm:text-[13px] font-bold text-emerald-900 leading-relaxed">
                {extraction.notice}
              </p>
              <p className="text-xs sm:text-[13px] text-emerald-900/90 leading-relaxed">
                In our own words: these are only proposals. Healthyfy has not booked an appointment, not
                contacted a doctor and not sent a message to anyone. Tick the ones that are right and save
                them to your tracker.
              </p>
            </div>

            {extraction.degraded && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-3.5 flex items-start gap-2 text-xs sm:text-[13px] text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  <strong className="font-bold">The AI service is not configured.</strong> This extraction came
                  from a basic text parser, so it is not reliable. Check every line against the original
                  document before you save it.
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-[13px] text-slate-600">
              {extraction.prescriber && (
                <span>
                  Prescriber: <strong className="text-slate-800">{extraction.prescriber}</strong>
                </span>
              )}
              {extraction.visitDate && (
                <span>
                  Visit date: <strong className="text-slate-800">{extraction.visitDate}</strong>
                </span>
              )}
              <span>
                For: <strong className="text-slate-800">{extraction.memberName}</strong>
              </span>
            </div>

            {extraction.notes && (
              <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 block mb-1">
                  Document notes
                </span>
                {extraction.notes}
              </p>
            )}

            {extraction.unreadableParts.length > 0 && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-3.5 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span className="text-[10px] font-bold uppercase tracking-wide text-amber-800">
                    Parts that could not be read
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {extraction.unreadableParts.map((part, index) => (
                    <li
                      key={index}
                      className="flex items-start gap-2 text-xs sm:text-[13px] text-amber-900 leading-relaxed"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                      <span>{part}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Proposed task cards */}
          <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-3">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">Check the tasks</h3>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {selectedCount} of {extraction.tasks.length} selected
              </span>
            </div>

            {extraction.tasks.length === 0 ? (
              <p className="text-xs sm:text-[13px] text-slate-500 py-4 text-center leading-relaxed">
                No follow-up tasks could be read from these instructions. Nothing has been saved.
              </p>
            ) : (
              <div className="space-y-3">
                {extraction.tasks.map((task, index) => {
                  const checked = selected[index] !== false;
                  const percent = Math.max(
                    0,
                    Math.min(100, Math.round(task.confidence * 100))
                  );
                  const needsCheck = task.confidence < CONFIDENCE_THRESHOLD;
                  const due = formatDue(task.dueDate, task.dueTime);

                  return (
                    <div
                      key={`${task.title}-${index}`}
                      className={`rounded-2xl border p-4 space-y-2.5 ${
                        checked
                          ? 'border-slate-200/90 bg-slate-50/50'
                          : 'border-slate-200 bg-white opacity-70'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          aria-label={`${checked ? 'Untick' : 'Tick'} ${task.title}`}
                          onClick={() => toggleTask(index)}
                          className="shrink-0 mt-0.5 cursor-pointer"
                        >
                          {checked ? (
                            <CheckSquare className="w-5 h-5 text-emerald-600" />
                          ) : (
                            <Square className="w-5 h-5 text-slate-300" />
                          )}
                        </button>

                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">{task.title}</span>
                            <KindBadge kind={task.kind} />
                          </div>

                          {task.kind === 'medication_review' && (
                            <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-2.5 py-1.5 leading-relaxed">
                              This is a question for the prescriber. Healthyfy does not change, stop or adjust
                              any medicine &mdash; take the question to your doctor.
                            </p>
                          )}

                          {due && (
                            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                              <CalendarClock className="w-3.5 h-3.5 text-slate-400" />
                              <span>{due}</span>
                            </div>
                          )}

                          {task.detail && (
                            <blockquote className="border-l-2 border-slate-300 pl-3 text-xs italic text-slate-500 leading-relaxed">
                              &ldquo;{task.detail}&rdquo;
                            </blockquote>
                          )}

                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                              Confidence
                            </span>
                            <span
                              className={`text-xs font-bold tabular-nums ${confidenceText(
                                task.confidence
                              )}`}
                            >
                              Confidence {percent}%
                            </span>
                            {needsCheck && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-300">
                                <AlertTriangle className="w-3 h-3" />
                                Check this
                              </span>
                            )}
                          </div>

                          {task.unsupported && (
                            <div className="rounded-xl border border-amber-300 bg-amber-50/70 px-3 py-2.5 flex items-start gap-2 text-xs text-amber-900 leading-relaxed">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                              <span>
                                This wording could not be found in the document, so it may be a misreading.
                              </span>
                            </div>
                          )}

                          {task.safetyNote && (
                            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 space-y-1">
                              <div className="flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                                <span className="text-[10px] font-bold uppercase tracking-wide text-amber-800">
                                  Why this was rewritten
                                </span>
                              </div>
                              <p className="text-xs text-amber-900 leading-relaxed">{task.safetyNote}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Save panel */}
          <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900">Save selected tasks</h3>
                <p className="text-xs text-slate-500 max-w-xl leading-relaxed">
                  {selectedCount === 0
                    ? 'Nothing is ticked, so nothing will be saved. Tick at least one task.'
                    : `${selectedCount} task${selectedCount === 1 ? '' : 's'} will be added to the tracker for ${currentMember.name}.`}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleSaveTasks()}
                  disabled={isSaving || isReading || selectedCount === 0}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSaving ? (
                    <>
                      <Clock className="w-4 h-4 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Save selected tasks</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold cursor-pointer shrink-0"
                >
                  Clear
                </button>
              </div>
            </div>

            {saveError && <ErrorNote message={saveError} />}

            <p className="text-[11px] text-slate-400 flex items-start gap-1.5 leading-relaxed">
              <Info className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-0.5" />
              <span>
                Saving creates tasks and reminders on this device. It does not book appointments, contact
                doctors or message anyone.
              </span>
            </p>
          </div>
        </section>
      )}

      {/* =========================================================
          Section C — the tracker
          ========================================================= */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900">What needs doing</h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Next {upcoming?.days ?? 7} days
          </span>
        </div>

        {trackerError && <ErrorNote message={trackerError} />}

        {upcoming && (
          <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">{upcoming.summary}</p>
        )}

        {trackerLoading && !upcoming ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Clock className="w-3.5 h-3.5 animate-spin" />
            <span>Loading the tracker...</span>
          </div>
        ) : null}

        {!upcoming && !trackerLoading ? (
          <p className="text-xs sm:text-[13px] text-slate-500">
            The summary of what needs doing could not be loaded right now. The full task list below is
            still shown.
          </p>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {upcomingGroups.map((group) => (
            <div
              key={group.label}
              className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  {group.label}
                </span>
                <span className="text-[10px] font-bold text-slate-400 tabular-nums">
                  {group.items.length}
                </span>
              </div>

              {group.items.length === 0 ? (
                <p className="text-xs text-slate-400">Nothing here</p>
              ) : (
                <ul className="space-y-1.5">
                  {group.items.map((task) => {
                    const due = formatDue(task.dueDate, task.dueTime);
                    return (
                      <li
                        key={task.id}
                        className="flex items-start gap-2 text-xs sm:text-[13px] text-slate-700 leading-snug"
                      >
                        <CircleDashed className="w-3.5 h-3.5 text-slate-300 mt-0.5 shrink-0" />
                        <span>
                          {task.title}
                          {due ? <span className="text-slate-400"> · {due}</span> : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>

        {/* The honest note about what a task is */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-1.5">
          <div className="flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              What a task means
            </span>
          </div>
          <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">
            A task is something the person still has to do themselves. Healthyfy does not book appointments,
            it does not contact the doctor or the clinic, and it does not send a message to anyone on your
            behalf. It keeps a list and a reminder so the visit does not get forgotten.
          </p>
        </div>
      </section>

      {/* Pending tasks */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900">Follow-up tasks</h2>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
            {pendingTasks.length} outstanding
          </span>
        </div>

        {actionError && <ErrorNote message={actionError} />}

        {pendingTasks.length === 0 ? (
          <p className="text-xs sm:text-[13px] text-slate-500">
            Nothing is outstanding for {currentMember.name}. Add the instructions from a visit above to
            create a task.
          </p>
        ) : (
          <div className="space-y-3">
            {pendingTasks.map((task) => {
              const due = formatDue(task.dueDate, task.dueTime);
              const feedback = reminderFeedback[task.id];
              const isReminderOpen = reminderTaskId === task.id;

              return (
                <div
                  key={task.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs sm:text-[13px] font-bold text-slate-900">{task.title}</span>
                    <KindBadge kind={task.kind} />
                    {task.reminderScheduled && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                        <BellRing className="w-3 h-3" />
                        Reminder set
                      </span>
                    )}
                  </div>

                  {task.kind === 'medication_review' && (
                    <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-2.5 py-1.5 leading-relaxed">
                      A question to put to the prescriber. Do not change the dose on the strength of a note
                      in this app.
                    </p>
                  )}

                  {due && (
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                      <CalendarClock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{due}</span>
                    </div>
                  )}

                  {task.detail && (
                    <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">{task.detail}</p>
                  )}

                  {task.safetyNote && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-800">
                          Why this was rewritten
                        </span>
                      </div>
                      <p className="text-xs text-amber-900 leading-relaxed">{task.safetyNote}</p>
                    </div>
                  )}

                  {task.sourceLabel && (
                    <p className="text-[10px] text-slate-400">From: {task.sourceLabel}</p>
                  )}

                  {feedback && (
                    <div
                      className={`rounded-xl border px-3 py-2.5 flex items-start gap-2 text-xs leading-relaxed ${
                        feedback.scheduled
                          ? 'border-emerald-300 bg-emerald-50/70 text-emerald-900'
                          : 'border-amber-300 bg-amber-50/70 text-amber-900'
                      }`}
                    >
                      {feedback.scheduled ? (
                        <CircleCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      )}
                      <span className="font-semibold">{feedback.message}</span>
                    </div>
                  )}

                  {isReminderOpen && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
                      <div className="flex items-center gap-2">
                        <Bell className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          Set a reminder for yourself
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label
                            htmlFor={`reminder-date-${task.id}`}
                            className="block text-xs font-semibold text-slate-700 mb-1"
                          >
                            Date
                          </label>
                          <input
                            id={`reminder-date-${task.id}`}
                            type="date"
                            value={reminderDate}
                            onChange={(e) => setReminderDate(e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`reminder-time-${task.id}`}
                            className="block text-xs font-semibold text-slate-700 mb-1"
                          >
                            Time
                          </label>
                          <input
                            id={`reminder-time-${task.id}`}
                            type="time"
                            value={reminderTime}
                            onChange={(e) => setReminderTime(e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
                          />
                        </div>
                      </div>

                      {reminderError && <ErrorNote message={reminderError} />}

                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        Both a date and a time are needed. The reminder appears in this app&rsquo;s
                        notification inbox at that moment &mdash; it is not sent to anyone else.
                      </p>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSetReminder(task)}
                          disabled={busyId === task.id}
                          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {busyId === task.id ? (
                            <>
                              <Clock className="w-4 h-4 animate-spin" />
                              <span>Setting...</span>
                            </>
                          ) : (
                            <>
                              <BellRing className="w-4 h-4" />
                              <span>Set reminder</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={closeReminderForm}
                          className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleComplete(task)}
                      disabled={busyId === task.id}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      <span>Mark done</span>
                    </button>

                    {!isReminderOpen && (
                      <button
                        type="button"
                        onClick={() => openReminderForm(task)}
                        className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Bell className="w-4 h-4" />
                        <span>Set reminder</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => void handleDismiss(task)}
                      disabled={busyId === task.id}
                      className="px-4 py-2.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <X className="w-4 h-4" />
                      <span>Dismiss</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Completed and dismissed */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-3">
        <button
          type="button"
          onClick={() => setShowClosed((prev) => !prev)}
          className="w-full flex items-center justify-between gap-3 text-left cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <CircleCheck className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-bold text-slate-900">
              Completed and dismissed
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
              {closedTasks.length}
            </span>
          </span>
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform ${
              showClosed ? 'rotate-180' : ''
            }`}
          />
        </button>

        {showClosed && (
          <div className="space-y-2 pt-1">
            {closedTasks.length === 0 ? (
              <p className="text-xs sm:text-[13px] text-slate-500">Nothing here yet.</p>
            ) : (
              closedTasks.map((task) => {
                const due = formatDue(task.dueDate, task.dueTime);
                return (
                  <div
                    key={task.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs sm:text-[13px] font-semibold text-slate-700 line-through">
                          {task.title}
                        </span>
                        <KindBadge kind={task.kind} />
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                          {task.status === 'done' ? 'Done' : 'Dismissed'}
                        </span>
                      </div>
                      {due && (
                        <p className="text-[10px] text-slate-400">Was due {due}</p>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 shrink-0">
                      {task.status === 'done' ? 'Completed' : 'Closed'} {formatTimestamp(task.completedAt)}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>
    </div>
  );
};
