import React, { useCallback, useEffect, useState } from 'react';
import {
  Network,
  Bot,
  CircleCheck,
  CircleDashed,
  CircleAlert,
  ExternalLink,
  RefreshCw,
  Cpu,
  KeyRound,
  Store,
  Terminal,
  Copy,
  Check,
  Link2,
  Database,
} from 'lucide-react';
import { api } from '../api';
import { ProviderStatus } from '../types';

interface AgentNetworkViewProps {
  onNavigate?: (view: string) => void;
}

type CheckState = 'done' | 'todo' | 'warn';

interface ChecklistItem {
  label: string;
  detail: string;
  state: CheckState;
}

export const AgentNetworkView: React.FC<AgentNetworkViewProps> = ({ onNavigate }) => {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getProviderStatus();
      setStatus(data);
    } catch (err: any) {
      setError(err?.message || 'Could not read the agent status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copyAddress = async () => {
    if (!status?.agent.address) return;
    try {
      await navigator.clipboard.writeText(status.agent.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-8 text-center text-sm text-slate-500">
        <RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin text-emerald-600" />
        Reading the agent status...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <p className="text-xs text-rose-700">{error}</p>
        <button
          onClick={load}
          className="mt-3 px-4 py-2 bg-white border border-rose-200 text-rose-700 rounded-xl text-xs font-bold"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!status) return null;

  const checklist: ChecklistItem[] = [
    {
      label: 'Model backend configured',
      detail: status.configured
        ? `Running on ${status.label} (${status.model}).`
        : 'No provider key is set, so AI features are disabled.',
      state: status.configured ? 'done' : 'warn',
    },
    {
      label: 'ASI:One (Fetch.ai) reachable',
      detail: status.asiOne.configured
        ? `An ASI:One key is present. The agent talks to ${status.asiOne.baseUrl}.`
        : 'Add ASI1_API_KEY to .env to route the agent through ASI:One.',
      state: status.asiOne.configured ? 'done' : 'todo',
    },
    {
      label: 'Agent has a fixed address',
      detail: status.agent.address
        ? `Registered as ${status.agent.address}.`
        : 'Set HEALTHYFY_AGENT_SEED so the uAgent keeps the same address across restarts.',
      state: status.agent.address ? 'done' : 'todo',
    },
    {
      label: 'Published on Agentverse',
      detail: status.agent.registered
        ? 'The agent manifest is published, so ASI:One can discover and route to it.'
        : 'Run the uAgent with a mailbox and an Agentverse token to publish its manifest.',
      state: status.agent.registered ? 'done' : 'todo',
    },
    {
      label: 'Chat Protocol implemented',
      detail:
        'The uAgent implements the Agent Chat Protocol, so it can be messaged from ASI:One Chat or from another agent.',
      state: 'done',
    },
    {
      label: 'Tool execution',
      detail:
        'The agent reads reports, medications, adherence, vitals and safety checks through the Healthyfy API, and can raise alerts.',
      state: 'done',
    },
  ];

  const stateIcon = (state: CheckState) => {
    if (state === 'done') return <CircleCheck className="w-4 h-4 text-emerald-500 shrink-0" />;
    if (state === 'warn') return <CircleAlert className="w-4 h-4 text-amber-500 shrink-0" />;
    return <CircleDashed className="w-4 h-4 text-slate-300 shrink-0" />;
  };

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Header */}
      <div className="rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 p-6 text-white shadow-2xs">
        <div className="flex items-center gap-2 mb-2">
          <Network className="w-4 h-4 text-emerald-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">
            Agent network
          </span>
        </div>
        <h2 className="text-lg sm:text-xl font-bold tracking-tight">Healthyfy on Agentverse</h2>
        <p className="text-xs sm:text-[13px] text-slate-300 mt-1.5 max-w-2xl leading-relaxed">
          Healthyfy is a personal and family health agent. It reads the family's real medical
          records, medication history and monitoring data, then answers questions about them
          and takes action when the family approves it. Published to Agentverse, it becomes
          callable by other agents and discoverable by ASI:One.
        </p>
      </div>

      {/* Model backend */}
      <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5">
        <div className="flex items-center gap-2 mb-3">
          <Cpu className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-900">Model backend</h3>
        </div>

        <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
          Each job uses the model that is strongest for it, with a fallback so a single
          provider outage never takes the app down.
        </p>

        <div className="space-y-2">
          {[
            {
              key: 'app',
              label: 'App features',
              detail: 'Report analysis, chat with tools, briefing narrative',
            },
            {
              key: 'vision',
              label: 'Document reading',
              detail: 'Prescription photos, scanned lab reports',
            },
            {
              key: 'agent',
              label: 'The uAgent',
              detail: status.agent.live.reachable
                ? `Running as a separate service${
                    status.agent.live.asi1Configured
                      ? ', reasoning on ASI:One'
                      : ', ASI:One key not set yet'
                  }`
                : 'The agent service is not running on port 8000',
            },
          ].map((role) => {
            const registry = status.roles[role.key as keyof typeof status.roles];
            // The uAgent runs as a separate service, so its row shows the
            // live status that service reports rather than this server's
            // own provider registry.
            const isAgent = role.key === 'agent';
            const label = isAgent
              ? status.agent.live.reachable
                ? status.agent.live.asi1Configured
                  ? 'ASI:One (live)'
                  : 'ASI:One key missing'
                : 'not running'
              : '';
            const configured = isAgent
              ? Boolean(status.agent.live.reachable && status.agent.live.asi1Configured)
              : registry.configured;
            const displayLabel = isAgent ? label : registry.label;

            return (
              <div
                key={role.key}
                className="rounded-2xl bg-slate-50 border border-slate-200/70 p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-800">{role.label}</p>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                      configured
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {displayLabel}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">{role.detail}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 border border-slate-200/70 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Active model
            </p>
            <p className="text-xs font-bold text-slate-800 mt-1 font-mono break-all">
              {status.model}
            </p>
            {status.fallbackModel && (
              <p className="text-[10px] text-slate-500 mt-0.5 font-mono break-all">
                fallback: {status.fallbackModel}
              </p>
            )}
          </div>
          <div className="rounded-2xl bg-slate-50 border border-slate-200/70 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Fallback chain
            </p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {status.chain.map((p, i) => (
                <span
                  key={p.id}
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                    p.configured
                      ? i === 0
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-200 text-slate-600'
                      : 'bg-slate-100 text-slate-300 line-through'
                  }`}
                >
                  {p.id}
                </span>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">
              {status.geminiConfigured ? 'Gemini key present' : 'No Gemini key'}
              {status.asiOneConfigured ? ' · ASI:One key present' : ' · no ASI:One key'}
            </p>
          </div>
        </div>
      </div>

      {/* Free data sources */}
      <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5">
        <div className="flex items-center gap-2 mb-3">
          <Database className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-900">Free data sources</h3>
        </div>

        <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
          These are public government APIs. They need no key, no account and no credit card,
          and they are what the clinical features are grounded in.
        </p>

        <div className="space-y-2">
          {[
            {
              key: 'openfda',
              name: 'openFDA drug labels',
              detail: status.freeData.openfda.note,
              href: 'https://open.fda.gov/apis/drug/label/',
            },
            {
              key: 'pubmed',
              name: 'PubMed E-utilities',
              detail: status.freeData.pubmed.note,
              href: 'https://www.ncbi.nlm.nih.gov/books/NBK25501/',
            },
            {
              key: 'rxnorm',
              name: 'NIH RxNorm',
              detail: status.freeData.rxnorm.note,
              href: 'https://www.nlm.nih.gov/research/umls/rxnorm/',
            },
          ].map((source) => {
            const info = status.freeData[source.key as keyof typeof status.freeData];
            return (
              <a
                key={source.key}
                href={source.href}
                target="_blank"
                rel="noreferrer"
                className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50 px-3.5 py-3 hover:bg-slate-100"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-slate-800">{source.name}</p>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700">
                      {info.requiresKey ? 'key needed' : 'no key'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                    {info.note}
                  </p>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
              </a>
            );
          })}
        </div>
      </div>

      {/* Agent identity */}
      <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5">
        <div className="flex items-center gap-2 mb-3">
          <Bot className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-900">Agent identity</h3>
        </div>

        {status.agent.address ? (
          <>
            <div className="rounded-2xl bg-slate-50 border border-slate-200/70 p-3.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Agent address
              </p>
              <div className="flex items-start gap-2 mt-1.5">
                <p className="text-[11px] font-mono text-slate-700 break-all flex-1">
                  {status.agent.address}
                </p>
                <button
                  onClick={copyAddress}
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {status.agent.agentverseUrl && (
              <a
                href={status.agent.agentverseUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold"
              >
                <Store className="w-3.5 h-3.5" />
                View on Agentverse
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </>
        ) : (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
            <p className="text-xs font-bold text-amber-900">The agent is not registered yet</p>
            <p className="text-[11px] text-amber-800/80 mt-1 leading-relaxed">
              Run the uAgent service and it will log its address. Copy that address into{' '}
              <code className="font-mono">HEALTHYFY_AGENT_ADDRESS</code> in the backend{' '}
              <code className="font-mono">.env</code> and restart to link it here.
            </p>
            <div className="mt-3 rounded-xl bg-white/70 border border-amber-200 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 mb-1.5">
                Run it
              </p>
              <code className="text-[10px] font-mono text-slate-700 block break-all">
                cd services/healthyfy-agent && python -m uagents run agent.py
              </code>
            </div>
          </div>
        )}
      </div>

      {/* Submission checklist */}
      <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5">
        <div className="flex items-center gap-2 mb-3">
          <Link2 className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-900">Submission readiness</h3>
        </div>

        <div className="space-y-2.5">
          {checklist.map((item) => (
            <div key={item.label} className="flex items-start gap-2.5">
              <div className="mt-0.5">{stateIcon(item.state)}</div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-800">{item.label}</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Links */}
      <div className="rounded-3xl border border-slate-200/90 shadow-2xs bg-white p-5">
        <div className="flex items-center gap-2 mb-3">
          <KeyRound className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-900">What you still need</h3>
        </div>

        <div className="space-y-2">
          <a
            href={status.asiOne.signupUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50 px-3.5 py-3 hover:bg-slate-100"
          >
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-800">ASI:One API key</p>
              <p className="text-[10px] text-slate-500">
                Create one and set <code className="font-mono">ASI1_API_KEY</code> in the backend
                .env
              </p>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </a>

          <a
            href={status.asiOne.agentverseUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50 px-3.5 py-3 hover:bg-slate-100"
          >
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-800">Agentverse account</p>
              <p className="text-[10px] text-slate-500">
                Needed for the mailbox and to publish the agent manifest
              </p>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </a>

          <a
            href={status.asiOne.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50 px-3.5 py-3 hover:bg-slate-100"
          >
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-800">ASI:One documentation</p>
              <p className="text-[10px] text-slate-500">
                Planner mode, tool calling and agent discovery
              </p>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </a>
        </div>

        {onNavigate && (
          <button
            onClick={() => onNavigate('assistant')}
            className="mt-4 w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold"
          >
            <Terminal className="w-3.5 h-3.5" />
            Try the assistant with tool calls
          </button>
        )}
      </div>
    </div>
  );
};
