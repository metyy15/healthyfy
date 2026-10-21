import { Type } from '@google/genai';
import { generateJson, isAiConfigured } from './providers';
import { runSafetyCheck, SafetyCheckResult } from './safety';

// -------------------------------------------------------------
// Prescription understanding
//
// Reads a photo or scan of a prescription and turns it into
// structured medication records, then runs every extracted drug
// through the safety engine before anything is written to the
// member's medication ledger.
// -------------------------------------------------------------

export interface ExtractedMedication {
  name: string;
  genericName?: string;
  dose: string;
  frequency: string;
  times: string[];
  route?: string;
  duration?: string;
  instructions?: string;
  /** 0-1. Anything below 0.7 is flagged for human verification. */
  confidence: number;
  /** Set when the name was read from a brand label. */
  brandName?: string;
}

export interface ExtractedAllergy {
  substance: string;
  reaction?: string;
  severity: 'mild' | 'moderate' | 'severe' | 'unknown';
  confidence: number;
}

export interface PrescriptionExtraction {
  prescriber?: string;
  clinic?: string;
  date?: string;
  medications: ExtractedMedication[];
  allergies: ExtractedAllergy[];
  conditionsMentioned: string[];
  notes?: string;
  documentQuality: 'clear' | 'partial' | 'illegible';
  /** Items the model was not confident about. */
  needsVerification: string[];
}

const EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    prescriber: { type: Type.STRING, description: "Prescriber's name, or empty string if not visible." },
    clinic: { type: Type.STRING, description: 'Clinic or pharmacy name, or empty string.' },
    date: { type: Type.STRING, description: 'Prescription date in YYYY-MM-DD, or empty string.' },
    medications: {
      type: Type.ARRAY,
      description: 'Every medication listed on the prescription.',
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: 'Medication name exactly as written.' },
          brandName: { type: Type.STRING, description: 'Brand name if the document shows one, otherwise empty.' },
          genericName: { type: Type.STRING, description: 'Generic (salt) name if identifiable, otherwise empty.' },
          dose: { type: Type.STRING, description: 'Strength, e.g. "500 mg".' },
          frequency: { type: Type.STRING, description: 'e.g. "Twice daily after meals".' },
          times: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Dose times as 24h HH:MM when the document states them, otherwise an empty array.',
          },
          route: { type: Type.STRING, description: 'e.g. oral, topical, inhaled. Empty string if unclear.' },
          duration: { type: Type.STRING, description: 'e.g. "5 days". Empty string if not stated.' },
          instructions: { type: Type.STRING, description: 'Any instruction written on the prescription.' },
          confidence: {
            type: Type.NUMBER,
            description: 'Confidence in this extraction from 0 to 1. Use a low value for handwriting you are unsure about.',
          },
        },
        required: ['name', 'dose', 'frequency', 'times', 'confidence'],
      },
    },
    allergies: {
      type: Type.ARRAY,
      description: 'Allergies or intolerances written anywhere on the document.',
      items: {
        type: Type.OBJECT,
        properties: {
          substance: { type: Type.STRING },
          reaction: { type: Type.STRING },
          severity: { type: Type.STRING, enum: ['mild', 'moderate', 'severe', 'unknown'] },
          confidence: { type: Type.NUMBER },
        },
        required: ['substance', 'severity', 'confidence'],
      },
    },
    conditionsMentioned: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Diagnoses or conditions written on the document.',
    },
    notes: { type: Type.STRING, description: 'Anything else clinically relevant on the document.' },
    documentQuality: {
      type: Type.STRING,
      enum: ['clear', 'partial', 'illegible'],
      description: 'How readable the document was overall.',
    },
    needsVerification: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Specific items that a human should confirm, e.g. "Dose of tablet 3 is unclear".',
    },
  },
  required: ['medications', 'allergies', 'conditionsMentioned', 'documentQuality', 'needsVerification'],
};

const EXTRACTION_PROMPT = `
You are a clinical pharmacist reading a prescription document (photograph or scan) for a personal health record.

Extract the medication information faithfully. Rules:
1. Read only what is on the document. Never infer a dose, a frequency or a drug that is not written.
2. If handwriting is unclear for a particular field, still record the name, put your best reading in the field, and set that item's confidence low (below 0.5). List the item in needsVerification.
3. Preserve the exact drug name as written. If a brand name is shown, put it in brandName and put the generic salt name in genericName when you can identify it with confidence.
4. Convert dose times to 24-hour HH:MM when the document gives a time (for example "8:30 PM" becomes "20:30"). Leave the array empty when no times are written.
5. Record every allergy or intolerance written anywhere on the document, including ones the pharmacist marked.
6. If the document is a medication list rather than a prescription, treat each line as a medication.
7. Return the structured object only.
`;

export interface PrescriptionAnalysisResult {
  extraction: PrescriptionExtraction;
  safety: SafetyCheckResult;
  /** True when the AI service was unavailable and a fallback ran. */
  degraded: boolean;
}

export async function analyzePrescription(params: {
  userId: string;
  memberId: string;
  imageBase64?: string;
  imageMimeType?: string;
  prescriptionText?: string;
}): Promise<PrescriptionAnalysisResult> {
  const { userId, memberId } = params;

  let extraction: PrescriptionExtraction;

  if (isAiConfigured() && (params.imageBase64 || params.prescriptionText)) {
    const inlineParts =
      params.imageBase64 && params.imageMimeType
        ? [
            {
              mimeType: params.imageMimeType,
              data: params.imageBase64.replace(/^data:[^;]+;base64,/, ''),
            },
          ]
        : [];

    const prompt = params.prescriptionText
      ? `${EXTRACTION_PROMPT}\n\nHere is the prescription text:\n${params.prescriptionText}`
      : EXTRACTION_PROMPT;

    // Reading a prescription is a vision task, so this uses the vision
    // provider chain rather than the general one.
    const result = await generateJson<PrescriptionExtraction>(
      {
        prompt,
        schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
        inlineParts,
        systemInstruction:
          'You extract medication information from prescriptions with clinical accuracy. When a field cannot be read, say so with low confidence rather than guessing.',
      },
      'vision'
    );
    extraction = result.data;
  } else {
    extraction = fallbackExtraction(params.prescriptionText || '');
  }

  // A model can return a well-formed JSON object that does not match the
  // requested shape. Normalise it rather than letting it crash the upload.
  extraction = normaliseExtraction(extraction);

  const safety = await runSafetyCheck({
    userId,
    memberId,
    incoming: extraction.medications.map((m) => ({ name: m.name, dose: m.dose })),
    trigger: 'prescription_upload',
    sourceLabel: `Prescription uploaded ${new Date().toLocaleDateString('en-GB')}`,
  });

  return {
    extraction,
    safety,
    degraded: !isAiConfigured(),
  };
}

/**
 * Forces the extraction into the expected shape. Anything the model
 * returned in an unexpected form is treated as absent rather than
 * trusted, and the user is told to verify.
 */
function normaliseExtraction(raw: any): PrescriptionExtraction {
  const extraction: PrescriptionExtraction = {
    prescriber: typeof raw?.prescriber === 'string' ? raw.prescriber : undefined,
    clinic: typeof raw?.clinic === 'string' ? raw.clinic : undefined,
    date: typeof raw?.date === 'string' ? raw.date : undefined,
    medications: [],
    allergies: [],
    conditionsMentioned: [],
    notes: typeof raw?.notes === 'string' ? raw.notes : undefined,
    documentQuality: ['clear', 'partial', 'illegible'].includes(raw?.documentQuality)
      ? raw.documentQuality
      : 'partial',
    needsVerification: [],
  };

  const rawMeds = Array.isArray(raw?.medications) ? raw.medications : [];
  for (const item of rawMeds) {
    if (!item || typeof item.name !== 'string' || !item.name.trim()) continue;
    extraction.medications.push({
      name: item.name.trim(),
      ...(typeof item.genericName === 'string' ? { genericName: item.genericName } : {}),
      ...(typeof item.brandName === 'string' ? { brandName: item.brandName } : {}),
      dose: typeof item.dose === 'string' ? item.dose : '',
      frequency: typeof item.frequency === 'string' ? item.frequency : 'As directed',
      times: Array.isArray(item.times)
        ? item.times.filter((t: unknown) => typeof t === 'string')
        : [],
      ...(typeof item.route === 'string' ? { route: item.route } : {}),
      ...(typeof item.duration === 'string' ? { duration: item.duration } : {}),
      ...(typeof item.instructions === 'string' ? { instructions: item.instructions } : {}),
      confidence:
        typeof item.confidence === 'number' && Number.isFinite(item.confidence)
          ? Math.max(0, Math.min(1, item.confidence))
          : 0.5,
    });
  }

  const rawAllergies = Array.isArray(raw?.allergies) ? raw.allergies : [];
  for (const item of rawAllergies) {
    if (!item || typeof item.substance !== 'string' || !item.substance.trim()) continue;
    extraction.allergies.push({
      substance: item.substance.trim(),
      ...(typeof item.reaction === 'string' ? { reaction: item.reaction } : {}),
      severity: ['mild', 'moderate', 'severe', 'unknown'].includes(item.severity)
        ? item.severity
        : 'unknown',
      confidence:
        typeof item.confidence === 'number' && Number.isFinite(item.confidence)
          ? Math.max(0, Math.min(1, item.confidence))
          : 0.5,
    });
  }

  extraction.conditionsMentioned = Array.isArray(raw?.conditionsMentioned)
    ? raw.conditionsMentioned.filter((c: unknown) => typeof c === 'string')
    : [];
  extraction.needsVerification = Array.isArray(raw?.needsVerification)
    ? raw.needsVerification.filter((n: unknown) => typeof n === 'string')
    : [];

  if (extraction.medications.length === 0 && extraction.allergies.length === 0) {
    extraction.needsVerification.push(
      'No medication or allergy could be read from this document. Nothing was recorded.'
    );
  }

  return extraction;
}

/**
 * Minimal parser used when the AI service is unavailable, so the
 * prescription flow still records something rather than failing.
 */
function fallbackExtraction(text: string): PrescriptionExtraction {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const medications: ExtractedMedication[] = [];
  for (const line of lines) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9\- ]{2,40}?)\s+(\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|%))\b(.*)$/i);
    if (!match) continue;
    const [, name, dose, , , rest] = match;
    const times: string[] = [];
    const timeMatch = rest.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1], 10);
      const minute = timeMatch[2];
      const meridiem = (timeMatch[3] || '').toLowerCase();
      if (meridiem === 'pm' && hour < 12) hour += 12;
      if (meridiem === 'am' && hour === 12) hour = 0;
      times.push(`${String(hour).padStart(2, '0')}:${minute}`);
    }
    medications.push({
      name: name.trim(),
      dose: dose.trim(),
      frequency: rest.replace(/\b\d{1,2}[:.]\d{2}\s*(am|pm)?\b/gi, '').trim() || 'As directed',
      times,
      confidence: 0.45,
    });
  }

  return {
    medications,
    allergies: [],
    conditionsMentioned: [],
    documentQuality: 'partial',
    needsVerification: [
      'The AI service is not configured, so this extraction came from a basic text parser. Verify every field.',
    ],
  };
}
