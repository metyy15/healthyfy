import React from 'react';
import {
  LayoutDashboard,
  FileText,
  Users,
  Stethoscope,
  Activity,
  Salad,
  Bot,
  Settings,
  Sparkles,
  ShieldCheck,
  Info,
  X,
  Pill,
  ScanLine,
  Siren,
  HeartPulse,
  SunMedium,
  Network,
  GitCompareArrows,
  ClipboardList,
} from 'lucide-react';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string) => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  highlight?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  isMobileOpen = false,
  onCloseMobile,
}) => {
  const navGroups: NavGroup[] = [
    {
      title: 'Health',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'reports', label: 'Report Analysis', icon: FileText, highlight: 'AI' },
        { id: 'compare', label: 'Compare Reports', icon: GitCompareArrows, highlight: 'New' },
        { id: 'followup', label: 'Follow-ups', icon: ClipboardList, highlight: 'New' },
        { id: 'family', label: 'Family Health', icon: Users },
        { id: 'doctors', label: 'Find a Doctor', icon: Stethoscope },
        { id: 'fitness', label: 'Fitness Tracking', icon: Activity },
        { id: 'diet', label: 'AI Diet Planner', icon: Salad, highlight: 'AI' },
      ],
    },
    {
      title: 'Care & Safety',
      items: [
        { id: 'briefing', label: 'Daily Briefing', icon: SunMedium, highlight: 'New' },
        { id: 'medications', label: 'Medications', icon: Pill },
        { id: 'prescription', label: 'Prescription Reader', icon: ScanLine, highlight: 'AI' },
        { id: 'safety', label: 'Safety Ledger', icon: ShieldCheck },
        { id: 'alerts', label: 'Alerts & Monitoring', icon: Siren },
        { id: 'careplan', label: 'Care Plan', icon: HeartPulse },
      ],
    },
    {
      title: 'Assistant',
      items: [
        { id: 'assistant', label: 'Healthyfy AI', icon: Bot, highlight: 'Gemini' },
        { id: 'agentnetwork', label: 'Agent Network', icon: Network, highlight: 'Fetch.ai' },
        { id: 'settings', label: 'Settings', icon: Settings },
      ],
    },
  ];

  const handleSelect = (view: string) => {
    onNavigate(view);
    if (onCloseMobile) onCloseMobile();
  };

  const content = (
    <div className="flex flex-col h-full justify-between py-5 px-3">
      {/* Top Section */}
      <div className="space-y-5">
        {/* Mobile Header Close */}
        <div className="md:hidden flex items-center justify-between px-2 pb-2 border-b border-slate-200">
          <span className="text-sm font-bold text-slate-800">Healthyfy Navigation</span>
          <button
            onClick={onCloseMobile}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="space-y-5">
          {navGroups.map((group) => (
            <div key={group.title}>
              <p className="px-3.5 mb-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                {group.title}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentView === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item.id)}
                      className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                        isActive
                          ? 'bg-emerald-600 text-white shadow-xs shadow-emerald-600/30'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                        <span>{item.label}</span>
                      </div>
                      {item.highlight && (
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                            isActive
                              ? 'bg-white/20 text-white'
                              : item.highlight === 'New'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {item.highlight}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Bottom Section: AI Engine Info & Medical Disclaimer */}
      <div className="space-y-3 pt-4 border-t border-slate-200/80 px-1">
        <button
          onClick={() => handleSelect('landing')}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
            currentView === 'landing' ? 'bg-slate-200 text-slate-900' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
          }`}
        >
          <Info className="w-3.5 h-3.5 text-slate-400" />
          <span>Product Tour / Demo</span>
        </button>

        <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 mb-1">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            <span>Powered by Gemini 3.8</span>
          </div>
          <p className="text-[10px] text-slate-500 leading-normal">
            Server-side reasoning, clinical summaries & diet insights.
          </p>
        </div>

        <div className="flex items-start gap-1.5 px-1 text-[10px] text-slate-400 leading-tight">
          <ShieldCheck className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
          <span>Informational health assistant. Not medical advice.</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:block w-64 shrink-0 bg-white border-r border-slate-200/80 h-[calc(100vh-53px)] sticky top-[53px]">
        {content}
      </aside>

      {/* Mobile Drawer */}
      {isMobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <div className="relative w-72 max-w-[85vw] bg-white h-full shadow-2xl z-10 animate-in slide-in-from-left duration-200">
            {content}
          </div>
        </div>
      )}
    </>
  );
};
