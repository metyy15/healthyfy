import bcrypt from 'bcryptjs';
import {
  Doctor,
  FamilyMember,
  FitnessData,
  MedicalReport,
  NotificationItem,
  User,
} from './types';

// -------------------------------------------------------------
// Seed data. Created on first MongoDB connection.
// -------------------------------------------------------------

export function seedUsers(): User[] {
  return [
    {
      id: 'user-kartik-1',
      name: 'Kartik Sharma',
      email: 'kartik@healthyfy.ai',
      passwordHash: bcrypt.hashSync('healthyfy123', 10),
      phone: '+91 98765 43210',
      city: 'Bengaluru, India',
      emergencyContact: {
        name: 'Rajesh Sharma (Father)',
        relationship: 'Father',
        phone: '+91 98765 43211',
      },
      preferences: {
        medicationAlarms: true,
        hydrationAlerts: true,
        reportReadyAlerts: true,
        fitnessMilestones: true,
      },
    },
  ];
}

export function seedFamilyMembers(): FamilyMember[] {
  return [
    {
      id: 'fam-1',
      userId: 'user-kartik-1',
      name: 'Kartik Sharma (You)',
      relationship: 'Self',
      age: 26,
      gender: 'Male',
      bloodGroup: 'O+',
      allergies: ['Dust mites', 'Penicillin'],
      existingConditions: ['Mild Asthma (Exercise-induced)'],
      medications: ['Salbutamol inhaler PRN'],
      emergencyContact: '+91 98765 43211',
      notes: 'Preparing for half-marathon, sedentary desk job in tech.',
      avatarColor: 'bg-emerald-500',
    },
    {
      id: 'fam-2',
      userId: 'user-kartik-1',
      name: 'Rajesh Sharma',
      relationship: 'Father',
      age: 58,
      gender: 'Male',
      bloodGroup: 'B+',
      allergies: ['Sulfa drugs'],
      existingConditions: ['Type 2 Diabetes', 'Mild Hypertension'],
      medications: ['Metformin 500mg (Twice daily)', 'Telmisartan 40mg (Once daily)'],
      emergencyContact: '+91 98765 43210',
      notes: 'Last HbA1c in February was 7.1%. Walks 30 mins every morning.',
      avatarColor: 'bg-blue-600',
    },
    {
      id: 'fam-3',
      userId: 'user-kartik-1',
      name: 'Sunita Sharma',
      relationship: 'Mother',
      age: 54,
      gender: 'Female',
      bloodGroup: 'A+',
      allergies: ['Peanuts'],
      existingConditions: ['Hypothyroidism', 'Osteopenia'],
      medications: ['Thyronorm 50mcg (Fasting)', 'Calcium + Vitamin D3 500mg (Once daily)'],
      emergencyContact: '+91 98765 43210',
      notes: 'TSH stable. Practicing daily restorative yoga.',
      avatarColor: 'bg-teal-600',
    },
    {
      id: 'fam-4',
      userId: 'user-kartik-1',
      name: 'Ananya Sharma',
      relationship: 'Sister',
      age: 22,
      gender: 'Female',
      bloodGroup: 'O+',
      allergies: ['None known'],
      existingConditions: ['Mild Iron Deficiency'],
      medications: ['Ferrous Ascorbate 100mg'],
      emergencyContact: '+91 98765 43210',
      notes: 'College student, actively practicing badminton.',
      avatarColor: 'bg-amber-600',
    },
  ];
}

export function seedMedicalReports(): MedicalReport[] {
  return [
    {
      id: 'rep-0',
      userId: 'user-kartik-1',
      memberId: 'fam-2',
      memberName: 'Rajesh Sharma',
      reportType: 'Lipid Profile',
      title: 'Six-monthly Lipid & Cholesterol Panel',
      date: '2026-03-15',
      laboratory: 'MaxCare Diagnostics, Indiranagar',
      summary:
        'Lipid values are close to target, with a mildly raised LDL and triglycerides. This is the earlier of two lipid panels stored for comparison.',
      isUrgent: false,
      values: [
        {
          testName: 'Total Cholesterol',
          result: '188',
          referenceRange: '< 200 mg/dL',
          status: 'Within range',
          clinicalSignificance: 'Within the reference range at this time.',
        },
        {
          testName: 'HDL (Good Cholesterol)',
          result: '48',
          referenceRange: '> 40 mg/dL',
          status: 'Within range',
          clinicalSignificance: 'Protective cholesterol is in a good range.',
        },
        {
          testName: 'LDL (Bad Cholesterol)',
          result: '112',
          referenceRange: '< 100 mg/dL',
          status: 'Higher than reference range',
          clinicalSignificance: 'Mildly raised at this time.',
        },
        {
          testName: 'Triglycerides',
          result: '141',
          referenceRange: '< 150 mg/dL',
          status: 'Within range',
          clinicalSignificance: 'Within the reference range at this time.',
        },
        {
          testName: 'VLDL',
          result: '28',
          referenceRange: '< 30 mg/dL',
          status: 'Within range',
          clinicalSignificance: 'Normal.',
        },
      ],
      aiExplanation:
        'At this point the lipid profile was largely within range, with LDL slightly above target. Compare this with the panel from September to see how things have moved.',
      possibleIndications: [
        'Near-target lipid control',
        'Baseline value for future comparison',
      ],
      suggestedQuestions: [
        'What LDL target should I be aiming for given my diabetes and blood pressure?',
        'How often should this be repeated?',
      ],
      nextSteps: [
        'Retest in about six months.',
        'Keep walking daily and keep dietary fibre intake consistent.',
      ],
      disclaimer:
        'This AI analysis is for educational and informational purposes only and does not replace professional medical advice.',
    },
    {
      id: 'rep-1',
      userId: 'user-kartik-1',
      memberId: 'fam-2',
      memberName: 'Rajesh Sharma',
      reportType: 'Lipid Profile',
      title: 'Comprehensive Lipid & Cholesterol Panel',
      date: '2026-09-18',
      laboratory: 'MaxCare Diagnostics, Indiranagar',
      summary:
        'The lipid profile shows borderline elevated LDL (bad cholesterol) and slightly elevated triglycerides, while HDL (protective cholesterol) remains in optimal range.',
      isUrgent: false,
      values: [
        {
          testName: 'Total Cholesterol',
          result: '215',
          referenceRange: '< 200 mg/dL',
          status: 'Higher than reference range',
          clinicalSignificance: 'Mildly elevated total circulating cholesterol.',
        },
        {
          testName: 'HDL (Good Cholesterol)',
          result: '52',
          referenceRange: '> 40 mg/dL',
          status: 'Within range',
          clinicalSignificance: 'Optimal cardiovascular protective level.',
        },
        {
          testName: 'LDL (Bad Cholesterol)',
          result: '138',
          referenceRange: '< 100 mg/dL',
          status: 'Higher than reference range',
          clinicalSignificance:
            'Elevated; recommended to discuss dietary fiber and lipid-lowering measures.',
        },
        {
          testName: 'Triglycerides',
          result: '165',
          referenceRange: '< 150 mg/dL',
          status: 'Higher than reference range',
          clinicalSignificance:
            'Mildly elevated; associated with carbohydrate intake and exercise balance.',
        },
        {
          testName: 'VLDL',
          result: '25',
          referenceRange: '< 30 mg/dL',
          status: 'Within range',
          clinicalSignificance: 'Normal.',
        },
      ],
      aiExplanation:
        'Your father’s HDL is heart-protective, but LDL and Triglycerides are slightly higher than recommended benchmarks for adults over 50. This is very common and often responsive to reduced saturated fats, increased soluble fiber, and regular brisk walking.',
      possibleIndications: [
        'Mild hyperlipidemia',
        'Metabolic lipid imbalance influenced by diet or genetics',
        'Need for routine quarterly lipid monitoring',
      ],
      suggestedQuestions: [
        'Should we consider adding plant sterols or dietary adjustments before pharmaceutical statin therapy?',
        "Does his current diabetes medication regimen influence triglyceride clearance?",
        'When should we schedule a follow-up fasting lipid profile?',
      ],
      nextSteps: [
        'Incorporate 25g+ of daily soluble fiber (oats, flaxseeds, psyllium, legumes).',
        'Maintain his 30-minute daily morning brisk walks consistently.',
        'Schedule a routine review with his primary physician within 3-4 weeks.',
      ],
      disclaimer:
        'This AI analysis is for educational and informational purposes only and does not replace professional medical advice.',
    },
    {
      id: 'rep-2',
      userId: 'user-kartik-1',
      memberId: 'fam-1',
      memberName: 'Kartik Sharma (You)',
      reportType: 'CBC (Complete Blood Count)',
      title: 'Routine Executive Wellness CBC Panel',
      date: '2026-08-10',
      laboratory: 'Apollo Health Center',
      summary:
        'Normal overall blood cell counts with normal Hemoglobin and healthy white blood cell counts, supporting normal oxygen transport and immune function.',
      isUrgent: false,
      values: [
        {
          testName: 'Hemoglobin',
          result: '15.2',
          referenceRange: '13.5 - 17.5 g/dL',
          status: 'Within range',
        },
        {
          testName: 'Total WBC Count',
          result: '6,800',
          referenceRange: '4,000 - 11,000 /uL',
          status: 'Within range',
        },
        {
          testName: 'Platelet Count',
          result: '240,000',
          referenceRange: '150,000 - 450,000 /uL',
          status: 'Within range',
        },
        {
          testName: 'RBC Count',
          result: '5.1',
          referenceRange: '4.5 - 5.9 mill/uL',
          status: 'Within range',
        },
        {
          testName: 'Hematocrit (PCV)',
          result: '45.1',
          referenceRange: '41 - 50 %',
          status: 'Within range',
        },
      ],
      aiExplanation:
        'All primary CBC parameters are well within standard reference intervals. Adequate hydration and cardiovascular fitness are reflected in these balanced values.',
      possibleIndications: [
        'Healthy baseline hematology',
        'No signs of acute infection or anemia',
      ],
      suggestedQuestions: [
        'Are any additional athletic baseline panels (e.g. serum ferritin, Vitamin D3) recommended?',
      ],
      nextSteps: [
        'Maintain current balanced nutrition and hydration levels during marathon training.',
      ],
      disclaimer:
        'This AI analysis is for educational and informational purposes only and does not replace professional medical advice.',
    },
    {
      id: 'rep-3',
      userId: 'user-kartik-1',
      memberId: 'fam-3',
      memberName: 'Sunita Sharma',
      reportType: 'Thyroid & Vitamin Panel',
      title: 'Thyroid Function & Vitamin D3/B12 Evaluation',
      date: '2026-07-25',
      laboratory: 'Metropolis Healthcare',
      summary:
        'TSH is well-controlled under current Thyronorm dosage. Vitamin D3 is moderately deficient at 18 ng/mL, requiring supplementation.',
      isUrgent: false,
      values: [
        {
          testName: 'TSH (Thyroid Stimulating Hormone)',
          result: '2.4',
          referenceRange: '0.4 - 4.2 uIU/mL',
          status: 'Within range',
        },
        {
          testName: 'Free T4',
          result: '1.2',
          referenceRange: '0.8 - 1.8 ng/dL',
          status: 'Within range',
        },
        {
          testName: 'Vitamin D3 (25-OH)',
          result: '18.4',
          referenceRange: '30 - 100 ng/mL',
          status: 'Lower than reference range',
          clinicalSignificance: 'Deficiency; linked with bone density and muscle aches.',
        },
        {
          testName: 'Vitamin B12',
          result: '385',
          referenceRange: '200 - 900 pg/mL',
          status: 'Within range',
        },
      ],
      aiExplanation:
        'Her thyroid medication is keeping her thyroid hormone levels very well-regulated. However, her Vitamin D3 level is 18.4 ng/mL, which is below the 30 ng/mL threshold and may contribute to osteopenia progression if unaddressed.',
      possibleIndications: [
        'Euthyroid state on replacement therapy',
        'Moderate Vitamin D3 deficiency',
      ],
      suggestedQuestions: [
        'Should we initiate a 6-week weekly 60,000 IU Cholecalciferol course?',
      ],
      nextSteps: [
        'Discuss prescription weekly Vitamin D3 drops/capsules with endocrinologist or family physician.',
      ],
      disclaimer:
        'This AI analysis is for educational and informational purposes only and does not replace professional medical advice.',
    },
    {
      id: 'rep-4',
      userId: 'user-kartik-1',
      memberId: 'fam-2',
      memberName: 'Rajesh Sharma',
      reportType: 'HbA1c (Glycated Haemoglobin)',
      title: 'Three-monthly Glycaemic Control Panel',
      date: '2026-02-18',
      laboratory: 'MaxCare Diagnostics, Indiranagar',
      summary:
        'Glycated haemoglobin is close to target at 7.1%, indicating good average glucose control over the preceding three months on the current regimen.',
      isUrgent: false,
      values: [
        {
          testName: 'HbA1c (Glycated Haemoglobin)',
          result: '7.1',
          referenceRange: '< 7.0 % (target for most adults)',
          status: 'Higher than reference range',
          clinicalSignificance:
            'Just above the usual target, but a stable baseline before the recent change.',
        },
        {
          testName: 'Fasting Blood Glucose',
          result: '112',
          referenceRange: '70 - 100 mg/dL',
          status: 'Higher than reference range',
          clinicalSignificance: 'Mildly raised fasting glucose.',
        },
        {
          testName: 'Estimated Average Glucose',
          result: '131',
          referenceRange: '70 - 154 mg/dL',
          status: 'Within range',
          clinicalSignificance: 'Consistent with the HbA1c above.',
        },
      ],
      aiExplanation:
        'At 7.1% your average sugar over the last three months was close to target. This is a useful baseline, because it shows what the regimen achieved when the evening dose was being taken reliably.',
      possibleIndications: [
        'Near-target glycaemic control on metformin',
        'Baseline value for future comparison',
      ],
      suggestedQuestions: [
        'What HbA1c target should we aim for given my other conditions?',
        'How often should this be rechecked once the medication routine is stable?',
      ],
      nextSteps: [
        'Keep taking the evening dose consistently, as this reading reflects that routine.',
        'Retest HbA1c at the next three-monthly review.',
      ],
      disclaimer:
        'This AI analysis is for educational and informational purposes only and does not replace professional medical advice.',
    },
    {
      id: 'rep-5',
      userId: 'user-kartik-1',
      memberId: 'fam-2',
      memberName: 'Rajesh Sharma',
      reportType: 'HbA1c (Glycated Haemoglobin)',
      title: 'Three-monthly Glycaemic Control Panel',
      date: '2026-09-20',
      laboratory: 'MaxCare Diagnostics, Indiranagar',
      summary:
        'Glycated haemoglobin has risen to 8.4%, above the usual target, indicating that average glucose over the past three months has been higher than during the previous period.',
      isUrgent: false,
      values: [
        {
          testName: 'HbA1c (Glycated Haemoglobin)',
          result: '8.4',
          referenceRange: '< 7.0 % (target for most adults)',
          status: 'Higher than reference range',
          clinicalSignificance:
            'A rise from 7.1% in February. A sustained elevation above target usually prompts a review of both the regimen and how reliably the medication is being taken.',
        },
        {
          testName: 'Fasting Blood Glucose',
          result: '148',
          referenceRange: '70 - 100 mg/dL',
          status: 'Higher than reference range',
          clinicalSignificance: 'Fasting glucose is now above the reference range.',
        },
        {
          testName: 'Estimated Average Glucose',
          result: '189',
          referenceRange: '70 - 154 mg/dL',
          status: 'Higher than reference range',
          clinicalSignificance: 'Consistent with the higher HbA1c.',
        },
      ],
      aiExplanation:
        'Your HbA1c has moved from 7.1% in February to 8.4% now, which means average glucose over the last three months has been higher than before. The most common reason is not that the medicine stopped working, but that doses were missed repeatedly over that period. The dosing record in Healthyfy shows several evening doses of metformin marked as missed, which lines up with this change. Only your doctor can decide whether the regimen needs to change, but it is worth raising.',
      possibleIndications: [
        'Suboptimal glycaemic control',
        'A pattern worth reviewing alongside the medication adherence record',
        'Whether the routine or the regimen needs adjusting is a decision for the prescriber',
      ],
      suggestedQuestions: [
        'My HbA1c has gone from 7.1% to 8.4% and I have missed several evening doses. Would you change the regimen, or would you prefer I make the evening dose routine first?',
        'Would a different dosing time or a reminder system help me take the evening dose reliably?',
        'Should we recheck HbA1c sooner than the usual three months?',
      ],
      nextSteps: [
        'Bring the adherence record for the last two weeks to the appointment so the pattern is visible.',
        'Set a daily reminder for the 8:30 PM dose and attach it to an existing evening routine.',
        'Ask whether a repeat HbA1c in six to eight weeks would confirm the change is working.',
      ],
      disclaimer:
        'This AI analysis is for educational and informational purposes only and does not replace professional medical advice.',
    },
  ];
}

export const doctorsDatabase: Doctor[] = [
  {
    id: 'doc-1',
    name: 'Dr. Priya V. Nambiar',
    specialty: 'General Physician',
    qualification: 'MBBS, MD (Internal Medicine)',
    experienceYears: 14,
    hospital: 'Fortis Clinic & Diagnostics, Koramangala',
    distanceKm: 1.8,
    rating: 4.9,
    reviewsCount: 312,
    address: '80 Feet Road, 4th Block, Koramangala, Bengaluru',
    consultationFee: 700,
    availableTimings: '10:00 AM - 02:00 PM, 05:00 PM - 08:30 PM',
    isAvailableToday: true,
    avatarUrl: '/src/assets/images/doctor_female_avatar_1791210509492.jpg',
  },
  {
    id: 'doc-2',
    name: 'Dr. Arvind Swaminathan',
    specialty: 'Cardiologist',
    qualification: 'MD, DM (Cardiology), FACC',
    experienceYears: 20,
    hospital: 'Manipal Heart Foundation, Old Airport Road',
    distanceKm: 3.4,
    rating: 4.9,
    reviewsCount: 489,
    address: '98 HAL Airport Road, Kodihalli, Bengaluru',
    consultationFee: 1200,
    availableTimings: '11:00 AM - 04:00 PM',
    isAvailableToday: true,
    avatarUrl: '/src/assets/images/doctor_male_avatar_1791210521468.jpg',
  },
  {
    id: 'doc-3',
    name: 'Dr. Shalini Deshmukh',
    specialty: 'Dermatologist',
    qualification: 'MBBS, DDVL, MD (Dermatology)',
    experienceYears: 11,
    hospital: 'Skin & Aesthetics Center, Indiranagar',
    distanceKm: 2.5,
    rating: 4.8,
    reviewsCount: 240,
    address: '100 Feet Road, HAL 2nd Stage, Indiranagar, Bengaluru',
    consultationFee: 850,
    availableTimings: '03:00 PM - 07:30 PM',
    isAvailableToday: false,
    avatarUrl: '/src/assets/images/doctor_female_avatar_1791210509492.jpg',
  },
  {
    id: 'doc-4',
    name: 'Dr. Rajeshwar Rao',
    specialty: 'Orthopedic',
    qualification: 'MS (Ortho), Fellowship in Joint Replacement (UK)',
    experienceYears: 18,
    hospital: 'Apollo Ortho & Spine Institute',
    distanceKm: 4.1,
    rating: 4.7,
    reviewsCount: 195,
    address: 'Bannerghatta Main Road, Bengaluru',
    consultationFee: 950,
    availableTimings: '09:30 AM - 01:00 PM',
    isAvailableToday: true,
    avatarUrl: '/src/assets/images/doctor_male_avatar_1791210521468.jpg',
  },
  {
    id: 'doc-5',
    name: 'Dr. Meera Iyer',
    specialty: 'Pediatrician',
    qualification: 'MD (Pediatrics), DCH',
    experienceYears: 12,
    hospital: 'Rainbow Children’s Clinic, HSR Layout',
    distanceKm: 2.9,
    rating: 4.9,
    reviewsCount: 350,
    address: 'Sector 3, 27th Main, HSR Layout, Bengaluru',
    consultationFee: 650,
    availableTimings: '10:00 AM - 01:30 PM, 06:00 PM - 09:00 PM',
    isAvailableToday: true,
    avatarUrl: '/src/assets/images/doctor_female_avatar_1791210509492.jpg',
  },
  {
    id: 'doc-6',
    name: 'Dr. Vikramaditya Sen',
    specialty: 'Neurologist',
    qualification: 'MD (Medicine), DM (Neurology)',
    experienceYears: 16,
    hospital: 'Aster CMI Hospital, Sahakara Nagar',
    distanceKm: 8.5,
    rating: 4.8,
    reviewsCount: 178,
    address: 'Bellary Road, Hebbal, Bengaluru',
    consultationFee: 1400,
    availableTimings: '11:30 AM - 03:30 PM',
    isAvailableToday: false,
    avatarUrl: '/src/assets/images/doctor_male_avatar_1791210521468.jpg',
  },
];

export function seedNotifications(): NotificationItem[] {
  return [
    {
      id: 'notif-1',
      userId: 'user-kartik-1',
      type: 'medication',
      title: 'Father’s Medication Reminder',
      message: 'Rajesh Sharma: Post-dinner Metformin 500mg is scheduled for 8:30 PM.',
      timestamp: '15 mins ago',
      read: false,
      priority: 'high',
    },
    {
      id: 'notif-2',
      userId: 'user-kartik-1',
      type: 'hydration',
      title: 'Hydration Goal Alert',
      message: 'You have logged 1.8L of water today. Reach your 3.0L goal by evening!',
      timestamp: '1 hour ago',
      read: false,
      priority: 'low',
    },
    {
      id: 'notif-3',
      userId: 'user-kartik-1',
      type: 'report',
      title: 'Report Analysis Completed',
      message: 'Gemini AI finished evaluating Rajesh Sharma’s Lipid Profile report.',
      timestamp: '3 hours ago',
      read: true,
      priority: 'medium',
    },
    {
      id: 'notif-4',
      userId: 'user-kartik-1',
      type: 'fitness',
      title: 'Daily Step Milestone',
      message: 'Great job! You achieved 8,420 steps today, 84% of your daily goal.',
      timestamp: 'Yesterday',
      read: true,
      priority: 'low',
    },
  ];
}

// Demo Fitness Tracker state
export const fitnessData: FitnessData = {
  syncStatus: 'Active (Fitbit & Apple Health Simulated Integration)',
  today: {
    steps: 8420,
    stepGoal: 10000,
    heartRateBpm: 68,
    restingHeartRate: 62,
    sleepHours: 7.4,
    sleepQuality: 'Good (86% efficiency)',
    deepSleepMinutes: 110,
    remSleepMinutes: 95,
    caloriesBurned: 2180,
    activeMinutes: 48,
    distanceKm: 6.2,
    bloodPressure: '118/76 mmHg',
    wellnessScore: 88,
  },
  weeklySteps: [
    { day: 'Mon', steps: 9120, goal: 10000 },
    { day: 'Tue', steps: 10450, goal: 10000 },
    { day: 'Wed', steps: 7800, goal: 10000 },
    { day: 'Thu', steps: 8900, goal: 10000 },
    { day: 'Fri', steps: 11200, goal: 10000 },
    { day: 'Sat', steps: 12500, goal: 10000 },
    { day: 'Sun', steps: 8420, goal: 10000 },
  ],
  heartRateTrends: [
    { time: '06:00', bpm: 58 },
    { time: '09:00', bpm: 74 },
    { time: '12:00', bpm: 82 },
    { time: '15:00', bpm: 71 },
    { time: '18:00', bpm: 124 }, // workout
    { time: '21:00', bpm: 68 },
    { time: '00:00', bpm: 61 },
  ],
  sleepTrends: [
    { day: 'Mon', hours: 7.1 },
    { day: 'Tue', hours: 6.8 },
    { day: 'Wed', hours: 7.5 },
    { day: 'Thu', hours: 8.0 },
    { day: 'Fri', hours: 6.5 },
    { day: 'Sat', hours: 8.2 },
    { day: 'Sun', hours: 7.4 },
  ],
  recentWorkouts: [
    {
      type: 'Evening Run',
      duration: '35 mins',
      calories: 340,
      distance: '4.8 km',
      date: 'Today, 6:00 PM',
    },
    {
      type: 'Morning Mobility Yoga',
      duration: '25 mins',
      calories: 120,
      distance: '-',
      date: 'Yesterday, 7:00 AM',
    },
    {
      type: 'Brisk Outdoor Walk',
      duration: '40 mins',
      calories: 190,
      distance: '3.1 km',
      date: '3 Oct, 7:30 PM',
    },
  ],
};
