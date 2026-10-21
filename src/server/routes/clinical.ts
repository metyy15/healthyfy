import { Request, Response, Router } from 'express';
import { authenticateToken } from '../auth';
import { analyzePrescription } from '../ai/prescription';
import { runSafetyCheck, severityLabel } from '../ai/safety';
import { evaluateVitalsAndAlert, VITAL_UNITS } from '../ai/monitor';
import {
  adherence,
  allergies,
  familyMembers,
  medications,
  persistState,
  persistStateSafely,
  safetyChecks,
  vitals,
} from '../store';
import { AllergyRecord, Medication, Vital, VitalType } from '../types';

export const clinicalRouter = Router();
clinicalRouter.use(authenticateToken);

function ownedMember(req: Request, memberId: string) {
  return familyMembers.find((f) => f.id === memberId && f.userId === req.user!.id);
}

// -------------------------------------------------------------
// Structured medications
// -------------------------------------------------------------

clinicalRouter.get('/medications', (req: Request, res: Response) => {
  const { memberId } = req.query;
  let list = medications.filter((m) => m.userId === req.user!.id);
  if (memberId) list = list.filter((m) => m.memberId === memberId);
  res.json(list);
});

clinicalRouter.post('/medications', async (req: Request, res: Response) => {
  const { memberId, name, dose, frequency, times, route, instructions, prescribedBy, startDate, endDate, active } =
    req.body || {};

  if (!memberId || !name) {
    return res.status(400).json({ error: 'Family member and medication name are required.' });
  }
  const member = ownedMember(req, memberId);
  if (!member) {
    return res.status(403).json({ error: 'You can only manage records for your own family members.' });
  }

  const medication: Medication = {
    id: `med-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId: req.user!.id,
    memberId,
    name: String(name).trim(),
    dose: String(dose || '').trim(),
    frequency: String(frequency || 'As directed').trim(),
    times: Array.isArray(times) ? times.filter((t: unknown) => typeof t === 'string') : [],
    ...(route ? { route: String(route) } : {}),
    ...(instructions ? { instructions: String(instructions) } : {}),
    ...(prescribedBy ? { prescribedBy: String(prescribedBy) } : {}),
    startDate: startDate || new Date().toISOString().slice(0, 10),
    ...(endDate ? { endDate: String(endDate) } : {}),
    active: active === false ? false : true,
    source: 'typed',
    createdAt: new Date().toISOString(),
  };

  // Every medication that enters the system is checked against the
  // member's allergies, other medications and recorded conditions.
  const safety = await runSafetyCheck({
    userId: req.user!.id,
    memberId,
    incoming: [{ name: medication.name, dose: medication.dose }],
    trigger: 'medication_add',
    sourceLabel: `${medication.name} added on ${new Date().toLocaleDateString('en-GB')}`,
  });

  medications.push(medication);
  await persistState();

  res.status(201).json({
    medication,
    safety: {
      highestSeverity: safety.check.highestSeverity,
      findings: safety.check.findings,
      notes: safety.notes,
      message: severityLabel(safety.check.highestSeverity),
      checkId: safety.check.id,
    },
  });
});

clinicalRouter.put('/medications/:id', async (req: Request, res: Response) => {
  const index = medications.findIndex((m) => m.id === req.params.id && m.userId === req.user!.id);
  if (index === -1) return res.status(404).json({ error: 'Medication not found.' });

  const { id: _id, userId: _userId, memberId: _memberId, ...updates } = req.body || {};
  medications[index] = { ...medications[index], ...updates };
  await persistState();
  res.json(medications[index]);
});

clinicalRouter.delete('/medications/:id', async (req: Request, res: Response) => {
  const index = medications.findIndex((m) => m.id === req.params.id && m.userId === req.user!.id);
  if (index === -1) return res.status(404).json({ error: 'Medication not found.' });
  medications.splice(index, 1);
  await persistState();
  res.json({ success: true });
});

// -------------------------------------------------------------
// Allergies
// -------------------------------------------------------------

clinicalRouter.get('/allergies', (req: Request, res: Response) => {
  const { memberId } = req.query;
  let list = allergies.filter((a) => a.userId === req.user!.id);
  if (memberId) list = list.filter((a) => a.memberId === memberId);
  res.json(list);
});

clinicalRouter.post('/allergies', async (req: Request, res: Response) => {
  const { memberId, substance, reaction, severity, source } = req.body || {};
  if (!memberId || !substance) {
    return res.status(400).json({ error: 'Family member and allergy substance are required.' });
  }
  const member = ownedMember(req, memberId);
  if (!member) {
    return res.status(403).json({ error: 'You can only manage records for your own family members.' });
  }

  const record: AllergyRecord = {
    id: `alg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId: req.user!.id,
    memberId,
    substance: String(substance).trim(),
    ...(reaction ? { reaction: String(reaction) } : {}),
    severity: (['mild', 'moderate', 'severe', 'unknown'].includes(severity)
      ? severity
      : 'unknown') as AllergyRecord['severity'],
    verifiedAt: new Date().toISOString().slice(0, 10),
    source: source || 'typed',
    createdAt: new Date().toISOString(),
  };

  allergies.push(record);
  await persistState();
  res.status(201).json(record);
});

clinicalRouter.delete('/allergies/:id', async (req: Request, res: Response) => {
  const index = allergies.findIndex((a) => a.id === req.params.id && a.userId === req.user!.id);
  if (index === -1) return res.status(404).json({ error: 'Allergy record not found.' });
  allergies.splice(index, 1);
  await persistState();
  res.json({ success: true });
});

// -------------------------------------------------------------
// Adherence
// -------------------------------------------------------------

clinicalRouter.get('/adherence', (req: Request, res: Response) => {
  const { memberId, days } = req.query;
  const since = Date.now() - (Number(days) > 0 ? Number(days) : 14) * 86400000;
  let list = adherence.filter(
    (a) => a.userId === req.user!.id && new Date(a.scheduledAt).getTime() >= since
  );
  if (memberId) list = list.filter((a) => a.memberId === memberId);

  const taken = list.filter((e) => e.status === 'taken').length;
  const skipped = list.filter((e) => e.status === 'skipped').length;
  const late = list.filter((e) => e.status === 'late').length;
  const pending = list.filter((e) => e.status === 'pending').length;
  const answered = taken + skipped + late;

  res.json({
    entries: list.sort(
      (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
    ),
    summary: {
      total: list.length,
      taken,
      skipped,
      late,
      pending,
      adherenceRate: answered ? Math.round((taken / answered) * 100) : null,
    },
  });
});

clinicalRouter.post('/adherence', async (req: Request, res: Response) => {
  const { medicationId, scheduledAt, status, note } = req.body || {};
  if (!medicationId || !scheduledAt || !status) {
    return res.status(400).json({ error: 'Medication, scheduled time and status are required.' });
  }
  if (!['taken', 'skipped', 'late'].includes(status)) {
    return res.status(400).json({ error: 'Status must be taken, skipped or late.' });
  }

  const med = medications.find((m) => m.id === medicationId && m.userId === req.user!.id);
  if (!med) return res.status(404).json({ error: 'Medication not found.' });

  let entry = adherence.find(
    (a) => a.medicationId === medicationId && a.scheduledAt === scheduledAt
  );

  if (!entry) {
    entry = {
      id: `adh-${medicationId}-${new Date(scheduledAt).getTime()}`,
      userId: req.user!.id,
      memberId: med.memberId,
      medicationId,
      medicationName: med.name,
      scheduledAt,
      status,
      respondedAt: new Date().toISOString(),
      ...(note ? { note: String(note) } : {}),
    };
    adherence.push(entry);
  } else {
    entry.status = status;
    entry.respondedAt = new Date().toISOString();
    if (note) entry.note = String(note);
  }

  await persistState();
  res.json(entry);
});

// -------------------------------------------------------------
// Vitals
// -------------------------------------------------------------

clinicalRouter.get('/vitals', (req: Request, res: Response) => {
  const { memberId, type, hours } = req.query;
  const since = Date.now() - (Number(hours) > 0 ? Number(hours) : 24) * 3600000;
  let list = vitals.filter(
    (v) => v.userId === req.user!.id && new Date(v.measuredAt).getTime() >= since
  );
  if (memberId) list = list.filter((v) => v.memberId === memberId);
  if (type) list = list.filter((v) => v.type === type);

  res.json(
    list.sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime())
  );
});

clinicalRouter.post('/vitals', async (req: Request, res: Response) => {
  const { memberId, type, value, secondaryValue, unit, measuredAt, source, context, deviceId } =
    req.body || {};

  if (!memberId || !type || value === undefined || value === null) {
    return res.status(400).json({ error: 'Family member, type and value are required.' });
  }
  const member = ownedMember(req, memberId);
  if (!member) {
    return res.status(403).json({ error: 'You can only record vitals for your own family members.' });
  }

  const validTypes: VitalType[] = [
    'heart_rate',
    'steps',
    'spo2',
    'blood_pressure',
    'sleep_hours',
    'weight',
    'temperature',
  ];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `Vital type must be one of: ${validTypes.join(', ')}.` });
  }

  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return res.status(400).json({ error: 'Value must be a number.' });
  }

  const vitalType = type as VitalType;
  const vital: Vital = {
    id: `vit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId: req.user!.id,
    memberId,
    type: vitalType,
    value: numeric,
    ...(secondaryValue !== undefined ? { secondaryValue: Number(secondaryValue) } : {}),
    unit: unit || VITAL_UNITS[vitalType],
    measuredAt: measuredAt || new Date().toISOString(),
    source: source || 'manual',
    ...(deviceId ? { deviceId: String(deviceId) } : {}),
    context: context || 'unknown',
  };

  vitals.push(vital);
  await persistStateSafely();

  // A new heart-rate reading is evaluated against the personal baseline
  // and may raise an alert.
  const alert = await evaluateVitalsAndAlert(req.user!.id, memberId, vital);

  res.status(201).json({ vital, alert });
});

// -------------------------------------------------------------
// Prescription upload
// -------------------------------------------------------------

clinicalRouter.post('/prescriptions/analyze', async (req: Request, res: Response) => {
  const { memberId, imageBase64, imageMimeType, prescriptionText, commit } = req.body || {};

  if (!memberId) return res.status(400).json({ error: 'Family member is required.' });
  const member = ownedMember(req, memberId);
  if (!member) {
    return res.status(403).json({ error: 'You can only upload records for your own family members.' });
  }
  if (!imageBase64 && !prescriptionText) {
    return res.status(400).json({ error: 'Upload a prescription image or paste the prescription text.' });
  }

  try {
    const result = await analyzePrescription({
      userId: req.user!.id,
      memberId,
      imageBase64,
      imageMimeType,
      prescriptionText,
    });

    let created: Medication[] = [];
    let createdAllergies = 0;

    // Only write to the ledger when the user explicitly commits.
    if (commit === true) {
      for (const extracted of result.extraction.medications) {
        if (!extracted.name) continue;
        const medication: Medication = {
          id: `med-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          userId: req.user!.id,
          memberId,
          name: extracted.name,
          ...(extracted.genericName ? { genericName: extracted.genericName } : {}),
          dose: extracted.dose || '',
          frequency: extracted.frequency || 'As directed',
          times: extracted.times || [],
          ...(extracted.route ? { route: extracted.route } : {}),
          ...(extracted.instructions ? { instructions: extracted.instructions } : {}),
          startDate: new Date().toISOString().slice(0, 10),
          active: true,
          source: 'prescription_upload',
          createdAt: new Date().toISOString(),
        };
        medications.push(medication);
        created.push(medication);
      }

      for (const extractedAllergy of result.extraction.allergies) {
        if (!extractedAllergy.substance) continue;
        const exists = allergies.find(
          (a) =>
            a.memberId === memberId &&
            a.substance.toLowerCase() === extractedAllergy.substance.toLowerCase()
        );
        if (exists) continue;
        allergies.push({
          id: `alg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          userId: req.user!.id,
          memberId,
          substance: extractedAllergy.substance,
          ...(extractedAllergy.reaction ? { reaction: extractedAllergy.reaction } : {}),
          severity: extractedAllergy.severity || 'unknown',
          verifiedAt: new Date().toISOString().slice(0, 10),
          source: 'prescription_upload',
          createdAt: new Date().toISOString(),
        });
        createdAllergies++;
      }

      await persistState();
    }

    res.json({
      extraction: result.extraction,
      safety: {
        highestSeverity: result.safety.check.highestSeverity,
        findings: result.safety.check.findings,
        notes: result.safety.notes,
        message: severityLabel(result.safety.check.highestSeverity),
      },
      committed: commit === true,
      createdMedications: created,
      createdAllergies,
      degraded: result.degraded,
    });
  } catch (error: any) {
    console.error('Prescription analysis failed:', error);
    res.status(502).json({
      error:
        'The prescription could not be read right now. No medication was recorded, and nothing was assumed about the document.',
    });
  }
});

// -------------------------------------------------------------
// Safety ledger
// -------------------------------------------------------------

clinicalRouter.get('/safety/checks', (req: Request, res: Response) => {
  const { memberId } = req.query;
  let list = safetyChecks.filter((c) => c.userId === req.user!.id);
  if (memberId) list = list.filter((c) => c.memberId === memberId);
  res.json(list.slice(0, 50));
});

clinicalRouter.post('/safety/check', async (req: Request, res: Response) => {
  const { memberId, medications: incoming } = req.body || {};
  if (!memberId || !Array.isArray(incoming) || incoming.length === 0) {
    return res.status(400).json({ error: 'Family member and a medication list are required.' });
  }
  const member = ownedMember(req, memberId);
  if (!member) return res.status(403).json({ error: 'Family member not found.' });

  const result = await runSafetyCheck({
    userId: req.user!.id,
    memberId,
    incoming: incoming.map((m: any) => ({ name: String(m.name), dose: m.dose })),
    trigger: 'manual',
    sourceLabel: 'Manual safety check',
  });

  res.json({
    highestSeverity: result.check.highestSeverity,
    findings: result.check.findings,
    notes: result.notes,
    message: severityLabel(result.check.highestSeverity),
  });
});
