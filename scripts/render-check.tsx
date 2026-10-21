/**
 * Renders each new view with React's server renderer to prove the
 * components mount without throwing. Catches the class of bug that
 * TypeScript cannot see: a bad property access or a missing guard in
 * the first render pass.
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MedicationView } from '../src/components/MedicationView';
import { PrescriptionView } from '../src/components/PrescriptionView';
import { SafetyLedgerView } from '../src/components/SafetyLedgerView';
import { AlertsView } from '../src/components/AlertsView';
import { CarePlanView } from '../src/components/CarePlanView';
import { BriefingPanel } from '../src/components/BriefingPanel';
import { AgentTrace } from '../src/components/AgentTrace';
import { AgentNetworkView } from '../src/components/AgentNetworkView';
import { ReportCompareView } from '../src/components/ReportCompareView';
import { FollowUpView } from '../src/components/FollowUpView';

const familyMembers = [
  {
    id: 'fam-1',
    userId: 'user-1',
    name: 'Kartik Sharma (You)',
    relationship: 'Self' as const,
    age: 26,
    gender: 'Male' as const,
    bloodGroup: 'O+',
    allergies: ['Penicillin'],
    existingConditions: ['Mild Asthma'],
    medications: ['Salbutamol'],
    emergencyContact: '+91 98765 43211',
    notes: '',
    avatarColor: 'bg-emerald-500',
  },
  {
    id: 'fam-2',
    userId: 'user-1',
    name: 'Rajesh Sharma',
    relationship: 'Father' as const,
    age: 58,
    gender: 'Male' as const,
    bloodGroup: 'B+',
    allergies: ['Sulfa drugs'],
    existingConditions: ['Type 2 Diabetes'],
    medications: ['Metformin 500mg'],
    emergencyContact: '+91 98765 43210',
    notes: '',
    avatarColor: 'bg-blue-600',
  },
];

const props = {
  familyMembers,
  activeMember: familyMembers[1],
  onSelectMember: () => {},
};

const views: Array<[string, React.ReactElement]> = [
  ['MedicationView', <MedicationView {...props} />],
  ['PrescriptionView', <PrescriptionView {...props} />],
  ['SafetyLedgerView', <SafetyLedgerView {...props} />],
  ['AlertsView', <AlertsView {...props} />],
  ['CarePlanView', <CarePlanView {...props} />],
  ['BriefingPanel', <BriefingPanel />],
  ['AgentNetworkView', <AgentNetworkView />],
  ['ReportCompareView', <ReportCompareView {...props} />],
  ['FollowUpView', <FollowUpView {...props} />],
  [
    'AgentTrace',
    <AgentTrace
      trace={[
        { step: 1, name: 'get_medical_reports', args: { memberId: 'fam-2' }, result: [], ok: true, durationMs: 42, pending: false },
        { step: 2, name: 'create_reminder', args: { title: 'Hydration' }, result: { pending: true }, ok: true, durationMs: 8, pending: true },
      ]}
    />,
  ],
];

let failures = 0;
for (const [name, element] of views) {
  try {
    const html = renderToString(element);
    console.log(`  \u2713 ${name.padEnd(20)} rendered ${html.length} bytes`);
  } catch (error: any) {
    failures++;
    console.log(`  \u2717 ${name.padEnd(20)} threw: ${error?.message}`);
  }
}

console.log(failures === 0 ? '\nAll views mounted cleanly.' : `\n${failures} view(s) failed to mount.`);
process.exit(failures > 0 ? 1 : 0);
