import bcrypt from 'bcryptjs';
import { Request, Response, Router } from 'express';
import { Type } from '@google/genai';
import { authenticateToken, signToken } from '../auth';
import { generateJson } from '../ai/providers';
import {
  appointments,
  doctors,
  familyMembers,
  fitness,
  fitnessSyncByUser,
  medicalReports,
  notifications,
  persistState,
  users,
} from '../store';
import { FamilyMember, MedicalReport, User } from '../types';

export const legacyRouter = Router();

// -------------------------------------------------------------
// 1. Auth
// -------------------------------------------------------------

legacyRouter.post('/api/auth/register', async (req: Request, res: Response) => {
  const { name, email, password, phone, city } = req.body;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!normalizedName || !normalizedEmail || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  const existing = users.find((u) => u.email.toLowerCase() === normalizedEmail);
  if (existing) {
    return res
      .status(409)
      .json({ error: 'An account with this email already exists.' });
  }

  const newUser: User = {
    id: `user-${Date.now()}`,
    name: normalizedName,
    email: normalizedEmail,
    passwordHash: bcrypt.hashSync(String(password), 10),
    phone: phone || '',
    city: city || 'Bengaluru, India',
    emergencyContact: { name: '', relationship: '', phone: '' },
    preferences: {
      medicationAlarms: true,
      hydrationAlerts: true,
      reportReadyAlerts: true,
      fitnessMilestones: true,
    },
  };
  users.push(newUser);

  // Create self profile in family members
  familyMembers.push({
    id: `fam-${Date.now()}`,
    userId: newUser.id,
    name: `${normalizedName} (You)`,
    relationship: 'Self',
    age: 0,
    gender: 'Other',
    bloodGroup: 'Unknown',
    allergies: [],
    existingConditions: [],
    medications: [],
    emergencyContact: phone || '',
    notes: '',
    avatarColor: 'bg-emerald-500',
  });

  await persistState();

  const token = signToken(newUser);
  return res
    .status(201)
    .json({ token, user: { id: newUser.id, name: newUser.name, email: newUser.email } });
});

legacyRouter.post('/api/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = users.find((u) => u.email.toLowerCase() === normalizedEmail);
  if (!user || !bcrypt.compareSync(String(password), user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = signToken(user);
  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone, city: user.city },
  });
});

legacyRouter.get('/api/auth/me', authenticateToken, (req: Request, res: Response) => {
  const user = users.find((u) => u.id === req.user?.id);
  if (!user) return res.status(401).json({ error: 'User account not found.' });
  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      city: user.city,
    },
    preferences: user.preferences,
  });
});

legacyRouter.put('/api/auth/profile', authenticateToken, async (req: Request, res: Response) => {
  const user = users.find((u) => u.id === req.user!.id);
  if (!user) return res.status(404).json({ error: 'User account not found.' });
  const { name, phone, city, preferences } = req.body || {};
  if (typeof name === 'string' && name.trim()) user.name = name.trim();
  if (typeof phone === 'string') user.phone = phone.trim();
  if (typeof city === 'string') user.city = city.trim();
  if (preferences && typeof preferences === 'object') {
    for (const key of ['medicationAlarms', 'hydrationAlerts', 'reportReadyAlerts', 'fitnessMilestones']) {
      if (typeof preferences[key] === 'boolean') {
        user.preferences[key as keyof typeof user.preferences] = preferences[key];
      }
    }
  }
  const self = familyMembers.find((f) => f.userId === user.id && f.relationship === 'Self');
  if (self) {
    self.name = `${user.name} (You)`;
    self.emergencyContact = user.phone || self.emergencyContact;
  }
  await persistState();
  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      city: user.city,
    },
    preferences: user.preferences,
  });
});

// -------------------------------------------------------------
// 2. Family Members
// -------------------------------------------------------------

legacyRouter.get('/api/family', authenticateToken, (req: Request, res: Response) => {
  res.json(familyMembers.filter((f) => f.userId === req.user!.id));
});

legacyRouter.post('/api/family', authenticateToken, async (req: Request, res: Response) => {
  const currentUserId = req.user!.id;
  const {
    name,
    relationship,
    age,
    gender,
    bloodGroup,
    allergies,
    existingConditions,
    medications,
    emergencyContact,
    notes,
  } = req.body;

  if (!name || !relationship) {
    return res.status(400).json({ error: 'Name and relationship are required.' });
  }

  const colors = ['bg-indigo-600', 'bg-purple-600', 'bg-rose-600', 'bg-amber-600', 'bg-teal-600', 'bg-sky-600'];
  const avatarColor = colors[Math.floor(Math.random() * colors.length)];

  const newMember: FamilyMember = {
    id: `fam-${Date.now()}`,
    userId: currentUserId,
    name,
    relationship,
    age: Number(age) || 30,
    gender: gender || 'Other',
    bloodGroup: bloodGroup || 'Unknown',
    allergies: Array.isArray(allergies)
      ? allergies
      : typeof allergies === 'string'
        ? allergies.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
    existingConditions: Array.isArray(existingConditions)
      ? existingConditions
      : typeof existingConditions === 'string'
        ? existingConditions.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
    medications: Array.isArray(medications)
      ? medications
      : typeof medications === 'string'
        ? medications.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
    emergencyContact: emergencyContact || '',
    notes: notes || '',
    avatarColor,
  };

  familyMembers.push(newMember);
  await persistState();
  res.status(201).json(newMember);
});

legacyRouter.put('/api/family/:id', authenticateToken, async (req: Request, res: Response) => {
  const index = familyMembers.findIndex((f) => f.id === req.params.id && f.userId === req.user!.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Family member not found.' });
  }

  const { userId: _userId, id: _id, ...safeUpdates } = req.body || {};
  familyMembers[index] = {
    ...familyMembers[index],
    ...safeUpdates,
    userId: req.user!.id,
    id: familyMembers[index].id,
  };
  await persistState();
  res.json(familyMembers[index]);
});

legacyRouter.delete('/api/family/:id', authenticateToken, async (req: Request, res: Response) => {
  const index = familyMembers.findIndex((f) => f.id === req.params.id && f.userId === req.user!.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Family member not found.' });
  }

  familyMembers.splice(index, 1);
  await persistState();
  res.json({ success: true, message: 'Family member removed.' });
});

// -------------------------------------------------------------
// 3. Health Records & Reports
// -------------------------------------------------------------

legacyRouter.get('/api/records', authenticateToken, (req: Request, res: Response) => {
  const { memberId } = req.query;
  let records = medicalReports.filter((r) => r.userId === req.user!.id);
  if (memberId) records = records.filter((r) => r.memberId === memberId);
  res.json(records);
});

legacyRouter.post('/api/records', authenticateToken, async (req: Request, res: Response) => {
  const currentUserId = req.user!.id;
  const member = familyMembers.find(
    (f) => f.id === req.body.memberId && f.userId === currentUserId
  );
  if (!member) {
    return res
      .status(403)
      .json({ error: 'You can only save records for your own family members.' });
  }
  const { id: _id, userId: _userId, ...reportBody } = req.body || {};
  const newReport: MedicalReport = {
    ...reportBody,
    id: `rep-${Date.now()}`,
    userId: currentUserId,
    memberId: member.id,
    memberName: member.name,
    date: req.body.date || new Date().toISOString().split('T')[0],
  };
  medicalReports.unshift(newReport);
  await persistState();
  res.status(201).json(newReport);
});

legacyRouter.delete('/api/records/:id', authenticateToken, async (req: Request, res: Response) => {
  const index = medicalReports.findIndex(
    (r) => r.id === req.params.id && r.userId === req.user!.id
  );
  if (index === -1) {
    return res.status(404).json({ error: 'Report not found.' });
  }
  medicalReports.splice(index, 1);
  await persistState();
  res.json({ success: true });
});

// -------------------------------------------------------------
// 4. Gemini AI Report Analysis
// -------------------------------------------------------------

legacyRouter.post('/api/ai/analyze-report', authenticateToken, async (req: Request, res: Response) => {
  const { reportType, reportText, imageBase64, imageMimeType, memberId } = req.body;
  const member = familyMembers.find(
    (f) => f.id === memberId && f.userId === req.user!.id
  );
  if (!member) {
    return res.status(404).json({ error: 'Selected family member was not found.' });
  }

  const promptText = `
You are Healthyfy AI, an expert medical report analysis assistant.
Analyze this medical report carefully and return a structured JSON response.

Member Context:
- Name: ${member.name}
- Age: ${member.age}, Gender: ${member.gender}
- Known Conditions: ${member.existingConditions.join(', ') || 'None'}
- Current Medications: ${member.medications.join(', ') || 'None'}
- Allergies: ${member.allergies.join(', ') || 'None'}

Report Type: ${reportType || 'General Laboratory Panel'}
Report Content / Values:
${reportText || 'Patient provided image/scanned document of lab report.'}

CRITICAL MEDICAL SAFETY REQUIREMENTS:
1. You are an educational and informational tool, NOT a replacement for a doctor.
2. Provide a clear, jargon-free summary in conversational, reassuring language.
3. Extract each test into an item with testName, result, referenceRange, and status strictly as one of:
   - "Within range"
   - "Higher than reference range"
   - "Lower than reference range"
4. Explain abnormal or notable values in simple language that an ordinary person can easily comprehend.
5. List educational possibilities of what results may indicate (NEVER present a diagnosis as certain).
6. Provide suggested practical questions the user should ask their doctor.
7. Outline helpful next steps (e.g. hydration, dietary adjustment, routine doctor consultation).
8. Emergency Warning: If values are critically life-threatening (e.g., severe acute chest pain signs, troponin spike, critical hypoglycemia < 40mg/dL, platelets < 20,000, dangerous potassium spike), set isUrgent to true and provide an immediate warning to seek emergency care. Otherwise set isUrgent to false.
9. Always include the standard disclaimer: "This AI analysis is for informational purposes only and does not replace professional medical advice."
`;

  try {
    const inlineParts =
      imageBase64 && imageMimeType
        ? [{ mimeType: imageMimeType, data: imageBase64.replace(/^data:[^;]+;base64,/, '') }]
        : [];

    const result = await generateJson<any>({
      prompt: promptText,
      inlineParts,
      schema: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: 'Simple plain-language summary of what the report contains.',
          },
          values: {
            type: Type.ARRAY,
            description: 'Extracted key lab test metrics.',
            items: {
              type: Type.OBJECT,
              properties: {
                testName: { type: Type.STRING },
                result: { type: Type.STRING },
                referenceRange: { type: Type.STRING },
                status: {
                  type: Type.STRING,
                  enum: ['Within range', 'Higher than reference range', 'Lower than reference range'],
                },
                clinicalSignificance: { type: Type.STRING },
              },
              required: ['testName', 'result', 'referenceRange', 'status'],
            },
          },
          aiExplanation: {
            type: Type.STRING,
            description: 'Conversational explanation of abnormal or notable values.',
          },
          possibleIndications: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'General educational possibilities without definite diagnosis.',
          },
          suggestedQuestions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Specific questions to ask a doctor.',
          },
          nextSteps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Suggested lifestyle and follow-up medical actions.',
          },
          isUrgent: {
            type: Type.BOOLEAN,
            description: 'True if values suggest an emergency needing immediate ER care.',
          },
          emergencyWarning: { type: Type.STRING, description: 'Warning text if urgent.' },
          disclaimer: { type: Type.STRING },
        },
        required: [
          'summary',
          'values',
          'aiExplanation',
          'possibleIndications',
          'suggestedQuestions',
          'nextSteps',
          'isUrgent',
        ],
      },
    });

    const parsed = result.data;
    if (!parsed.disclaimer) {
      parsed.disclaimer =
        'This AI analysis is for informational purposes only and does not replace professional medical advice.';
    }
    return res.json(parsed);
  } catch (error: any) {
    console.error('Error analyzing report with Gemini:', error);
    return res.status(502).json({
      error:
        'AI report analysis is temporarily unavailable. No medical values were fabricated or assumed.',
    });
  }
});

// -------------------------------------------------------------
// 5. Gemini AI Personalized Diet Plan
// -------------------------------------------------------------

legacyRouter.post('/api/ai/generate-diet', authenticateToken, async (req: Request, res: Response) => {
  const { age, goals, activityLevel, dietaryPreference, allergies, schedule, memberId } = req.body;
  const member = familyMembers.find(
    (f) => f.id === memberId && f.userId === req.user!.id
  );
  if (!member) {
    return res.status(404).json({ error: 'Selected family member was not found.' });
  }

  const promptText = `
Generate a personalized, culturally adaptable, and medically conscious daily & weekly nutrition plan for:
- Individual: ${member.name}
- Age: ${age || member.age}
- Health Goals: ${goals || 'Overall vitality, cardiovascular wellness, energy optimization'}
- Activity Level: ${activityLevel || 'Moderately active'}
- Dietary Preference: ${dietaryPreference || 'Balanced (Vegetarian/Flexitarian)'}
- Allergies / Intolerances: ${allergies || member.allergies.join(', ') || 'None'}
- Existing Health Conditions: ${member.existingConditions.join(', ') || 'None'}
- Approximate Schedule: ${schedule || 'Wake up 7:00 AM, Desk work 9-5, Sleep 11:00 PM'}

Return structured JSON with:
- overview: Short encouraging paragraph outlining dietary strategy
- calorieTarget: Estimated daily kcal target
- meals: Object with breakfast, midMorningSnack, lunch, eveningSnack, dinner. Each meal must include:
    - title: Meal name
    - items: Array of dishes/ingredients with portion sizes
    - calories: string (approx kcal)
    - protein: string (e.g. "24g")
    - keyBenefit: Why this benefits their specific health goals
- weeklyMealIdeas: Array of 3 creative alternative suggestions for the week
- hydrationTips: Array of 3 daily hydration reminders
- groceryList: Array of key healthy grocery items to pick up
- healthyAlternatives: Array of objects with { craving: string, swap: string, benefit: string }
- disclaimer: Standard disclaimer noting this is general nutritional guidance, and individuals with chronic conditions (such as diabetes, renal disease, pregnancy) should consult a registered dietitian.
`;

  try {
    const result = await generateJson<any>({
      prompt: promptText,
      schema: {
        type: Type.OBJECT,
        properties: {
          overview: { type: Type.STRING },
          calorieTarget: { type: Type.STRING },
          meals: {
            type: Type.OBJECT,
            properties: {
              breakfast: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  items: { type: Type.ARRAY, items: { type: Type.STRING } },
                  calories: { type: Type.STRING },
                  protein: { type: Type.STRING },
                  keyBenefit: { type: Type.STRING },
                },
                required: ['title', 'items', 'calories', 'protein', 'keyBenefit'],
              },
              midMorningSnack: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  items: { type: Type.ARRAY, items: { type: Type.STRING } },
                  calories: { type: Type.STRING },
                  protein: { type: Type.STRING },
                  keyBenefit: { type: Type.STRING },
                },
                required: ['title', 'items', 'calories', 'protein', 'keyBenefit'],
              },
              lunch: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  items: { type: Type.ARRAY, items: { type: Type.STRING } },
                  calories: { type: Type.STRING },
                  protein: { type: Type.STRING },
                  keyBenefit: { type: Type.STRING },
                },
                required: ['title', 'items', 'calories', 'protein', 'keyBenefit'],
              },
              eveningSnack: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  items: { type: Type.ARRAY, items: { type: Type.STRING } },
                  calories: { type: Type.STRING },
                  protein: { type: Type.STRING },
                  keyBenefit: { type: Type.STRING },
                },
                required: ['title', 'items', 'calories', 'protein', 'keyBenefit'],
              },
              dinner: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  items: { type: Type.ARRAY, items: { type: Type.STRING } },
                  calories: { type: Type.STRING },
                  protein: { type: Type.STRING },
                  keyBenefit: { type: Type.STRING },
                },
                required: ['title', 'items', 'calories', 'protein', 'keyBenefit'],
              },
            },
            required: ['breakfast', 'midMorningSnack', 'lunch', 'eveningSnack', 'dinner'],
          },
          weeklyMealIdeas: { type: Type.ARRAY, items: { type: Type.STRING } },
          hydrationTips: { type: Type.ARRAY, items: { type: Type.STRING } },
          groceryList: { type: Type.ARRAY, items: { type: Type.STRING } },
          healthyAlternatives: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                craving: { type: Type.STRING },
                swap: { type: Type.STRING },
                benefit: { type: Type.STRING },
              },
              required: ['craving', 'swap', 'benefit'],
            },
          },
          disclaimer: { type: Type.STRING },
        },
        required: [
          'overview',
          'calorieTarget',
          'meals',
          'weeklyMealIdeas',
          'hydrationTips',
          'groceryList',
          'healthyAlternatives',
        ],
      },
    });

    const parsed = result.data;
    if (!parsed.disclaimer) {
      parsed.disclaimer =
        'This meal plan is for general wellness and educational guidance. Users with medical conditions should consult a certified dietitian.';
    }
    return res.json(parsed);
  } catch (error: any) {
    console.error('Error generating AI diet:', error);
    return res
      .status(500)
      .json({ error: 'Failed to generate personalized diet plan. Please try again.' });
  }
});

// -------------------------------------------------------------
// 6. Doctors API
// -------------------------------------------------------------

legacyRouter.get('/api/doctors', (req: Request, res: Response) => {
  const { specialty, query, availableToday } = req.query;
  let list = [...doctors];

  if (specialty && specialty !== 'All') {
    list = list.filter((d) => d.specialty.toLowerCase() === String(specialty).toLowerCase());
  }
  if (availableToday === 'true') {
    list = list.filter((d) => d.isAvailableToday);
  }
  if (query) {
    const q = String(query).toLowerCase();
    list = list.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.specialty.toLowerCase().includes(q) ||
        d.hospital.toLowerCase().includes(q) ||
        d.address.toLowerCase().includes(q)
    );
  }

  res.json(list);
});

// -------------------------------------------------------------
// 7. Appointments API
// -------------------------------------------------------------

legacyRouter.post('/api/appointments', authenticateToken, async (req: Request, res: Response) => {
  const { doctorId, date, slot } = req.body || {};
  const doctor = doctors.find((d) => d.id === doctorId);
  if (!doctor || !date || !slot) {
    return res.status(400).json({ error: 'Doctor, date and time slot are required.' });
  }
  const selected = new Date(`${date}T12:00:00`);
  if (Number.isNaN(selected.getTime()) || selected < new Date(new Date().toDateString())) {
    return res.status(400).json({ error: 'Please choose a valid future date.' });
  }
  const conflict = appointments.some(
    (a) =>
      a.doctorId === doctorId && a.date === date && a.slot === slot && a.status === 'confirmed'
  );
  if (conflict) {
    return res.status(409).json({ error: 'That slot is already booked. Please choose another slot.' });
  }
  const appointment = {
    id: crypto.randomUUID(),
    userId: req.user!.id,
    doctorId,
    doctorName: doctor.name,
    specialty: doctor.specialty,
    date,
    slot,
    status: 'confirmed' as const,
    createdAt: new Date().toISOString(),
  };
  appointments.push(appointment);
  notifications.push({
    id: `notif-${crypto.randomUUID()}`,
    userId: req.user!.id,
    type: 'appointment' as const,
    title: 'Appointment confirmed',
    message: `${doctor.name} on ${date} at ${slot}.`,
    timestamp: new Date().toISOString(),
    read: false,
    priority: 'medium' as const,
  });
  await persistState();
  res.status(201).json(appointment);
});

legacyRouter.get('/api/appointments', authenticateToken, (req: Request, res: Response) => {
  res.json(appointments.filter((a) => a.userId === req.user!.id));
});

// -------------------------------------------------------------
// 8. Fitness API
// -------------------------------------------------------------

legacyRouter.get('/api/fitness', authenticateToken, (req: Request, res: Response) => {
  res.json({
    syncEnabled: fitnessSyncByUser.get(req.user!.id) ?? false,
    ...fitness,
  });
});

legacyRouter.post(
  '/api/fitness/toggle-sync',
  authenticateToken,
  async (req: Request, res: Response) => {
    const next = !(fitnessSyncByUser.get(req.user!.id) ?? false);
    fitnessSyncByUser.set(req.user!.id, next);
    await persistState();
    res.json({
      syncEnabled: next,
      message: next ? 'Simulated wearable sync active' : 'Wearable sync paused',
    });
  }
);

// -------------------------------------------------------------
// 9. Notifications API
// -------------------------------------------------------------

legacyRouter.get('/api/notifications', authenticateToken, (req: Request, res: Response) => {
  res.json(notifications.filter((n) => n.userId === req.user!.id));
});

legacyRouter.post(
  '/api/notifications/:id/read',
  authenticateToken,
  async (req: Request, res: Response) => {
    const item = notifications.find((n) => n.id === req.params.id && n.userId === req.user!.id);
    if (item) item.read = true;
    await persistState();
    res.json({ success: true });
  }
);

legacyRouter.post(
  '/api/notifications/clear-all',
  authenticateToken,
  async (req: Request, res: Response) => {
    notifications
      .filter((n) => n.userId === req.user!.id)
      .forEach((n) => (n.read = true));
    await persistState();
    res.json({ success: true });
  }
);
