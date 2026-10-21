import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronRight,
  Copy,
  FlaskConical,
  HelpCircle,
  RefreshCw,
  Table2,
} from 'lucide-react';
import { api } from '../api';
import {
  ComparisonDirection,
  ComparisonResponse,
  ComparisonSignificance,
  FamilyMember,
  ReportOption,
  ValueChange,
  ValueSide,
} from '../types';

interface ReportCompareViewProps {
  familyMembers: FamilyMember[];
  activeMember: FamilyMember | null;
  onSelectMember: (member: FamilyMember) => void;
}

const SIGNIFICANCE_BADGE: Record<ComparisonSignificance, string> = {
  moved_out_of_range: 'bg-rose-50 text-rose-700 border border-rose-200/80',
  moved_into_range: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80',
  notable_change: 'bg-amber-50 text-amber-800 border border-amber-200/80',
  minor_change: 'bg-slate-100 text-slate-700 border border-slate-200',
  stable: 'bg-slate-100 text-slate-700 border border-slate-200',
  not_comparable: 'bg-slate-100 text-slate-500 border border-slate-200',
};

const SIGNIFICANCE_LABEL: Record<ComparisonSignificance, string> = {
  moved_out_of_range: 'Moved out of range',
  moved_into_range: 'Back in range',
  notable_change: 'Notable change',
  minor_change: 'Small change',
  stable: 'Stable',
  not_comparable: 'Not comparable',
};

const DIRECTION_ARROW: Record<ComparisonDirection, string> = {
  increased: '↑',
  decreased: '↓',
  unchanged: '→',
  not_comparable: '→',
};

const DIRECTION_WORD: Record<ComparisonDirection, string> = {
  increased: 'Increased',
  decreased: 'Decreased',
  unchanged: 'Unchanged',
  not_comparable: 'Not comparable',
};

const FALLBACK_DISCLAIMER =
  'This screen only describes how two stored reports differ. It does not diagnose anything and it does not interpret what a change means. Please take the reports to your doctor.';

const MONTH_LABELS = [
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

/** Report dates are stored as plain calendar days, so they are formatted
 *  without a timezone shift instead of going through `new Date`. */
function formatDate(value?: string): string {
  if (!value) return '—';
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    const year = iso[1];
    const month = Number(iso[2]);
    const day = iso[3];
    return `${day} ${MONTH_LABELS[month - 1] ?? iso[2]} ${year}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(parsed);
}

function formatSigned(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? `+${rounded}%` : `${rounded}%`;
}

function RangeTag({ inRange }: { inRange?: boolean }) {
  if (inRange === true) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200/80">
        In range
      </span>
    );
  }
  if (inRange === false) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200/80">
        Out of range
      </span>
    );
  }
  return null;
}

function ValueCell({ side, showRange }: { side: ValueSide; showRange?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono font-bold text-slate-900 tabular-nums">{side.raw}</span>
        {side.unit ? (
          <span className="text-[10px] font-bold text-slate-500">{side.unit}</span>
        ) : null}
        <RangeTag inRange={side.inRange} />
      </div>
      <div className="text-[10px] text-slate-400 tabular-nums">{formatDate(side.date)}</div>
      {showRange && side.rangeText ? (
        <div className="text-[10px] text-slate-400 font-mono">Ref: {side.rangeText}</div>
      ) : null}
    </div>
  );
}

function ChangeCell({ change }: { change: ValueChange }) {
  const isUnchanged = change.direction === 'unchanged';
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span aria-hidden="true" className="text-sm font-bold leading-none text-slate-600">
          {DIRECTION_ARROW[change.direction]}
        </span>
        <span className="sr-only">{DIRECTION_WORD[change.direction]}</span>
        {isUnchanged || change.absoluteChange === undefined ? (
          <span className="text-xs font-bold text-slate-400">—</span>
        ) : (
          <>
            <span className="text-xs font-bold text-slate-800 tabular-nums">
              {formatSigned(change.absoluteChange)}
            </span>
            {change.unit ? (
              <span className="text-[10px] font-bold text-slate-400">{change.unit}</span>
            ) : null}
          </>
        )}
      </div>
      {!isUnchanged && change.percentChange !== undefined ? (
        <div className="text-[11px] font-semibold text-slate-500 tabular-nums">
          {formatPercent(change.percentChange)}
        </div>
      ) : null}
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {DIRECTION_WORD[change.direction]}
      </div>
    </div>
  );
}

export const ReportCompareView: React.FC<ReportCompareViewProps> = ({
  familyMembers,
  activeMember,
  onSelectMember,
}) => {
  const currentMember = activeMember || familyMembers[0] || null;
  const memberId = currentMember ? currentMember.id : null;

  const [response, setResponse] = useState<ComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [olderId, setOlderId] = useState('');
  const [latestId, setLatestId] = useState('');
  const [copied, setCopied] = useState(false);

  const loadComparison = useCallback(
    async (params: { olderId?: string; latestId?: string }) => {
      if (!memberId) return;
      setLoading(true);
      setLoadError(null);
      try {
        const result = await api.compareReports({
          memberId,
          olderId: params.olderId,
          latestId: params.latestId,
        });
        setResponse(result);
        // Keep the pickers in step with the pair the server actually used.
        if (result.older?.id) setOlderId(result.older.id);
        if (result.latest?.id) setLatestId(result.latest.id);
      } catch (err) {
        setLoadError(
          err instanceof Error
            ? err.message
            : 'The comparison could not be loaded right now.'
        );
      } finally {
        setLoading(false);
      }
    },
    [memberId]
  );

  useEffect(() => {
    setResponse(null);
    setLoadError(null);
    setOlderId('');
    setLatestId('');
    setCopied(false);
    if (!memberId) {
      setLoading(false);
      return;
    }
    // No ids on the first load, so the server picks the pair it considers
    // the right default for this member.
    void loadComparison({});
  }, [memberId, loadComparison]);

  const handleOlderChange = (id: string) => {
    const reports = response?.availableReports ?? [];
    const newestId = reports.length > 0 ? reports[0].id : '';
    // The server only honours an explicit pair, so the later side is filled
    // with the most recent stored report when it has not been chosen yet.
    const nextLatest = latestId || newestId;
    setOlderId(id);
    if (nextLatest) setLatestId(nextLatest);
    void loadComparison({ olderId: id, latestId: nextLatest || undefined });
  };

  const handleLatestChange = (id: string) => {
    setLatestId(id);
    void loadComparison({ olderId: olderId || undefined, latestId: id });
  };

  const handleCopyQuestions = async () => {
    const list = response?.questions ?? [];
    if (list.length === 0) return;
    const text = list.map((question, index) => `${index + 1}. ${question}`).join('\n');
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  if (!currentMember) {
    return (
      <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-8 text-center animate-in fade-in duration-200">
        <FlaskConical className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm font-bold text-slate-800">No family member selected</p>
        <p className="text-xs sm:text-[13px] text-slate-600 mt-1">
          Add a family member to compare their stored reports.
        </p>
      </div>
    );
  }

  const availableReports: ReportOption[] = response?.availableReports ?? [];
  const changes: ValueChange[] = response?.changes ?? [];
  const skipped = response?.skipped ?? [];
  const questions = response?.questions ?? [];
  const older = response?.older;
  const latest = response?.latest;
  const isComparable = response ? response.comparable : false;
  const disclaimer = response?.disclaimer || FALLBACK_DISCLAIMER;

  return (
    <div className="space-y-6 animate-in fade-in duration-200 pb-16">
      {/* Header card */}
      <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md mb-1">
            <Table2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Report to report</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Compare reports
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Pick two stored reports for {currentMember.name} and see which test values moved
            between them. This screen only describes the movement — nothing here interprets it.
          </p>
        </div>

        {/* Family member context selector */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Context
          </span>
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

      {/* Report pickers */}
      <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900">Choose the two reports</h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {availableReports.length} stored report{availableReports.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="compare-earlier-report"
              className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1"
            >
              Earlier report
            </label>
            <select
              id="compare-earlier-report"
              value={olderId}
              onChange={(e) => handleOlderChange(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
            >
              <option value="">Choose an earlier report…</option>
              {availableReports.map((report) => (
                <option key={report.id} value={report.id}>
                  {report.date} — {report.reportType}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="compare-later-report"
              className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1"
            >
              Later report
            </label>
            <select
              id="compare-later-report"
              value={latestId}
              onChange={(e) => handleLatestChange(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-hidden"
            >
              <option value="">Choose a later report…</option>
              {availableReports.map((report) => (
                <option key={report.id} value={report.id}>
                  {report.date} — {report.reportType}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* The two dates, spelled out */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              <CalendarDays className="w-3.5 h-3.5" />
              <span>Earlier report</span>
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5">
              {older ? formatDate(older.date) : 'Not selected yet'}
            </div>
            <div className="text-[11px] text-slate-500">
              {older ? `${older.reportType} · ${older.title}` : 'Pick one of the stored reports above.'}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              <CalendarDays className="w-3.5 h-3.5" />
              <span>Later report</span>
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5">
              {latest ? formatDate(latest.date) : 'Not selected yet'}
            </div>
            <div className="text-[11px] text-slate-500">
              {latest ? `${latest.reportType} · ${latest.title}` : 'Pick one of the stored reports above.'}
            </div>
          </div>
        </div>
      </section>

      {/* Inline error */}
      {loadError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-xs sm:text-[13px] text-rose-800">
            <strong className="font-bold">Could not load the comparison:</strong> {loadError}
          </p>
          <button
            type="button"
            onClick={() =>
              void loadComparison({
                olderId: olderId || undefined,
                latestId: latestId || undefined,
              })
            }
            className="mt-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Try again</span>
          </button>
        </div>
      )}

      {loading && (
        <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-8 text-center">
          <RefreshCw className="w-5 h-5 text-emerald-600 animate-spin mx-auto mb-2" />
          <p className="text-xs sm:text-[13px] text-slate-500">
            Loading the stored reports for {currentMember.name}…
          </p>
        </div>
      )}

      {!loading && !loadError && response && !isComparable && (
        <section className="rounded-3xl border border-amber-200 bg-amber-50/50 p-5 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-amber-900">
                There is nothing to compare for {currentMember.name} yet
              </h2>
              <p className="text-xs sm:text-[13px] text-amber-800 leading-relaxed mt-0.5">
                {response.reason ||
                  'Two reports are needed before any value can be compared.'}
              </p>
            </div>
          </div>

          {availableReports.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">
                Reports stored for {currentMember.name}
              </div>
              <ul className="space-y-1.5">
                {availableReports.map((report) => (
                  <li
                    key={report.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white border border-amber-200/80 px-3 py-2"
                  >
                    <span className="text-xs font-bold text-slate-800">{report.reportType}</span>
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      {report.date}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs sm:text-[13px] text-amber-800 leading-relaxed">
              No reports are stored for {currentMember.name} yet. Upload one in{' '}
              <strong className="font-bold">Report Analysis</strong> and it will appear here
              to compare.
            </p>
          )}
        </section>
      )}

      {!loading && !loadError && response && isComparable && (
        <>
          {/* Summary */}
          <section className="rounded-3xl border border-emerald-200/90 bg-emerald-50/40 p-5 space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
              <Table2 className="w-3.5 h-3.5" />
              <span>What moved between the two reports</span>
            </div>
            <p className="text-sm sm:text-[15px] font-semibold text-slate-900 leading-relaxed">
              {response.summary}
            </p>
          </section>

          {/* Comparison table */}
          <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Table2 className="w-4 h-4 text-emerald-600" />
                <h2 className="text-sm font-bold text-slate-900">Value-by-value comparison</h2>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {changes.length} test{changes.length === 1 ? '' : 's'} compared
              </span>
            </div>

            {changes.length === 0 ? (
              <p className="px-5 py-6 text-xs sm:text-[13px] text-slate-500">
                The two reports share no test that could be compared.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[780px]">
                  <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-5">Test</th>
                      <th className="py-3 px-4">
                        Earlier
                        {older ? (
                          <span className="block text-[10px] font-normal text-slate-400 tabular-nums">
                            {formatDate(older.date)}
                          </span>
                        ) : null}
                      </th>
                      <th className="py-3 px-4">
                        Later
                        {latest ? (
                          <span className="block text-[10px] font-normal text-slate-400 tabular-nums">
                            {formatDate(latest.date)}
                          </span>
                        ) : null}
                      </th>
                      <th className="py-3 px-4">Change</th>
                      <th className="py-3 px-5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {changes.map((change) => (
                      <tr key={change.testName} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-5 align-top">
                          <div className="text-xs font-bold text-slate-800">{change.testName}</div>
                          {change.note ? (
                            <p
                              className={`text-[11px] leading-relaxed mt-1 max-w-xs ${
                                change.rangeChanged ? 'text-amber-700' : 'text-slate-400'
                              }`}
                            >
                              {change.note}
                            </p>
                          ) : null}
                        </td>
                        <td className="py-3 px-4 align-top">
                          <ValueCell side={change.previous} />
                        </td>
                        <td className="py-3 px-4 align-top">
                          <ValueCell side={change.latest} showRange />
                        </td>
                        <td className="py-3 px-4 align-top">
                          <ChangeCell change={change} />
                        </td>
                        <td className="py-3 px-5 align-top">
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${SIGNIFICANCE_BADGE[change.significance]}`}
                          >
                            {SIGNIFICANCE_LABEL[change.significance]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Tests that were deliberately not compared */}
            {skipped.length > 0 && (
              <div className="border-t border-slate-100 p-4 space-y-2">
                <details className="rounded-2xl border border-slate-200 bg-slate-50/60">
                  <summary className="px-4 py-3 text-[11px] font-bold text-slate-600 cursor-pointer select-none flex items-center gap-1.5">
                    <ChevronRight className="w-3.5 h-3.5" />
                    <span>
                      {skipped.length} test{skipped.length === 1 ? '' : 's'} not compared
                    </span>
                  </summary>
                  <div className="px-4 pb-4 space-y-2">
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      These tests are listed rather than quietly dropped, so it is clear what was
                      left out of the comparison and why.
                    </p>
                    {skipped.map((entry, index) => (
                      <div
                        key={`${entry.testName}-${index}`}
                        className="rounded-xl border border-slate-200 bg-white p-3"
                      >
                        <div className="text-xs font-bold text-slate-800">{entry.testName}</div>
                        <div className="text-[11px] text-slate-500 leading-relaxed mt-0.5">
                          {entry.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </section>

          {/* Questions for the doctor */}
          <section className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-emerald-600" />
                <h2 className="text-sm font-bold text-slate-900">
                  Questions to take to the doctor
                </h2>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyQuestions()}
                disabled={questions.length === 0}
                className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copied ? 'Copied' : 'Copy all'}</span>
              </button>
            </div>

            {questions.length === 0 ? (
              <p className="text-xs sm:text-[13px] text-slate-500">
                No questions were generated for this pair of reports.
              </p>
            ) : (
              <ol className="space-y-2">
                {questions.map((question, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2.5 rounded-2xl bg-slate-50 border border-slate-100 p-3"
                  >
                    <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                      {index + 1}
                    </span>
                    <span className="text-xs sm:text-[13px] text-slate-700 leading-relaxed">
                      {question}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}

      {/* Disclaimer — always visible */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-slate-500 leading-relaxed">
          <strong className="font-bold">Disclaimer:</strong> {disclaimer}
        </p>
      </div>
    </div>
  );
};
