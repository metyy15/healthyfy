import React, { useEffect, useState } from 'react';
import {
  Wrench,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronRight,
  ShieldQuestion,
  Check,
  X,
  Loader2,
} from 'lucide-react';
import { api } from '../api';
import { PendingAction, ToolTraceEntry } from '../types';

interface AgentTraceProps {
  trace: ToolTraceEntry[];
  pendingActionIds?: string[];
  onActionChanged?: () => void;
}

const TOOL_LABELS: Record<string, string> = {
  get_family_profile: 'Read family profile',
  get_medical_reports: 'Read medical reports',
  get_medications: 'Read medication list',
  get_adherence_log: 'Read adherence log',
  get_vitals: 'Read recorded vitals',
  get_open_alerts: 'Read open alerts',
  build_exercise_plan: 'Build activity plan',
  run_safety_check: 'Check interactions',
  create_reminder: 'Create reminder',
  create_alert: 'Raise alert',
};

function summariseArgs(args: Record<string, any>): string {
  if (!args || Object.keys(args).length === 0) return '';
  return Object.entries(args)
    .filter(([key]) => key !== 'memberId')
    .map(([key, value]) => {
      if (value === null || value === undefined || value === '') return null;
      if (Array.isArray(value)) {
        const names = value
          .map((v) => (typeof v === 'object' && v ? v.name || v.title || JSON.stringify(v) : String(v)))
          .filter(Boolean);
        return names.length ? `${key}: ${names.join(', ')}` : null;
      }
      if (typeof value === 'object') return null;
      return `${key}: ${value}`;
    })
    .filter(Boolean)
    .join(' · ');
}

export const AgentTrace: React.FC<AgentTraceProps> = ({
  trace,
  pendingActionIds = [],
  onActionChanged,
}) => {
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (pendingActionIds.length === 0) return;
    api
      .getPendingActions()
      .then((actions) => setPending(actions.filter((a) => pendingActionIds.includes(a.id))))
      .catch(() => setPending([]));
  }, [pendingActionIds.join(',')]);

  if (!trace || trace.length === 0) return null;

  const handleApprove = async (id: string) => {
    setBusyId(id);
    try {
      await api.approvePendingAction(id);
      setPending((prev) => prev.filter((a) => a.id !== id));
      onActionChanged?.();
    } catch {
      /* the error is surfaced by the row staying visible */
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = async (id: string) => {
    setBusyId(id);
    try {
      await api.dismissPendingAction(id);
      setPending((prev) => prev.filter((a) => a.id !== id));
      onActionChanged?.();
    } catch {
      /* ignore */
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        <Wrench className="w-3 h-3" />
        <span>Tool activity</span>
        <span className="text-slate-300">·</span>
        <span className="text-slate-400 normal-case font-medium">
          {trace.length} step{trace.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 divide-y divide-slate-200/70 overflow-hidden">
        {trace.map((entry) => {
          const isPending = entry.pending;
          const action = pending.find((p) => p.id === entry.result?.actionId);
          const isOpen = expanded[entry.name];

          return (
            <div key={`${entry.step}-${entry.name}`} className="px-3 py-2">
              <div className="flex items-start gap-2">
                <div className="mt-0.5 shrink-0">
                  {entry.ok ? (
                    isPending ? (
                      <ShieldQuestion className="w-3.5 h-3.5 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    )
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-bold text-slate-800">
                      {TOOL_LABELS[entry.name] || entry.name}
                    </span>
                    {isPending && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700">
                        Awaiting approval
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-[9px] text-slate-400">
                      <Clock className="w-2.5 h-2.5" />
                      {entry.durationMs}ms
                    </span>
                  </div>

                  {summariseArgs(entry.args) && (
                    <p className="text-[10px] text-slate-500 mt-0.5 break-words">
                      {summariseArgs(entry.args)}
                    </p>
                  )}

                  {entry.error && (
                    <p className="text-[10px] text-rose-600 mt-0.5">{entry.error}</p>
                  )}

                  {isPending && action && (
                    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5">
                      <p className="text-[11px] font-bold text-amber-900">{action.label}</p>
                      <p className="text-[10px] text-amber-800/80 mt-0.5">
                        This has not run yet. Approve it to let the assistant carry it out.
                      </p>
                      <div className="flex items-center gap-1.5 mt-2">
                        <button
                          onClick={() => handleApprove(action.id)}
                          disabled={busyId === action.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold disabled:opacity-50"
                        >
                          {busyId === action.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Check className="w-3 h-3" />
                          )}
                          Approve
                        </button>
                        <button
                          onClick={() => handleDismiss(action.id)}
                          disabled={busyId === action.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-amber-200 text-amber-800 hover:bg-amber-100 rounded-lg text-[10px] font-bold disabled:opacity-50"
                        >
                          <X className="w-3 h-3" />
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}

                  {!isPending && entry.result !== undefined && (
                    <button
                      onClick={() =>
                        setExpanded((prev) => ({ ...prev, [entry.name]: !prev[entry.name] }))
                      }
                      className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-slate-600"
                    >
                      <ChevronRight
                        className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      />
                      {isOpen ? 'Hide result' : 'Show result'}
                    </button>
                  )}

                  {isOpen && (
                    <pre className="mt-1.5 max-h-48 overflow-auto rounded-xl bg-slate-900/[0.04] border border-slate-200/70 p-2 text-[9.5px] leading-relaxed text-slate-600 whitespace-pre-wrap break-words">
                      {JSON.stringify(entry.result, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
