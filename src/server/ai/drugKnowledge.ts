// -------------------------------------------------------------
// Clinical drug knowledge base
//
// The interaction check runs offline against this curated knowledge
// base so the safety engine is deterministic, reproducible and works
// without third-party API credentials. Live services (RxNorm for name
// canonicalisation) are used only to enrich the names before the
// local rules are applied.
//
// The rules below reflect widely published, clinically accepted
// guidance. They support a safety conversation with a prescriber;
// they are not a clinical decision support replacement.
// -------------------------------------------------------------

export type Severity = 'none' | 'low' | 'moderate' | 'high';

export interface DrugClass {
  id: string;
  label: string;
  /** Generic names that belong to this class. */
  members: string[];
  /** Allergy substance names that should match this class. */
  allergyLabels: string[];
}

export const DRUG_CLASSES: DrugClass[] = [
  {
    id: 'penicillin',
    label: 'Penicillin-class antibiotics',
    members: [
      'penicillin',
      'penicillin v',
      'benzpenicillin',
      'amoxicillin',
      'amoxicillin clavulanate',
      'clavulanic acid',
      'ampicillin',
      'ampicillin sulbactam',
      'piperacillin',
      'piperacillin tazobactam',
      'cloxacillin',
      'dicloxacillin',
      'nafcillin',
      'oxacillin',
    ],
    allergyLabels: ['penicillin', 'penicillins', 'penicilline'],
  },
  {
    id: 'cephalosporin',
    label: 'Cephalosporin-class antibiotics',
    members: [
      'cephalexin',
      'cefixime',
      'cefuroxime',
      'ceftriaxone',
      'cefaclor',
      'cefepime',
      'ceftazidime',
    ],
    allergyLabels: ['cephalosporin', 'cephalosporins', 'cefixime', 'cephalexin'],
  },
  {
    id: 'sulfonamide',
    label: 'Sulfa-class antibiotics',
    members: [
      'sulfamethoxazole',
      'trimethoprim sulfamethoxazole',
      'co trimoxazole',
      'cotrimoxazole',
      'sulfasalazine',
      'sulfadiazine',
      'sulfisoxazole',
    ],
    allergyLabels: ['sulfa drugs', 'sulfa', 'sulfonamides', 'sulphonamide', 'co-trimoxazole'],
  },
  {
    id: 'nsaid',
    label: 'Non-steroidal anti-inflammatory drugs (NSAIDs)',
    members: [
      'ibuprofen',
      'diclofenac',
      'naproxen',
      'ketoprofen',
      'ketorolac',
      'celecoxib',
      'indomethacin',
      'mefenamic acid',
      'aspirin',
    ],
    allergyLabels: ['nsaid', 'nsaids', 'ibuprofen', 'aspirin', 'naproxen', 'diclofenac'],
  },
  {
    id: 'macrolide',
    label: 'Macrolide antibiotics',
    members: ['erythromycin', 'azithromycin', 'clarithromycin', 'roxithromycin'],
    allergyLabels: ['macrolide', 'macrolides', 'erythromycin', 'azithromycin'],
  },
  {
    id: 'aminoglycoside',
    label: 'Aminoglycoside antibiotics',
    members: ['gentamicin', 'amikacin', 'streptomycin', 'tobramycin', 'netilmicin'],
    allergyLabels: ['aminoglycoside', 'aminoglycosides', 'gentamicin', 'streptomycin'],
  },
  {
    id: 'biguanide',
    label: 'Biguanide (metformin)',
    members: ['metformin', 'metformin hydrochloride'],
    allergyLabels: ['metformin'],
  },
  {
    id: 'sulfonylurea',
    label: 'Sulfonylureas',
    members: ['glimepiride', 'glipizide', 'gliclazide', 'glyburide', 'glyburide'],
    allergyLabels: ['sulfonylurea', 'sulfonylureas', 'glimepiride'],
  },
  {
    id: 'statin',
    label: 'Statins (HMG-CoA reductase inhibitors)',
    members: [
      'atorvastatin',
      'rosuvastatin',
      'simvastatin',
      'pravastatin',
      'pitavastatin',
      'fluvastatin',
    ],
    allergyLabels: ['statin', 'statins', 'atorvastatin', 'simvastatin'],
  },
  {
    id: 'acei',
    label: 'ACE inhibitors',
    members: ['ramipril', 'lisinopril', 'enalapril', 'captopril', 'perindopril'],
    allergyLabels: ['ace inhibitor', 'ace inhibitors', 'ramipril', 'lisinopril'],
  },
  {
    id: 'arb',
    label: 'Angiotensin receptor blockers (ARBs)',
    members: [
      'telmisartan',
      'losartan',
      'olmesartan',
      'valsartan',
      'candesartan',
      'azilsartan',
    ],
    allergyLabels: ['arb', 'arbs', 'telmisartan', 'losartan', 'valsartan'],
  },
  {
    id: 'potassium_sparing_diuretic',
    label: 'Potassium-sparing diuretics',
    members: ['spironolactone', 'eplerenone', 'amiloride', 'triamterene'],
    allergyLabels: ['spironolactone', 'eplerenone'],
  },
  {
    id: 'loop_diuretic',
    label: 'Loop diuretics',
    members: ['furosemide', 'torsemide', 'bumetanide'],
    allergyLabels: ['furosemide', 'loop diuretic'],
  },
  {
    id: 'thyroid_hormone',
    label: 'Thyroid hormones',
    members: ['levothyroxine', 'thyronorm', 'liothyronine', 'desiccated thyroid'],
    allergyLabels: ['levothyroxine', 'thyroid hormone'],
  },
  {
    id: 'vitamin_mineral',
    label: 'Calcium / iron / mineral supplements',
    members: [
      'calcium',
      'calcium carbonate',
      'calcium citrate',
      'cholecalciferol',
      'vitamin d3',
      'ferrous sulfate',
      'ferrous ascorbate',
      'ferrous fumarate',
      'iron',
    ],
    allergyLabels: ['iron', 'calcium', 'vitamin d'],
  },
  {
    id: 'bronchodilator',
    label: 'Short-acting bronchodilators',
    members: ['salbutamol', 'albuterol', 'terbutaline'],
    allergyLabels: ['salbutamol', 'albuterol'],
  },
  {
    id: 'anticoagulant',
    label: 'Anticoagulants',
    members: ['warfarin', 'acenocoumarol', 'dabigatran', 'apixaban', 'rivaroxaban', 'heparin'],
    allergyLabels: ['warfarin', 'anticoagulant', 'blood thinner'],
  },
  {
    id: 'antiplatelet',
    label: 'Antiplatelets',
    members: ['aspirin', 'clopidogrel', 'ticagrelor', 'prasugrel'],
    allergyLabels: ['aspirin', 'clopidogrel', 'antiplatelet'],
  },
  {
    id: 'ppi',
    label: 'Proton pump inhibitors',
    members: ['omeprazole', 'pantoprazole', 'esomeprazole', 'ranitidine', 'famotidine'],
    allergyLabels: ['omeprazole', 'pantoprazole'],
  },
  {
    id: 'ssri',
    label: 'SSRIs',
    members: ['sertraline', 'paroxetine', 'fluoxetine', 'citalopram', 'escitalopram'],
    allergyLabels: ['ssri', 'ssris', 'sertraline'],
  },
  {
    id: 'opioid',
    label: 'Opioid analgesics',
    members: ['tramadol', 'codeine', 'morphine', 'oxycodone', 'fentanyl', 'tapentadol'],
    allergyLabels: ['opioid', 'opioids', 'codeine', 'morphine', 'tramadol'],
  },
  {
    id: 'bisphosphonate',
    label: 'Bisphosphonates',
    members: ['alendronate', 'risedronate', 'zoledronic acid', 'ibandronate'],
    allergyLabels: ['bisphosphonate', 'alendronate'],
  },
  {
    id: 'nitrate',
    label: 'Nitrates',
    members: ['nitroglycerin', 'isosorbide mononitrate', 'isosorbide dinitrate'],
    allergyLabels: ['nitrate', 'nitroglycerin'],
  },
  {
    id: 'pde5',
    label: 'PDE5 inhibitors',
    members: ['sildenafil', 'tadalafil', 'vardenafil'],
    allergyLabels: ['sildenafil', 'tadalafil'],
  },
];

// -------------------------------------------------------------
// Brand name -> generic name
// -------------------------------------------------------------

export const BRAND_TO_GENERIC: Record<string, string> = {
  glycomet: 'metformin',
  'glycomet gp': 'metformin',
  'glycomet gp1': 'metformin',
  glucophage: 'metformin',
  'glucophage xr': 'metformin',
  cetrimet: 'metformin',
  'metformin sr': 'metformin',
  telma: 'telmisartan',
  micardis: 'telmisartan',
  rinex: 'telmisartan',
  thyronorm: 'levothyroxine',
  eltroxin: 'levothyroxine',
  synthroid: 'levothyroxine',
  roxicod: 'levothyroxine',
  shanroxin: 'levothyroxine',
  daonil: 'glyburide',
  euglucon: 'glimepiride',
  gleevac: 'imatinib',
  amaryl: 'glimepiride',
  aldactone: 'spironolactone',
  lasix: 'furosemide',
  zestoretic: 'lisinopril',
  zestril: 'lisinopril',
  ramace: 'ramipril',
  cardace: 'ramipril',
  norvasc: 'amlodipine',
  prilosec: 'omeprazole',
  pantoloc: 'pantoprazole',
  zantac: 'ranitidine',
  coumadin: 'warfarin',
  augmentin: 'amoxicillin clavulanate',
  amoxil: 'amoxicillin',
  rocephin: 'ceftriaxone',
  suprax: 'cefixime',
  keflex: 'cephalexin',
  bactrim: 'trimethoprim sulfamethoxazole',
  septran: 'trimethoprim sulfamethoxazole',
  cipro: 'ciprofloxacin',
  zithromax: 'azithromycin',
  clarinex: 'clarithromycin',
  erythrocin: 'erythromycin',
  crestor: 'rosuvastatin',
  lipitor: 'atorvastatin',
  zocor: 'simvastatin',
  mevacor: 'pravastatin',
  cozaar: 'losartan',
  diovan: 'valsartan',
  benicar: 'olmesartan',
  ventolin: 'salbutamol',
  duoneb: 'albuterol',
  bricanyl: 'terbutaline',
  fosamax: 'alendronate',
  restoril: 'temazepam',
  soma: 'carisoprodol',
  zoloft: 'sertraline',
  paxil: 'paroxetine',
  prozac: 'fluoxetine',
  ultram: 'tramadol',
  norco: 'hydrocodone',
  viagra: 'sildenafil',
  cordarone: 'amiodarone',
  plaquenil: 'hydroxychloroquine',
  indocid: 'indomethacin',
  voltaren: 'diclofenac',
  advil: 'ibuprofen',
  motrin: 'ibuprofen',
  naprosyn: 'naproxen',
  celebrex: 'celecoxib',
  'vitamin d3': 'cholecalciferol',
  'calcium d3': 'calcium carbonate',
  shan: 'calcium carbonate',
  'calcium + vitamin d3': 'calcium carbonate',
  'vitamin d3 + calcium': 'calcium carbonate',
};

// -------------------------------------------------------------
// Drug-drug interaction rules
//
// `drugs` matches on canonical generic names. `classes` matches on
// drug class membership, which covers the many members of a family
// (every NSAID, every macrolide, ...).
// -------------------------------------------------------------

export interface InteractionRule {
  id: string;
  drugs?: [string, string];
  classes?: [string, string];
  severity: Severity;
  description: string;
  source: string;
}

export const INTERACTION_RULES: InteractionRule[] = [
  {
    id: 'warfarin-aspirin',
    drugs: ['warfarin', 'aspirin'],
    severity: 'high',
    description:
      'Combining an anticoagulant with an antiplatelet markedly increases bleeding risk, including gastrointestinal and intracranial haemorrhage.',
    source: 'Standard anticoagulant + antiplatelet guidance',
  },
  {
    id: 'warfarin-nsaid',
    classes: ['anticoagulant', 'nsaid'],
    severity: 'high',
    description:
      'NSAIDs taken with warfarin substantially raise gastrointestinal bleeding risk and can reduce the anticoagulant effect.',
    source: 'Standard anticoagulant + NSAID guidance',
  },
  {
    id: 'warfarin-nsaid-class',
    classes: ['anticoagulant', 'nsaid'],
    severity: 'high',
    description:
      'NSAIDs taken with warfarin substantially raise gastrointestinal bleeding risk and can reduce the anticoagulant effect.',
    source: 'Standard anticoagulant + NSAID guidance',
  },
  {
    id: 'dupl-nsaid',
    classes: ['nsaid', 'nsaid'],
    severity: 'moderate',
    description:
      'Two different NSAIDs together rarely add benefit and double the risk of stomach bleeding, kidney injury and blood pressure problems.',
    source: 'Duplicate therapy guidance',
  },
  {
    id: 'metformin-contrast',
    drugs: ['metformin', 'iodinated contrast'],
    severity: 'high',
    description:
      'Iodinated contrast can cause lactic acidosis in people taking metformin. Metformin is usually withheld around the contrast study and restarted once kidney function is rechecked.',
    source: 'Metformin and contrast media guidance',
  },
  {
    id: 'metformin-contrast-media',
    drugs: ['metformin', 'contrast media'],
    severity: 'high',
    description:
      'Iodinated contrast can cause lactic acidosis in people taking metformin. Metformin is usually withheld around the contrast study and restarted once kidney function is rechecked.',
    source: 'Metformin and contrast media guidance',
  },
  {
    id: 'metformin-iohexol',
    drugs: ['metformin', 'iohexol'],
    severity: 'high',
    description:
      'Iodinated contrast can cause lactic acidosis in people taking metformin. Metformin is usually withheld around the contrast study and restarted once kidney function is rechecked.',
    source: 'Metformin and contrast media guidance',
  },
  {
    id: 'metformin-iopamidol',
    drugs: ['metformin', 'iopamidol'],
    severity: 'high',
    description:
      'Iodinated contrast can cause lactic acidosis in people taking metformin. Metformin is usually withheld around the contrast study and restarted once kidney function is rechecked.',
    source: 'Metformin and contrast media guidance',
  },
  {
    id: 'metformin-alcohol',
    drugs: ['metformin', 'alcohol'],
    severity: 'moderate',
    description:
      'Alcohol with metformin can trigger a disulfiram-like reaction (flushing, nausea) and adds to the risk of lactic acidosis and low blood sugar.',
    source: 'Metformin and alcohol guidance',
  },
  {
    id: 'metformin-ciprofloxacin',
    drugs: ['metformin', 'ciprofloxacin'],
    severity: 'moderate',
    description:
      'Fluoroquinolones can cause unpredictable swings in blood sugar, which is riskier in people on metformin for type 2 diabetes.',
    source: 'Fluoroquinolone and glycaemic control guidance',
  },
  {
    id: 'dual-raas',
    classes: ['arb', 'acei'],
    severity: 'moderate',
    description:
      'Combining an ARB with an ACE inhibitor (dual RAAS blockade) raises the risk of high potassium, low blood pressure and kidney injury without improving outcomes.',
    source: 'Dual RAAS blockade guidance',
  },
  {
    id: 'arb-potassium-sparing',
    classes: ['arb', 'potassium_sparing_diuretic'],
    severity: 'moderate',
    description:
      'An ARB with a potassium-sparing diuretic raises the risk of hyperkalaemia, particularly with kidney impairment.',
    source: 'Hyperkalaemia risk guidance',
  },
  {
    id: 'acei-potassium-sparing',
    classes: ['acei', 'potassium_sparing_diuretic'],
    severity: 'moderate',
    description:
      'An ACE inhibitor with a potassium-sparing diuretic raises the risk of hyperkalaemia, particularly with kidney impairment.',
    source: 'Hyperkalaemia risk guidance',
  },
  {
    id: 'arb-nsaid',
    classes: ['arb', 'nsaid'],
    severity: 'moderate',
    description:
      'NSAIDs can blunt the blood-pressure-lowering effect of an ARB and add to kidney risk, especially in older adults.',
    source: 'ARB and NSAID guidance',
  },
  {
    id: 'acei-nsaid',
    classes: ['acei', 'nsaid'],
    severity: 'moderate',
    description:
      'NSAIDs can blunt the blood-pressure-lowering effect of an ACE inhibitor and add to kidney risk.',
    source: 'ACE inhibitor and NSAID guidance',
  },
  {
    id: 'macrolide-statin',
    classes: ['macrolide', 'statin'],
    severity: 'high',
    description:
      'Macrolide antibiotics inhibit the enzyme that clears several statins, which can cause muscle breakdown (rhabdomyolysis). Statin dose is usually reduced or paused during the course.',
    source: 'CYP3A4 interaction guidance',
  },
  {
    id: 'levothyroxine-calcium',
    classes: ['thyroid_hormone', 'vitamin_mineral'],
    severity: 'moderate',
    description:
      'Calcium, iron and antacids bind levothyroxine in the gut and reduce absorption. Separate the thyroid dose from calcium, iron and multivitamins by at least 4 hours.',
    source: 'Levothyroxine administration guidance',
  },
  {
    id: 'levothyroxine-ppi',
    drugs: ['levothyroxine', 'omeprazole'],
    severity: 'moderate',
    description:
      'Proton pump inhibitors can reduce levothyroxine absorption. Thyroid function should be rechecked after starting a PPI.',
    source: 'Levothyroxine administration guidance',
  },
  {
    id: 'ssri-opioid',
    classes: ['ssri', 'opioid'],
    severity: 'high',
    description:
      'An SSRI combined with tramadol or codeine raises the risk of serotonin syndrome (agitation, tremor, fever, confusion).',
    source: 'Serotonin syndrome guidance',
  },
  {
    id: 'ssri-nsaid',
    classes: ['ssri', 'nsaid'],
    severity: 'moderate',
    description:
      'SSRIs reduce platelet aggregation, so combining them with NSAIDs further increases gastrointestinal bleeding risk.',
    source: 'SSRIs and bleeding risk guidance',
  },
  {
    id: 'pde5-nitrate',
    classes: ['pde5', 'nitrate'],
    severity: 'high',
    description:
      'A PDE5 inhibitor with a nitrate can cause a sudden, dangerous fall in blood pressure. The combination is contraindicated.',
    source: 'Contraindicated combination guidance',
  },
  {
    id: 'digoxin-furosemide',
    drugs: ['digoxin', 'furosemide'],
    severity: 'moderate',
    description:
      'Furosemide lowers potassium, and low potassium makes the heart more sensitive to digoxin, risking digoxin toxicity (nausea, visual changes, arrhythmia).',
    source: 'Digoxin and electrolyte guidance',
  },
  {
    id: 'digoxin-amiodarone',
    drugs: ['digoxin', 'amiodarone'],
    severity: 'high',
    description:
      'Amiodarone raises digoxin levels, which can precipitate digoxin toxicity. The digoxin dose is usually halved when they are combined.',
    source: 'Digoxin and amiodarone guidance',
  },
  {
    id: 'methotrexate-trimethoprim',
    drugs: ['methotrexate', 'trimethoprim sulfamethoxazole'],
    severity: 'high',
    description:
      'Trimethoprim blocks folate metabolism and can cause severe bone marrow suppression and pancytopenia with methotrexate.',
    source: 'Methotrexate interaction guidance',
  },
  {
    id: 'amiodarone-simvastatin',
    drugs: ['amiodarone', 'simvastatin'],
    severity: 'high',
    description:
      'Amiodarone markedly raises simvastatin levels and the risk of muscle breakdown. Simvastatin is normally capped at 20 mg/day with amiodarone.',
    source: 'Statin dose cap guidance',
  },
  {
    id: 'clopidogrel-ppi',
    drugs: ['clopidogrel', 'omeprazole'],
    severity: 'moderate',
    description:
      'Omeprazole reduces the antiplatelet effect of clopidogrel. Pantoprazole is usually preferred when a proton pump inhibitor is needed.',
    source: 'Clopidogrel and PPI guidance',
  },
  {
    id: 'sulfonylurea-macrolide',
    classes: ['sulfonylurea', 'macrolide'],
    severity: 'moderate',
    description:
      'Macrolide antibiotics can raise sulfonylurea levels and increase the risk of prolonged low blood sugar.',
    source: 'CYP3A4 interaction guidance',
  },
  {
    id: 'calcium-ciprofloxacin',
    drugs: ['calcium carbonate', 'ciprofloxacin'],
    severity: 'moderate',
    description:
      'Calcium binds fluoroquinolone antibiotics and can sharply reduce their absorption. The antibiotic should be taken at least 2 hours before or 6 hours after calcium.',
    source: 'Quinolone absorption guidance',
  },
  {
    id: 'calcium-levofloxacin',
    drugs: ['calcium carbonate', 'levofloxacin'],
    severity: 'moderate',
    description:
      'Calcium binds fluoroquinolone antibiotics and can sharply reduce their absorption. The antibiotic should be taken at least 2 hours before or 6 hours after calcium.',
    source: 'Quinolone absorption guidance',
  },
  {
    id: 'iron-ciprofloxacin',
    drugs: ['ferrous sulfate', 'ciprofloxacin'],
    severity: 'moderate',
    description:
      'Iron reduces fluoroquinolone absorption. Separate the two doses by at least 2 hours.',
    source: 'Quinolone absorption guidance',
  },
  {
    id: 'iron-levofloxacin',
    drugs: ['ferrous sulfate', 'levofloxacin'],
    severity: 'moderate',
    description:
      'Iron reduces fluoroquinolone absorption. Separate the two doses by at least 2 hours.',
    source: 'Quinolone absorption guidance',
  },
  {
    id: 'calcium-levothyroxine',
    classes: ['vitamin_mineral', 'thyroid_hormone'],
    severity: 'moderate',
    description:
      'Calcium and iron bind levothyroxine and reduce its absorption. Keep a 4 hour gap between the two doses.',
    source: 'Levothyroxine administration guidance',
  },
  {
    id: 'warfarin-nsaid-2',
    classes: ['anticoagulant', 'nsaid'],
    severity: 'high',
    description:
      'NSAIDs taken with warfarin substantially raise gastrointestinal bleeding risk.',
    source: 'Standard anticoagulant + NSAID guidance',
  },
];

// -------------------------------------------------------------
// Condition rules
//
// `contraindications` are reasons to escalate to a prescriber.
// `indications` are expected matches that are reassuring rather than
// alarming (the drug matches a condition the person already has).
// -------------------------------------------------------------

export interface ConditionRule {
  id: string;
  conditionPattern: RegExp;
  drugClasses?: string[];
  drugs?: string[];
  severity: Severity;
  kind: 'contraindication' | 'indication';
  description: string;
  source: string;
}

export const CONDITION_RULES: ConditionRule[] = [
  {
    id: 'metformin-ckd',
    conditionPattern: /(chronic kidney|kidney disease|ckd|renal impairment|renal failure|nephropathy)/i,
    drugClasses: ['biguanide'],
    severity: 'high',
    kind: 'contraindication',
    description:
      'Metformin is contraindicated in advanced kidney impairment because of the risk of lactic acidosis. Kidney function (eGFR) should be reviewed before continuing.',
    source: 'Metformin renal contraindication guidance',
  },
  {
    id: 'nsaid-ckd',
    conditionPattern: /(chronic kidney|kidney disease|ckd|renal impairment|renal failure|nephropathy)/i,
    drugClasses: ['nsaid'],
    severity: 'high',
    kind: 'contraindication',
    description:
      'NSAIDs are generally avoided in kidney impairment because they reduce kidney blood flow and can worsen renal function.',
    source: 'NSAID renal guidance',
  },
  {
    id: 'nsaid-ulcer',
    conditionPattern: /(peptic ulcer|gastric ulcer|gerd|reflux|gastritis|history of ulcers)/i,
    drugClasses: ['nsaid'],
    severity: 'moderate',
    kind: 'contraindication',
    description:
      'NSAIDs irritate the stomach lining and substantially raise the risk of ulcers and gastrointestinal bleeding in people with a history of ulcer or reflux disease.',
    source: 'Gastroprotection guidance',
  },
  {
    id: 'nsaid-asthma',
    conditionPattern: /(asthma|bronchospasm)/i,
    drugClasses: ['nsaid'],
    severity: 'moderate',
    kind: 'contraindication',
    description:
      'NSAIDs can trigger bronchospasm in people with aspirin-sensitive asthma (Samter\'s triad).',
    source: 'NSAID and aspirin-sensitive asthma guidance',
  },
  {
    id: 'raas-pregnancy',
    conditionPattern: /(pregnan|pregnant)/i,
    drugClasses: ['acei', 'arb'],
    severity: 'high',
    kind: 'contraindication',
    description:
      'ACE inhibitors and ARBs are avoided in pregnancy because of risk to fetal kidney development.',
    source: 'Pregnancy contraindication guidance',
  },
  {
    id: 'statin-liver',
    conditionPattern: /(liver disease|hepatic|cirrhosis|liver failure)/i,
    drugClasses: ['statin'],
    severity: 'moderate',
    kind: 'contraindication',
    description:
      'Statins are avoided in active liver disease because of the risk of worsening liver injury.',
    source: 'Statin hepatic guidance',
  },
  {
    id: 'metformin-hypoxia',
    conditionPattern: /(hypoxia|respiratory failure|copd|heart failure|sepsis)/i,
    drugClasses: ['biguanide'],
    severity: 'moderate',
    kind: 'contraindication',
    description:
      'Conditions that reduce tissue oxygenation raise the risk of metformin-associated lactic acidosis.',
    source: 'Metformin lactic acidosis guidance',
  },
  {
    id: 'ind-metformin',
    conditionPattern: /(type 2 diabetes|type ii diabetes|diabetes mellitus|diabetes)/i,
    drugClasses: ['biguanide'],
    severity: 'none',
    kind: 'indication',
    description:
      'Metformin is a first-line treatment for type 2 diabetes, so this is an expected match with the existing condition.',
    source: 'Standard diabetes indication',
  },
  {
    id: 'ind-insulin',
    conditionPattern: /(type 1 diabetes|type i diabetes|diabetes mellitus|diabetes)/i,
    drugs: ['insulin'],
    severity: 'none',
    kind: 'indication',
    description:
      'Insulin is an expected treatment for diabetes, so this is an appropriate match with the existing condition.',
    source: 'Standard diabetes indication',
  },
  {
    id: 'ind-bp',
    conditionPattern: /(hypertension|high blood pressure|bp)/i,
    drugClasses: ['acei', 'arb'],
    severity: 'none',
    kind: 'indication',
    description:
      'An ACE inhibitor or ARB is a standard treatment for hypertension, so this matches the existing condition.',
    source: 'Standard hypertension indication',
  },
  {
    id: 'ind-thyroid',
    conditionPattern: /(hypothyroid|thyroid|hashimoto)/i,
    drugClasses: ['thyroid_hormone'],
    severity: 'none',
    kind: 'indication',
    description:
      'Thyroid hormone replacement is the standard treatment for hypothyroidism, so this is an expected match.',
    source: 'Standard thyroid indication',
  },
  {
    id: 'ind-asthma',
    conditionPattern: /(asthma|bronchospasm|reactive airway)/i,
    drugClasses: ['bronchodilator'],
    severity: 'none',
    kind: 'indication',
    description:
      'A short-acting bronchodilator is an expected reliever medication for asthma.',
    source: 'Standard asthma indication',
  },
  {
    id: 'ind-bone',
    conditionPattern: /(osteopenia|osteoporosis)/i,
    drugClasses: ['bisphosphonate', 'vitamin_mineral'],
    severity: 'none',
    kind: 'indication',
    description:
      'Calcium, vitamin D and bisphosphonates are standard for low bone density, so this is an expected match.',
    source: 'Standard bone density indication',
  },
  {
    id: 'ind-iron',
    conditionPattern: /(iron deficiency|anaemia|anemia|ferritin)/i,
    drugClasses: ['vitamin_mineral'],
    severity: 'none',
    kind: 'indication',
    description:
      'Iron supplementation matches the recorded iron deficiency.',
    source: 'Standard iron deficiency indication',
  },
  {
    id: 'ind-dvt',
    conditionPattern: /(dvt|deep vein thrombosis|atrial fibrillation|af\b)/i,
    drugClasses: ['anticoagulant', 'antiplatelet'],
    severity: 'none',
    kind: 'indication',
    description:
      'Anticoagulant or antiplatelet therapy matches the recorded clotting condition.',
    source: 'Standard anticoagulation indication',
  },
];

// -------------------------------------------------------------
// Allergy class expansion
// -------------------------------------------------------------

export function classIdForAllergyLabel(label: string): string | null {
  const normalized = label.toLowerCase().trim();
  for (const cls of DRUG_CLASSES) {
    if (cls.allergyLabels.includes(normalized)) return cls.id;
    if (cls.members.includes(normalized)) return cls.id;
  }
  // Loose fallback: allergy label contains a class name or a class member.
  for (const cls of DRUG_CLASSES) {
    if (cls.allergyLabels.some((l) => normalized.includes(l))) return cls.id;
    if (cls.members.some((m) => normalized.includes(m))) return cls.id;
  }
  return null;
}
