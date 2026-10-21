import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ClipboardCopy,
  Droplets,
  Footprints,
  Info,
  Pill,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
} from 'lucide-react';
import { api } from '../api';
import { BriefingInsight, DailyBriefing } from '../types';

interface BriefingPanelProps {
  onNavigate?: (view: string) => void;
  onRefresh?: () => void;
}

type Severity = BriefingInsight['severity'];

const SEVERITY_META: Record<
  Severity,
  { card: string; badge: string; icon: typeof AlertTriangle; label: string }
> = {
  critical: {
    card: 'border-rose-200 bg-rose-50/60',
    badge: 'bg-rose-100 text-rose-700',
    icon: AlertTriangle,
    label: 'Needs attention now',
  },
  warning: {
    card: 'border-amber-200 bg-amber-50/60',
    badge: 'bg-amber-100 text-amber-700',
    icon: AlertTriangle,
    label: 'Worth watching',
  },
  info: {
    card: 'border-slate-200 bg-white',
    badge: 'bg-slate-100 text-slate-600',
    icon: Info,
    label: 'For information',
  },
};

const KIND_ICON: Record<BriefingInsight['kind'], typeof Pill> = {
  adherence: Pill,
  labs: Stethoscope,
  vitals: ShieldCheck,
  alert: AlertTriangle,
  plan: Footprints,
  medication: Pill,
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function adherenceTone(rate: number | null): { value: string; className: string } {
  if (rate === null || Number.isNaN(rate)) {
    return { value: 'n/a', className: 'bg-slate-100 text-slate-500' };
  }
  if (rate >= 90) {
    return { value: `${rate}%`, className: 'bg-emerald-50 text-emerald-700' };
  }
  if (rate >= 70) {
    return { value: `${rate}%`, className: 'bg-amber-50 text-amber-700' };
  }
  return { value: `${rate}%`, className: 'bg-rose-50 text-rose-700' };
}

export const BriefingPanel: React.FC<BriefingPanelProps> = ({ onNavigate, onRefresh }) => {
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const onRefreshRef = useRef(onRefresh);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getBriefing();
      setBriefing(data);
    } catch (err) {
      setError(errorMessage(err, 'Could not load the daily briefing.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Refetch when the parent hands over a new refresh handler.
  useEffect(() => {
    if (onRefreshRef.current !== onRefresh) {
      onRefreshRef.current = onRefresh;
      setRefreshKey((key) => key + 1);
    }
  }, [onRefresh]);

  const handleRefresh = () => {
    setRefreshKey((key) => key + 1);
    if (onRefreshRef.current) onRefreshRef.current();
  };

  const handleCopyQuestions = async () => {
    if (!briefing || !briefing.questionsForTheDoctor.length) return;
    const text = briefing.questionsForTheDoctor.map((question, index) => `${index + 1}. ${question}`).join('\n');
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  const groups = useMemo(() => {
    const result: Array<{ memberName: string; insights: BriefingInsight[] }> = [];
    (briefing ? briefing.insights : []).forEach((insight) => {
      const last = result[result.length - 1];
      if (last && last.memberName === insight.memberName) {
        last.insights.push(insight);
      } else {
        result.push({ memberName: insight.memberName, insights: [insight] });
      }
    });
    return result;
  }, [briefing]);

  return (
    <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 sm:p-6 space-y-5 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-xs shrink-0">
            <Sparkles className="w-4.5 h-4.5" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Daily briefing</h2>
            <p className="text-[11px] text-slate-500">
              {briefing
                ? `Generated ${formatGeneratedAt(briefing.generatedAt)}`
                : 'Gathering what changed since yesterday'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onNavigate ? (
            <button
              type="button"
              onClick={() => onNavigate('careplan')}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold"
            >
              <CalendarClock className="w-3.5 h-3.5" />
              Care plan
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="inline-flex items-start gap-2 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          <span className="leading-relaxed">{error}</span>
        </div>
      ) : null}

      {loading && !briefing ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>Assembling today’s briefing…</span>
        </div>
      ) : null}

      {briefing ? (
        <>
          {/* Narrative */}
          <div className="rounded-2xl bg-slate-900 text-white p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Today in {briefing.members.length} {briefing.members.length === 1 ? 'person' : 'people'}
              </span>
            </div>
            <p className="text-xs sm:text-[13px] text-slate-200 leading-relaxed whitespace-pre-line">
              {briefing.narrative}
            </p>
            {briefing.degraded ? (
              <div className="inline-flex items-start gap-2 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0 text-amber-600" />
                <span className="leading-relaxed">
                  The AI narrative was not available, so the deterministic summary is shown instead. Every figure
                  below still comes straight from the records.
                </span>
              </div>
            ) : null}
          </div>

          {/* Insights */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-slate-400" />
              <h3 className="text-sm font-bold text-slate-900">What needs attention</h3>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                {briefing.insights.length} {briefing.insights.length === 1 ? 'item' : 'items'}
              </span>
            </div>

            {groups.length ? (
              <div className="space-y-4">
                {groups.map((group, groupIndex) => (
                  <div key={`${group.memberName}-${groupIndex}`} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        {group.memberName}
                      </span>
                      <span className="h-px flex-1 bg-slate-100" />
                    </div>

                    {group.insights.map((insight, insightIndex) => {
                      const meta = SEVERITY_META[insight.severity];
                      const SeverityIcon = meta.icon;
                      const KindIcon = KIND_ICON[insight.kind] || Info;
                      return (
                        <article
                          key={`${insight.memberId}-${insightIndex}-${insight.headline}`}
                          className={`rounded-2xl border p-4 space-y-2 ${meta.card}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                meta.badge
                              }`}
                            >
                              <SeverityIcon className="w-3 h-3" />
                              {meta.label}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                              <KindIcon className="w-3 h-3" />
                              {insight.kind}
                            </span>
                          </div>

                          <h4 className="text-xs sm:text-[13px] font-bold text-slate-900 leading-snug">
                            {insight.headline}
                          </h4>
                          <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">{insight.detail}</p>

                          {insight.action ? (
                            <div className="rounded-xl bg-white/70 border border-slate-200 p-3 space-y-1">
                              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                Next step
                              </span>
                              <p className="text-xs sm:text-[13px] text-slate-700 leading-relaxed">{insight.action}</p>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 flex items-start gap-3">
                <span className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <Check className="w-4 h-4" />
                </span>
                <div>
                  <p className="text-xs sm:text-[13px] font-bold text-emerald-900">Nothing needs flagging today.</p>
                  <p className="text-xs sm:text-[13px] text-emerald-800/80 leading-relaxed mt-0.5">
                    Records are current and no alerts are open.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Questions for the doctor */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-3.5 h-3.5 text-slate-400" />
                <h3 className="text-sm font-bold text-slate-900">Questions for the doctor</h3>
              </div>
              {briefing.questionsForTheDoctor.length ? (
                <button
                  type="button"
                  onClick={handleCopyQuestions}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy all'}
                </button>
              ) : null}
            </div>

            {briefing.questionsForTheDoctor.length ? (
              <ol className="space-y-2">
                {briefing.questionsForTheDoctor.map((question, index) => (
                  <li key={index} className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-lg bg-white border border-slate-200 text-[10px] font-bold text-slate-600 flex items-center justify-center shrink-0 mt-px">
                      {index + 1}
                    </span>
                    <p className="text-xs sm:text-[13px] text-slate-700 leading-relaxed">{question}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs sm:text-[13px] text-slate-500">
                No questions are queued today. New ones appear when a reading or a missed dose needs discussing.
              </p>
            )}
          </div>

          {/* Per-member summary strip */}
          {briefing.members.length ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                <h3 className="text-sm font-bold text-slate-900">At a glance</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {briefing.members.map((member) => {
                  const adherence = adherenceTone(member.adherenceRate14d);
                  return (
                    <div key={member.memberId} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-xs sm:text-[13px] font-bold text-slate-900">{member.memberName}</div>
                          <div className="text-[10px] text-slate-400">{member.relationship}</div>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${adherence.className}`}
                        >
                          {adherence.value} adherence
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-slate-50 p-2.5 space-y-1">
                          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                            <Pill className="w-3 h-3" />
                            Doses today
                          </div>
                          <div className="text-xs font-bold text-slate-900 tabular-nums">
                            {member.dosesTakenToday} of {member.dosesScheduledToday} taken
                          </div>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-2.5 space-y-1">
                          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                            <Droplets className="w-3 h-3" />
                            Open alerts
                          </div>
                          <div className="text-xs font-bold text-slate-900 tabular-nums">
                            {member.openAlerts} open
                            {member.dosesMissedToday > 0 ? `, ${member.dosesMissedToday} missed` : ''}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
