import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  HeartPulse,
  MapPin,
  Phone,
  Radio,
  RefreshCw,
  ShieldAlert,
  Siren,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { api } from '../api';
import {
  EscalationStep,
  FamilyMember,
  HealthAlert,
  HeartRateAnalysis,
  MonitorOverview,
} from '../types';

interface AlertsViewProps {
  familyMembers: FamilyMember[];
  activeMember: FamilyMember | null;
  onSelectMember: (member: FamilyMember) => void;
  onRefresh?: () => void;
}

type AlertSeverity = HealthAlert['severity'];
type AlertStatus = HealthAlert['status'];
type Classification = HeartRateAnalysis['classification'];

/**
 * The simulate endpoint also accepts a severity for manual alerts. It is kept
 * on a local payload type so the call stays fully typed against the api helper.
 */
interface SimulatePayload {
  memberId: string;
  type: string;
  bpm?: number;
  message?: string;
  severity?: 'info' | 'warning' | 'critical';
}

const ALERT_TYPE_LABELS: Record<HealthAlert['type'], string> = {
  heart_rate: 'Heart rate',
  fall: 'Fall',
  spo2: 'Blood oxygen',
  inactivity: 'Inactivity',
  medication_missed: 'Medication missed',
  safety: 'Safety',
  manual: 'Manual',
};

const SEVERITY_BADGE: Record<AlertSeverity, string> = {
  critical: 'bg-rose-50 text-rose-700 border border-rose-200/80',
  warning: 'bg-amber-50 text-amber-800 border border-amber-200/80',
  info: 'bg-slate-100 text-slate-700 border border-slate-200',
};

const SEVERITY_STRIPE: Record<AlertSeverity, string> = {
  critical: 'bg-rose-500',
  warning: 'bg-amber-500',
  info: 'bg-slate-400',
};

const SEVERITY_EDGE: Record<AlertSeverity, string> = {
  critical: 'border-l-rose-500',
  warning: 'border-l-amber-500',
  info: 'border-l-slate-300',
};

const STATUS_BADGE: Record<AlertStatus, string> = {
  open: 'bg-rose-50 text-rose-700 border border-rose-200/80',
  acknowledged: 'bg-amber-50 text-amber-800 border border-amber-200/80',
  resolved: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80',
  cancelled: 'bg-slate-100 text-slate-600 border border-slate-200',
};

const STATUS_WORD: Record<AlertStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
};

const CHANNEL_LABELS: Record<EscalationStep['channel'], string> = {
  push: 'Push notification',
  sms: 'SMS',
  email: 'Email',
  in_app: 'In-app inbox',
};

const CLASSIFICATION_BADGE: Record<Classification, string> = {
  normal: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80',
  elevated: 'bg-amber-50 text-amber-800 border border-amber-200/80',
  critical: 'bg-rose-50 text-rose-700 border border-rose-200/80',
  bradycardia: 'bg-sky-50 text-sky-700 border border-sky-200/80',
};

const CLASSIFICATION_LABELS: Record<Classification, string> = {
  normal: 'Normal',
  elevated: 'Elevated',
  critical: 'Critical',
  bradycardia: 'Bradycardia',
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

export const AlertsView: React.FC<AlertsViewProps> = ({
  familyMembers,
  activeMember,
  onSelectMember,
  onRefresh,
}) => {
  const currentMember = activeMember || familyMembers[0] || null;
  const memberId = currentMember ? currentMember.id : null;

  const [alerts, setAlerts] = useState<HealthAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);

  const [overview, setOverview] = useState<MonitorOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [actionId, setActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(() => new Set());

  const [simulating, setSimulating] = useState<string | null>(null);
  const [simMessage, setSimMessage] = useState<string | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  const loadAlerts = useCallback(async () => {
    if (!memberId) return;
    setAlertsLoading(true);
    setAlertsError(null);
    try {
      const list = await api.getAlerts({ memberId });
      setAlerts(list);
    } catch (err) {
      setAlertsError(
        err instanceof Error ? err.message : 'The alerts could not be loaded right now.'
      );
    } finally {
      setAlertsLoading(false);
    }
  }, [memberId]);

  const loadOverview = useCallback(async () => {
    if (!memberId) return;
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const result = await api.getMonitorOverview(memberId);
      setOverview(result);
    } catch (err) {
      setOverviewError(
        err instanceof Error ? err.message : 'The monitoring status could not be loaded right now.'
      );
    } finally {
      setOverviewLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    setSimMessage(null);
    setSimError(null);
    setActionError(null);
    setExpandedAlerts(new Set());
    if (!memberId) {
      setAlerts([]);
      setOverview(null);
      setAlertsLoading(false);
      setOverviewLoading(false);
      return;
    }
    void loadAlerts();
    void loadOverview();
  }, [memberId, loadAlerts, loadOverview]);

  const toggleAlert = (id: string) => {
    setExpandedAlerts((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAcknowledge = async (alert: HealthAlert) => {
    setActionId(alert.id);
    setActionError(null);
    try {
      await api.acknowledgeAlert(alert.id);
      await loadAlerts();
      await loadOverview();
      onRefresh?.();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'The alert could not be acknowledged.'
      );
    } finally {
      setActionId(null);
    }
  };

  const handleResolve = async (alert: HealthAlert) => {
    setActionId(alert.id);
    setActionError(null);
    try {
      await api.resolveAlert(alert.id, 'Resolved from the alerts view.');
      await loadAlerts();
      await loadOverview();
      onRefresh?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'The alert could not be resolved.');
    } finally {
      setActionId(null);
    }
  };

  const handleSimulate = async (kind: 'fall' | 'heart_rate' | 'manual') => {
    if (!currentMember) return;
    setSimulating(kind);
    setSimMessage(null);
    setSimError(null);
    try {
      let payload: SimulatePayload;
      if (kind === 'fall') {
        payload = { memberId: currentMember.id, type: 'fall' };
      } else if (kind === 'heart_rate') {
        payload = { memberId: currentMember.id, type: 'heart_rate', bpm: 148 };
      } else {
        payload = {
          memberId: currentMember.id,
          type: 'manual',
          severity: 'warning',
          message: `Manual test alert for ${currentMember.name} raised from the demo controls.`,
        };
      }

      const result = await api.simulateAlert(payload);

      if ('created' in result) {
        setSimMessage(result.message);
      } else {
        setSimMessage(
          `Alert raised: ${result.title}. It is now listed under open alerts with its escalation timeline.`
        );
      }

      await loadAlerts();
      await loadOverview();
      onRefresh?.();
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'The test alert could not be raised.');
    } finally {
      setSimulating(null);
    }
  };

  if (!currentMember) {
    return (
      <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-8 text-center animate-in fade-in duration-200">
        <Siren className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm font-bold text-slate-800">No family member selected</p>
        <p className="text-xs sm:text-[13px] text-slate-600 mt-1">
          Add a family member to see their alerts and monitoring status.
        </p>
      </div>
    );
  }

  const openAlerts = alerts.filter(
    (alert) => alert.status === 'open' || alert.status === 'acknowledged'
  );
  const closedAlerts = alerts.filter(
    (alert) => alert.status === 'resolved' || alert.status === 'cancelled'
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-200 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md mb-1">
            <Siren className="w-3.5 h-3.5 text-emerald-600" />
            <span>Live Monitoring &amp; Escalation</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Alerts &amp; Monitoring
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Open alerts for {currentMember.name}, the confirmation-first escalation ladder and
            the state of the monitoring engine behind them.
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

      {/* -------------------------------------------------------------
          Section A — Open alerts
      ------------------------------------------------------------- */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-500" />
            <h2 className="text-sm font-bold text-slate-900">Open alerts</h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {openAlerts.length} needing attention
          </span>
        </div>

        {alertsError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5">
            <p className="text-xs sm:text-[13px] text-rose-800">
              <strong className="font-bold">Could not load alerts:</strong> {alertsError}
            </p>
            <button
              type="button"
              onClick={() => void loadAlerts()}
              className="mt-2 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-[11px] font-bold flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Try again</span>
            </button>
          </div>
        )}

        {actionError && (
          <p className="text-xs sm:text-[13px] text-rose-600 font-semibold">{actionError}</p>
        )}

        {alertsLoading && (
          <p className="text-xs sm:text-[13px] text-slate-500 flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
            <span>Loading alerts…</span>
          </p>
        )}

        {!alertsLoading && openAlerts.length === 0 && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-emerald-800">
                No open alerts for {currentMember.name}.
              </p>
              <p className="text-xs sm:text-[13px] text-emerald-700 mt-0.5">
                Nothing needs a response right now. A new alert appears here the moment the
                monitoring engine raises one.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {openAlerts.map((alert) => {
            const isExpanded = expandedAlerts.has(alert.id);
            const busy = actionId === alert.id;
            return (
              <div
                key={alert.id}
                className={`rounded-2xl border border-slate-200 border-l-4 ${SEVERITY_EDGE[alert.severity]} overflow-hidden bg-white`}
              >
                {/* Severity stripe */}
                <div className={`h-1 w-full ${SEVERITY_STRIPE[alert.severity]}`} />

                <div className="p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          {ALERT_TYPE_LABELS[alert.type]}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${SEVERITY_BADGE[alert.severity]}`}
                        >
                          {alert.severity}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${STATUS_BADGE[alert.status]}`}
                        >
                          {STATUS_WORD[alert.status]}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 mt-1">{alert.title}</h3>
                      <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed mt-0.5">
                        {alert.message}
                      </p>
                    </div>
                    <div className="text-[10px] text-slate-400 flex items-center gap-1 shrink-0">
                      <Clock className="w-3 h-3" />
                      <span>{formatDateTime(alert.detectedAt)}</span>
                    </div>
                  </div>

                  {/* Location block for fall alerts */}
                  {alert.location && (
                    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">
                        <MapPin className="w-3.5 h-3.5 text-rose-500" />
                        <span>Last known location</span>
                      </div>
                      <div className="text-xs font-bold text-slate-900 tabular-nums">
                        {alert.location.lat.toFixed(5)}, {alert.location.lng.toFixed(5)}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {alert.location.label ? `${alert.location.label} · ` : ''}
                        {alert.location.accuracyM !== undefined
                          ? `Accuracy ±${alert.location.accuracyM} m · `
                          : 'Accuracy unknown · '}
                        Captured {formatDateTime(alert.location.capturedAt)}
                      </div>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${alert.location.lat},${alert.location.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-[11px] font-bold"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>Open in maps</span>
                      </a>
                    </div>
                  )}

                  {/* Escalation timeline */}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                    <button
                      type="button"
                      onClick={() => toggleAlert(alert.id)}
                      className="w-full flex items-center justify-between gap-2 text-left"
                    >
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        <span>Escalation timeline</span>
                        <span className="text-[10px] font-bold text-slate-400">
                          ({alert.escalation.length} step
                          {alert.escalation.length === 1 ? '' : 's'})
                        </span>
                      </span>
                      {alert.acknowledgedBy ? (
                        <span className="text-[10px] text-slate-400">
                          Acknowledged by {alert.acknowledgedBy} ·{' '}
                          {formatDateTime(alert.acknowledgedAt)}
                        </span>
                      ) : null}
                    </button>

                    {isExpanded && (
                      <ol className="mt-3 pl-4 border-l border-slate-200 space-y-3">
                        {alert.escalation.length === 0 ? (
                          <li className="text-[11px] text-slate-400">
                            No escalation step has been recorded yet.
                          </li>
                        ) : (
                          alert.escalation.map((step, index) => (
                            <li key={`${alert.id}-step-${index}`} className="relative">
                              <span
                                className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ring-4 ring-slate-50 ${
                                  step.delivered ? 'bg-emerald-500' : 'bg-slate-300'
                                }`}
                              />
                              <div className="text-[11px] font-bold text-slate-800">
                                Level {step.level} · {CHANNEL_LABELS[step.channel]}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                Recipient: {step.recipient} ·{' '}
                                {step.delivered ? 'Delivered' : 'Not delivered'}
                              </div>
                              {step.note ? (
                                <div className="text-[11px] text-slate-500 leading-relaxed">
                                  {step.note}
                                </div>
                              ) : null}
                              <div className="text-[10px] text-slate-400">
                                {formatDateTime(step.at)}
                              </div>
                            </li>
                          ))
                        )}
                      </ol>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAcknowledge(alert)}
                      disabled={busy || alert.status === 'acknowledged'}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>
                        {alert.status === 'acknowledged' ? 'Acknowledged' : 'Acknowledge'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleResolve(alert)}
                      disabled={busy}
                      className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Resolve</span>
                    </button>
                    {busy ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Working…</span>
                      </span>
                    ) : null}
                    {alert.resolvedAt ? (
                      <span className="text-[10px] text-slate-400">
                        Resolved {formatDateTime(alert.resolvedAt)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {closedAlerts.length > 0 && (
          <details className="rounded-2xl border border-slate-200 bg-slate-50/60">
            <summary className="px-4 py-3 text-[11px] font-bold text-slate-600 cursor-pointer select-none flex items-center gap-1.5">
              <ChevronRight className="w-3.5 h-3.5" />
              <span>
                {closedAlerts.length} closed alert{closedAlerts.length === 1 ? '' : 's'}
              </span>
            </summary>
            <div className="px-4 pb-4 space-y-2">
              {closedAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        {ALERT_TYPE_LABELS[alert.type]}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${STATUS_BADGE[alert.status]}`}
                      >
                        {STATUS_WORD[alert.status]}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-slate-800 mt-0.5">{alert.title}</div>
                    {alert.resolutionNote ? (
                      <div className="text-[11px] text-slate-500">{alert.resolutionNote}</div>
                    ) : null}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {formatDateTime(alert.detectedAt)}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* -------------------------------------------------------------
          Section B — Monitoring status
      ------------------------------------------------------------- */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900">Monitoring status</h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Engine &amp; delivery channels
          </span>
        </div>

        {overviewError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5">
            <p className="text-xs sm:text-[13px] text-rose-800">
              <strong className="font-bold">Could not load monitoring status:</strong>{' '}
              {overviewError}
            </p>
            <button
              type="button"
              onClick={() => void loadOverview()}
              className="mt-2 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-[11px] font-bold flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Try again</span>
            </button>
          </div>
        )}

        {overviewLoading && (
          <p className="text-xs sm:text-[13px] text-slate-500 flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
            <span>Loading monitoring status…</span>
          </p>
        )}

        {!overviewLoading && overview && overview.members.length === 0 && (
          <p className="text-xs sm:text-[13px] text-slate-500">
            This member is not currently monitored.
          </p>
        )}

        {overview?.members.map((member) => {
          const hr = member.heartRate;
          return (
            <div
              key={member.memberId}
              className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-slate-900">{member.memberName}</div>
                  <div className="text-[11px] text-slate-500">{member.relationship}</div>
                </div>
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                    member.openAlerts > 0
                      ? 'bg-rose-50 text-rose-700 border border-rose-200/80'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                  }`}
                >
                  <Bell className="w-3 h-3" />
                  <span>
                    {member.openAlerts} open alert{member.openAlerts === 1 ? '' : 's'}
                  </span>
                </span>
              </div>

              {/* Heart rate analysis */}
              {hr ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="rounded-xl bg-white border border-slate-200 p-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Baseline
                      </div>
                      <div className="text-sm font-extrabold text-slate-900 tabular-nums">
                        {hr.baseline} bpm
                      </div>
                    </div>
                    <div className="rounded-xl bg-white border border-slate-200 p-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Latest
                      </div>
                      <div className="text-sm font-extrabold text-slate-900 tabular-nums">
                        {hr.latest} bpm
                      </div>
                    </div>
                    <div className="rounded-xl bg-white border border-slate-200 p-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Samples in window
                      </div>
                      <div className="text-sm font-extrabold text-slate-900 tabular-nums">
                        {hr.samplesInWindow}
                      </div>
                    </div>
                    <div className="rounded-xl bg-white border border-slate-200 p-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Likely exercise
                      </div>
                      <div className="text-sm font-extrabold text-slate-900">
                        {hr.likelyExercise ? 'Yes' : 'No'}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${CLASSIFICATION_BADGE[hr.classification]}`}
                    >
                      <HeartPulse className="w-3 h-3" />
                      <span>{CLASSIFICATION_LABELS[hr.classification]}</span>
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Last reading {formatDateTime(hr.latestAt)}
                    </span>
                  </div>

                  <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">
                    {hr.rationale}
                  </p>

                  <p className="text-[11px] text-slate-400">
                    {hr.sustained
                      ? 'The abnormal reading was sustained across the window.'
                      : 'The reading was not sustained long enough to raise an alert.'}{' '}
                    {hr.stepsLast30Min} steps recorded in the last 30 minutes.
                  </p>
                </div>
              ) : (
                <p className="text-xs sm:text-[13px] text-slate-500">
                  No recent heart-rate reading is available for this member, so the engine has
                  no baseline to compare against.
                </p>
              )}

              {/* Caregivers and devices */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="rounded-xl bg-white border border-slate-200 p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Linked caregivers</span>
                  </div>
                  {member.caregivers.length === 0 ? (
                    <p className="text-[11px] text-slate-500">
                      No caregiver is linked. Escalations fall back to the account owner.
                    </p>
                  ) : (
                    member.caregivers.map((caregiver) => (
                      <div key={caregiver.name} className="text-[11px] text-slate-600">
                        <span className="font-bold text-slate-800">{caregiver.name}</span>
                        <span> · {caregiver.relation} · {caregiver.permission}</span>
                        <div className="text-[10px] text-slate-400">
                          Channels: {caregiver.channels.join(', ')}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="rounded-xl bg-white border border-slate-200 p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Connected devices</span>
                  </div>
                  {member.devices.length === 0 ? (
                    <p className="text-[11px] text-slate-500">
                      No device is connected. Readings have to be entered manually.
                    </p>
                  ) : (
                    member.devices.map((device) => (
                      <div key={device.id} className="text-[11px] text-slate-600">
                        <span className="font-bold text-slate-800">{device.displayName}</span>
                        <span> · {device.status}</span>
                        <div className="text-[10px] text-slate-400">
                          {device.provider}
                          {device.lastSyncAt ? ` · synced ${formatDateTime(device.lastSyncAt)}` : ''}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Push delivery status */}
        {overview && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5" />
              <span>Delivery channels</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                  overview.push.inApp
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                    : 'bg-slate-100 text-slate-500 border border-slate-200'
                }`}
              >
                In-app inbox: {overview.push.inApp ? 'on' : 'off'}
              </span>
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                  overview.push.fcm
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                    : 'bg-amber-50 text-amber-800 border border-amber-200/80'
                }`}
              >
                FCM push: {overview.push.fcm ? 'configured' : 'not configured'}
              </span>
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                  overview.push.sms
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                    : 'bg-slate-100 text-slate-500 border border-slate-200'
                }`}
              >
                SMS: {overview.push.sms ? 'configured' : 'not configured'}
              </span>
            </div>
            <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">
              {overview.push.note}
            </p>
            {!overview.push.fcm && (
              <p className="text-xs sm:text-[13px] text-amber-800 leading-relaxed">
                <strong className="font-bold">Honest limitation:</strong> FCM is not
                configured on this deployment, so alerts land in the in-app inbox only. They
                will not arrive on a phone as a push notification until FCM credentials are
                provided, and the SMS channel is not wired to a gateway either — an SMS
                escalation step is recorded as attempted, not delivered.
              </p>
            )}
          </div>
        )}

        {/* Scheduler status */}
        {overview && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-600" />
              <div>
                <div className="text-xs font-bold text-slate-900">
                  Escalation scheduler{' '}
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ml-1 ${
                      overview.scheduler.running
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    {overview.scheduler.running ? 'Running' : 'Stopped'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Ticks every {Math.round(overview.scheduler.tickMs / 1000)}s ·{' '}
                  {overview.scheduler.ticks} tick
                  {overview.scheduler.ticks === 1 ? '' : 's'} so far ·{' '}
                  {overview.scheduler.enabled ? 'Enabled' : 'Disabled'}
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              The scheduler is what moves an unacknowledged alert up the escalation ladder.
            </p>
          </div>
        )}
      </section>

      {/* -------------------------------------------------------------
          Section C — Test the alerting path
      ------------------------------------------------------------- */}
      <section className="rounded-3xl border border-amber-200 bg-amber-50/40 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200/70 pb-3">
          <div className="flex items-center gap-2">
            <Siren className="w-4 h-4 text-amber-600" />
            <h2 className="text-sm font-bold text-slate-900">Test the alerting path</h2>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md">
            Demo / testing panel — not a real emergency
          </span>
        </div>

        <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">
          These buttons exercise exactly the same server path the watch app uses, so the
          escalation ladder can be demonstrated without a physical device. They raise test
          records for {currentMember.name} only. <strong className="font-bold">No emergency
          service is contacted and no real person is contacted</strong> — if someone is in
          genuine danger, call the local emergency number.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <button
            type="button"
            onClick={() => void handleSimulate('fall')}
            disabled={simulating !== null}
            className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {simulating === 'fall' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Siren className="w-3.5 h-3.5" />
            )}
            <span>Simulate a fall event</span>
          </button>

          <button
            type="button"
            onClick={() => void handleSimulate('heart_rate')}
            disabled={simulating !== null}
            className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {simulating === 'heart_rate' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <HeartPulse className="w-3.5 h-3.5" />
            )}
            <span>Abnormal heart rate (148 bpm)</span>
          </button>

          <button
            type="button"
            onClick={() => void handleSimulate('manual')}
            disabled={simulating !== null}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {simulating === 'manual' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Bell className="w-3.5 h-3.5" />
            )}
            <span>Raise a manual alert</span>
          </button>
        </div>

        {simMessage && (
          <p className="text-xs sm:text-[13px] text-slate-700 bg-white border border-amber-200 rounded-xl px-3.5 py-2.5 leading-relaxed">
            {simMessage}
          </p>
        )}

        {simError && (
          <p className="text-xs sm:text-[13px] text-rose-700 font-semibold">{simError}</p>
        )}
      </section>

      {/* Always-on explanation of how a real alert reaches a caregiver */}
      <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5">
        <div className="flex items-start gap-3">
          <Phone className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <h3 className="text-sm font-bold text-slate-900">
              How a real fall reaches a caregiver
            </h3>
            <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">
              In a real deployment the fall event does not come from this screen. A watch app
              on the wearer&apos;s wrist detects the impact pattern, sends the event to the
              monitoring engine together with the current position, and the engine raises the
              alert you see above.
            </p>
            <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">
              The escalation ladder is <strong className="font-bold">confirmation-first</strong>.
              The person wearing the device is asked to cancel the alert, because most
              detected falls are not accidents. Only an alert that is left
              unacknowledged keeps climbing: first the in-app inbox, then the linked
              caregivers, then SMS, and finally a fail-safe notice telling the account owner
              to contact local emergency services. Acknowledging an alert stops the ladder
              immediately.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
