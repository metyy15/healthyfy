import React, { useState, useEffect } from 'react';
import { api, getAuthToken, setAuthToken, removeAuthToken } from './api';
import { User, FamilyMember, MedicalReport, Doctor, NotificationItem, FitnessData } from './types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { EmergencyModal } from './components/EmergencyModal';
import { AuthModal } from './components/AuthModal';
import { LandingHero } from './components/LandingHero';
import { DashboardView } from './components/DashboardView';
import { ReportAnalysisView } from './components/ReportAnalysisView';
import { FamilyRecordsView } from './components/FamilyRecordsView';
import { FindDoctorView } from './components/FindDoctorView';
import { FitnessView } from './components/FitnessView';
import { DietPlanView } from './components/DietPlanView';
import { AiAssistantView } from './components/AiAssistantView';
import { SettingsView } from './components/SettingsView';
import { MedicationView } from './components/MedicationView';
import { PrescriptionView } from './components/PrescriptionView';
import { SafetyLedgerView } from './components/SafetyLedgerView';
import { AlertsView } from './components/AlertsView';
import { CarePlanView } from './components/CarePlanView';
import { BriefingPanel } from './components/BriefingPanel';
import { AgentNetworkView } from './components/AgentNetworkView';
import { ReportCompareView } from './components/ReportCompareView';
import { FollowUpView } from './components/FollowUpView';
import {
  LayoutDashboard,
  FileText,
  Bot,
  Settings,
  AlertTriangle,
  Pill,
  Siren,
  SunMedium,
  Network,
} from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const [currentView, setCurrentView] = useState<string>('dashboard');
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [activeMember, setActiveMember] = useState<FamilyMember | null>(null);
  const [records, setRecords] = useState<MedicalReport[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [fitnessData, setFitnessData] = useState<FitnessData | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // Modals state
  const [isEmergencyOpen, setIsEmergencyOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [selectedHistoricalReport, setSelectedHistoricalReport] = useState<MedicalReport | null>(null);
  const [briefingRefreshKey, setBriefingRefreshKey] = useState(0);

  // Initialize and fetch data
  const loadData = async () => {
    try {
      const [famRes, recRes, docRes, fitRes, notifRes] = await Promise.all([
        api.getFamily(),
        api.getRecords(),
        api.getDoctors(),
        api.getFitness(),
        api.getNotifications(),
      ]);

      setFamilyMembers(famRes);
      if (famRes.length > 0 && !activeMember) {
        setActiveMember(famRes[0]);
      }
      setRecords(recRes);
      setDoctors(docRes);
      setFitnessData(fitRes);
      setNotifications(notifRes);
    } catch (err) {
      console.error('Failed to load initial data:', err);
    }
  };

  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;
    api.getMe().then(({ user }) => {
      setCurrentUser(user);
      loadData();
    }).catch(() => {
      removeAuthToken();
      setCurrentUser(null);
    });
  }, []);

  const handleLogout = () => {
    removeAuthToken();
    setCurrentUser(null);
    setCurrentView('landing');
  };

  const handleAuthSuccess = (user: User) => {
    setCurrentUser(user);
    loadData();
    setCurrentView('dashboard');
  };

  const handleOpenReportFromDashboard = (report: MedicalReport) => {
    setSelectedHistoricalReport(report);
    setCurrentView('reports');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col selection:bg-emerald-100 selection:text-emerald-900">
      {/* Top Header */}
      <Header
        user={currentUser}
        familyMembers={familyMembers}
        activeMember={activeMember}
        onSelectMember={(m) => setActiveMember(m)}
        notifications={notifications}
        onOpenEmergency={() => setIsEmergencyOpen(true)}
        onOpenAuth={() => setIsAuthOpen(true)}
        onLogout={handleLogout}
        onNavigate={(view) => {
          setCurrentView(view);
          setSelectedHistoricalReport(null);
        }}
        onToggleMobileNav={() => setIsMobileNavOpen(true)}
      />

      {/* Main Layout Container */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto">
        {/* Sidebar (Desktop + Mobile Drawer) */}
        {currentUser && (
          <Sidebar
            currentView={currentView}
            onNavigate={(view) => {
              setCurrentView(view);
              setSelectedHistoricalReport(null);
            }}
            isMobileOpen={isMobileNavOpen}
            onCloseMobile={() => setIsMobileNavOpen(false)}
          />
        )}

        {/* Viewport Content Area */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          {currentView === 'landing' || !currentUser ? (
            <LandingHero
              onStartDemo={() => {
                if (!currentUser) setIsAuthOpen(true);
                else setCurrentView('dashboard');
              }}
              onOpenAssistant={() => {
                if (!currentUser) setIsAuthOpen(true);
                else setCurrentView('assistant');
              }}
            />
          ) : currentView === 'dashboard' ? (
            <DashboardView
              user={currentUser}
              familyMembers={familyMembers}
              activeMember={activeMember}
              onSelectMember={(m) => setActiveMember(m)}
              recentReports={records}
              fitnessData={fitnessData}
              onNavigate={(view) => {
                setCurrentView(view);
                setSelectedHistoricalReport(null);
              }}
              onOpenReportModal={handleOpenReportFromDashboard}
            />
          ) : currentView === 'reports' ? (
            <ReportAnalysisView
              familyMembers={familyMembers}
              activeMember={activeMember}
              onSelectMember={(m) => setActiveMember(m)}
              savedReports={records}
              selectedHistoricalReport={selectedHistoricalReport}
              onReportSaved={(newRep) => {
                setRecords((prev) => [newRep, ...prev]);
              }}
            />
          ) : currentView === 'family' ? (
            <FamilyRecordsView
              familyMembers={familyMembers}
              activeMember={activeMember}
              onSelectMember={(m) => setActiveMember(m)}
              onRefreshFamily={loadData}
              records={records}
              onOpenReportDetails={(rep) => {
                setSelectedHistoricalReport(rep);
                setCurrentView('reports');
              }}
            />
          ) : currentView === 'doctors' ? (
            <FindDoctorView doctors={doctors} />
          ) : currentView === 'fitness' ? (
            <FitnessView
              fitnessData={fitnessData}
              onRefreshFitness={async () => {
                const fit = await api.getFitness();
                setFitnessData(fit);
              }}
            />
          ) : currentView === 'diet' ? (
            <DietPlanView
              familyMembers={familyMembers}
              activeMember={activeMember}
              onSelectMember={(m) => setActiveMember(m)}
            />
          ) : currentView === 'assistant' ? (
            <AiAssistantView
              familyMembers={familyMembers}
              activeMember={activeMember}
              onSelectMember={(m) => setActiveMember(m)}
            />
          ) : currentView === 'settings' ? (
            <SettingsView user={currentUser} onLogout={handleLogout} />
          ) : currentView === 'briefing' ? (
            <div className="max-w-4xl">
              <BriefingPanel
                key={briefingRefreshKey}
                onRefresh={() => setBriefingRefreshKey((k) => k + 1)}
              />
            </div>
          ) : currentView === 'medications' ? (
            <MedicationView
              familyMembers={familyMembers}
              activeMember={activeMember}
              onSelectMember={setActiveMember}
            />
          ) : currentView === 'prescription' ? (
            <PrescriptionView
              familyMembers={familyMembers}
              activeMember={activeMember}
              onSelectMember={setActiveMember}
              onCommitted={loadData}
            />
          ) : currentView === 'safety' ? (
            <SafetyLedgerView
              familyMembers={familyMembers}
              activeMember={activeMember}
              onSelectMember={setActiveMember}
            />
          ) : currentView === 'alerts' ? (
            <AlertsView
              familyMembers={familyMembers}
              activeMember={activeMember}
              onSelectMember={setActiveMember}
              onRefresh={loadData}
            />
          ) : currentView === 'careplan' ? (
            <CarePlanView
              familyMembers={familyMembers}
              activeMember={activeMember}
              onSelectMember={setActiveMember}
            />
          ) : currentView === 'agentnetwork' ? (
            <AgentNetworkView onNavigate={(view) => setCurrentView(view)} />
          ) : currentView === 'compare' ? (
            <ReportCompareView
              familyMembers={familyMembers}
              activeMember={activeMember}
              onSelectMember={setActiveMember}
            />
          ) : currentView === 'followup' ? (
            <FollowUpView
              familyMembers={familyMembers}
              activeMember={activeMember}
              onSelectMember={setActiveMember}
            />
          ) : null}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      {currentUser && (
        <div className="md:hidden sticky bottom-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-2 py-1.5 flex items-center justify-around">
          {[
            { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
            { id: 'briefing', label: 'Brief', icon: SunMedium },
            { id: 'medications', label: 'Meds', icon: Pill },
            { id: 'alerts', label: 'Alerts', icon: Siren },
            { id: 'reports', label: 'Reports', icon: FileText },
            { id: 'assistant', label: 'AI Chat', icon: Bot },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setCurrentView(item.id);
                  setSelectedHistoricalReport(null);
                }}
                className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg text-[10px] font-semibold transition-colors ${
                  isActive ? 'text-emerald-600' : 'text-slate-500'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Emergency Assistance Modal */}
      <EmergencyModal
        isOpen={isEmergencyOpen}
        onClose={() => setIsEmergencyOpen(false)}
        activeMember={activeMember}
      />

      {/* Authentication Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />
    </div>
  );
}
