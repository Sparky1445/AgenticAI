
/* ── Trials 02–06 (synthetic), added for the outer trial fan-out. Generated from tools_gen/trials_def.py ── */
window.CT_DATA.trials = [
 {
  "id": "TRIAL01",
  "short": "Oral add-on (metformin)",
  "title": "Oral add-on therapy for type 2 diabetes on metformin",
  "overview": "Phase 3 study of an oral add-on therapy for adults with type 2 diabetes inadequately controlled on metformin."
 },
 {
  "id": "TRIAL02",
  "short": "Weight management",
  "title": "Weight management in type 2 diabetes with obesity",
  "overview": "Phase 3 study of an oral weight-management therapy for adults with type 2 diabetes and obesity. A patient must satisfy every inclusion criterion and trigger no exclusion criterion to be eligible."
 },
 {
  "id": "TRIAL03",
  "short": "Kidney protection",
  "title": "Kidney protection in diabetic kidney disease",
  "overview": "Phase 3 study of a kidney-protective therapy for adults with type 2 diabetes and reduced kidney function. A patient must satisfy every inclusion criterion and trigger no exclusion criterion to be eligible."
 },
 {
  "id": "TRIAL04",
  "short": "Insulin optimisation",
  "title": "Insulin optimisation in type 2 diabetes",
  "overview": "Phase 3 study of a once-weekly insulin regimen for adults with type 2 diabetes already treated with insulin. A patient must satisfy every inclusion criterion and trigger no exclusion criterion to be eligible."
 },
 {
  "id": "TRIAL05",
  "short": "Type 1 closed-loop",
  "title": "Closed-loop insulin delivery in type 1 diabetes",
  "overview": "Device study of an automated closed-loop insulin delivery system for adults with type 1 diabetes. A patient must satisfy every inclusion criterion and trigger no exclusion criterion to be eligible."
 },
 {
  "id": "TRIAL06",
  "short": "Fatty liver (MASH)",
  "title": "Fatty liver disease (MASH) in type 2 diabetes",
  "overview": "Phase 3 study of a liver-directed therapy for adults with type 2 diabetes and raised liver enzymes from fatty liver disease. A patient must satisfy every inclusion criterion and trigger no exclusion criterion to be eligible."
 }
];
window.CT_DATA.protocols.push(...[
 {
  "clause_id": "TRIAL02-INC-01",
  "type": "inclusion",
  "title": "Adult age",
  "text": "Participant must be at least 18 years of age.",
  "rule": {
   "check": "numeric",
   "field": "age",
   "op": ">=",
   "value": 18,
   "borderline_margin": 0
  }
 },
 {
  "clause_id": "TRIAL02-INC-02",
  "type": "inclusion",
  "title": "Type 2 diabetes diagnosis",
  "text": "Participant must have a documented diagnosis of type 2 diabetes mellitus.",
  "rule": {
   "check": "text_any",
   "field": "diagnosis",
   "values": [
    "type 2 diabetes",
    "t2dm",
    "type ii diabetes"
   ]
  }
 },
 {
  "clause_id": "TRIAL02-INC-03",
  "type": "inclusion",
  "title": "Obesity (BMI)",
  "text": "Body mass index (BMI) must be between 30.0 and 45.0 kg/m2 inclusive.",
  "rule": {
   "check": "range",
   "field": "labs.bmi",
   "min": 30.0,
   "max": 45.0,
   "borderline_margin": 0.3
  }
 },
 {
  "clause_id": "TRIAL02-INC-04",
  "type": "inclusion",
  "title": "HbA1c window",
  "text": "Glycated haemoglobin (HbA1c) must be between 7.0 and 11.0 percent.",
  "rule": {
   "check": "range",
   "field": "labs.hba1c",
   "min": 7.0,
   "max": 11.0,
   "borderline_margin": 0.1
  }
 },
 {
  "clause_id": "TRIAL02-EXC-01",
  "type": "exclusion",
  "title": "Upper age limit",
  "text": "Participants older than 70 years are excluded.",
  "rule": {
   "check": "numeric",
   "field": "age",
   "op": ">",
   "value": 70,
   "borderline_margin": 0
  }
 },
 {
  "clause_id": "TRIAL02-EXC-02",
  "type": "exclusion",
  "title": "Current GLP-1 receptor agonist",
  "text": "Current use of any GLP-1 receptor agonist (semaglutide, liraglutide, dulaglutide, exenatide, tirzepatide) is excluded.",
  "rule": {
   "check": "medication_any",
   "values": [
    "semaglutide",
    "liraglutide",
    "dulaglutide",
    "exenatide",
    "tirzepatide",
    "glp-1"
   ]
  }
 },
 {
  "clause_id": "TRIAL02-EXC-03",
  "type": "exclusion",
  "title": "Pancreatitis history",
  "text": "Any history of acute or chronic pancreatitis is excluded.",
  "rule": {
   "check": "text_any",
   "field": "conditions",
   "values": [
    "pancreatitis"
   ]
  }
 },
 {
  "clause_id": "TRIAL02-EXC-04",
  "type": "exclusion",
  "title": "Pregnancy or breastfeeding",
  "text": "Participants who are pregnant or breastfeeding are excluded.",
  "rule": {
   "check": "text_any",
   "field": "conditions",
   "values": [
    "pregnant",
    "pregnancy",
    "breastfeeding",
    "lactating"
   ]
  }
 },
 {
  "clause_id": "TRIAL02-EXC-05",
  "type": "exclusion",
  "title": "Severe renal impairment",
  "text": "Estimated glomerular filtration rate (eGFR) below 30 mL/min/1.73m2 is excluded.",
  "rule": {
   "check": "numeric",
   "field": "labs.egfr",
   "op": "<",
   "value": 30,
   "borderline_margin": 2
  }
 },
 {
  "clause_id": "TRIAL03-INC-01",
  "type": "inclusion",
  "title": "Minimum age",
  "text": "Participant must be at least 30 years of age.",
  "rule": {
   "check": "numeric",
   "field": "age",
   "op": ">=",
   "value": 30,
   "borderline_margin": 0
  }
 },
 {
  "clause_id": "TRIAL03-INC-02",
  "type": "inclusion",
  "title": "Type 2 diabetes diagnosis",
  "text": "Participant must have a documented diagnosis of type 2 diabetes mellitus.",
  "rule": {
   "check": "text_any",
   "field": "diagnosis",
   "values": [
    "type 2 diabetes",
    "t2dm",
    "type ii diabetes"
   ]
  }
 },
 {
  "clause_id": "TRIAL03-INC-03",
  "type": "inclusion",
  "title": "Reduced kidney function (eGFR)",
  "text": "Estimated glomerular filtration rate (eGFR) must be between 25 and 60 mL/min/1.73m2.",
  "rule": {
   "check": "range",
   "field": "labs.egfr",
   "min": 25,
   "max": 60,
   "borderline_margin": 2
  }
 },
 {
  "clause_id": "TRIAL03-INC-04",
  "type": "inclusion",
  "title": "HbA1c window",
  "text": "Glycated haemoglobin (HbA1c) must be between 6.5 and 10.0 percent.",
  "rule": {
   "check": "range",
   "field": "labs.hba1c",
   "min": 6.5,
   "max": 10.0,
   "borderline_margin": 0.1
  }
 },
 {
  "clause_id": "TRIAL03-EXC-01",
  "type": "exclusion",
  "title": "Upper age limit",
  "text": "Participants older than 80 years are excluded.",
  "rule": {
   "check": "numeric",
   "field": "age",
   "op": ">",
   "value": 80,
   "borderline_margin": 0
  }
 },
 {
  "clause_id": "TRIAL03-EXC-02",
  "type": "exclusion",
  "title": "Type 1 diabetes",
  "text": "Diagnosis of type 1 diabetes mellitus is excluded.",
  "rule": {
   "check": "text_any",
   "field": "diagnosis",
   "values": [
    "type 1 diabetes",
    "t1dm"
   ]
  }
 },
 {
  "clause_id": "TRIAL03-EXC-03",
  "type": "exclusion",
  "title": "Pregnancy or breastfeeding",
  "text": "Participants who are pregnant or breastfeeding are excluded.",
  "rule": {
   "check": "text_any",
   "field": "conditions",
   "values": [
    "pregnant",
    "pregnancy",
    "breastfeeding",
    "lactating"
   ]
  }
 },
 {
  "clause_id": "TRIAL03-EXC-04",
  "type": "exclusion",
  "title": "Liver enzyme elevation",
  "text": "Alanine aminotransferase (ALT) above 150 U/L is excluded.",
  "rule": {
   "check": "numeric",
   "field": "labs.alt",
   "op": ">",
   "value": 150,
   "borderline_margin": 5
  }
 },
 {
  "clause_id": "TRIAL04-INC-01",
  "type": "inclusion",
  "title": "Adult age",
  "text": "Participant must be at least 18 years of age.",
  "rule": {
   "check": "numeric",
   "field": "age",
   "op": ">=",
   "value": 18,
   "borderline_margin": 0
  }
 },
 {
  "clause_id": "TRIAL04-INC-02",
  "type": "inclusion",
  "title": "Type 2 diabetes diagnosis",
  "text": "Participant must have a documented diagnosis of type 2 diabetes mellitus.",
  "rule": {
   "check": "text_any",
   "field": "diagnosis",
   "values": [
    "type 2 diabetes",
    "t2dm",
    "type ii diabetes"
   ]
  }
 },
 {
  "clause_id": "TRIAL04-INC-03",
  "type": "inclusion",
  "title": "Current insulin therapy",
  "text": "Participant must currently be treated with insulin (for example insulin glargine, degludec or detemir).",
  "rule": {
   "check": "medication_any",
   "values": [
    "insulin",
    "glargine",
    "aspart",
    "lispro",
    "degludec",
    "detemir"
   ],
   "required": true
  }
 },
 {
  "clause_id": "TRIAL04-INC-04",
  "type": "inclusion",
  "title": "HbA1c window",
  "text": "Glycated haemoglobin (HbA1c) must be between 7.5 and 11.0 percent.",
  "rule": {
   "check": "range",
   "field": "labs.hba1c",
   "min": 7.5,
   "max": 11.0,
   "borderline_margin": 0.1
  }
 },
 {
  "clause_id": "TRIAL04-EXC-01",
  "type": "exclusion",
  "title": "Upper age limit",
  "text": "Participants older than 75 years are excluded.",
  "rule": {
   "check": "numeric",
   "field": "age",
   "op": ">",
   "value": 75,
   "borderline_margin": 0
  }
 },
 {
  "clause_id": "TRIAL04-EXC-02",
  "type": "exclusion",
  "title": "Type 1 diabetes",
  "text": "Diagnosis of type 1 diabetes mellitus or history of diabetic ketoacidosis is excluded.",
  "rule": {
   "check": "text_any",
   "field": "diagnosis",
   "values": [
    "type 1 diabetes",
    "t1dm",
    "ketoacidosis"
   ]
  }
 },
 {
  "clause_id": "TRIAL04-EXC-03",
  "type": "exclusion",
  "title": "Pregnancy or breastfeeding",
  "text": "Participants who are pregnant or breastfeeding are excluded.",
  "rule": {
   "check": "text_any",
   "field": "conditions",
   "values": [
    "pregnant",
    "pregnancy",
    "breastfeeding",
    "lactating"
   ]
  }
 },
 {
  "clause_id": "TRIAL04-EXC-04",
  "type": "exclusion",
  "title": "Severe renal impairment",
  "text": "Estimated glomerular filtration rate (eGFR) below 30 mL/min/1.73m2 is excluded.",
  "rule": {
   "check": "numeric",
   "field": "labs.egfr",
   "op": "<",
   "value": 30,
   "borderline_margin": 2
  }
 },
 {
  "clause_id": "TRIAL05-INC-01",
  "type": "inclusion",
  "title": "Adult age",
  "text": "Participant must be at least 18 years of age.",
  "rule": {
   "check": "numeric",
   "field": "age",
   "op": ">=",
   "value": 18,
   "borderline_margin": 0
  }
 },
 {
  "clause_id": "TRIAL05-INC-02",
  "type": "inclusion",
  "title": "Type 1 diabetes diagnosis",
  "text": "Participant must have a documented diagnosis of type 1 diabetes mellitus.",
  "rule": {
   "check": "text_any",
   "field": "diagnosis",
   "values": [
    "type 1 diabetes",
    "t1dm"
   ]
  }
 },
 {
  "clause_id": "TRIAL05-INC-03",
  "type": "inclusion",
  "title": "Current insulin therapy",
  "text": "Participant must currently be treated with insulin.",
  "rule": {
   "check": "medication_any",
   "values": [
    "insulin",
    "glargine",
    "aspart",
    "lispro",
    "degludec",
    "detemir"
   ],
   "required": true
  }
 },
 {
  "clause_id": "TRIAL05-INC-04",
  "type": "inclusion",
  "title": "HbA1c window",
  "text": "Glycated haemoglobin (HbA1c) must be between 7.0 and 10.0 percent.",
  "rule": {
   "check": "range",
   "field": "labs.hba1c",
   "min": 7.0,
   "max": 10.0,
   "borderline_margin": 0.1
  }
 },
 {
  "clause_id": "TRIAL05-EXC-01",
  "type": "exclusion",
  "title": "Upper age limit",
  "text": "Participants older than 65 years are excluded.",
  "rule": {
   "check": "numeric",
   "field": "age",
   "op": ">",
   "value": 65,
   "borderline_margin": 0
  }
 },
 {
  "clause_id": "TRIAL05-EXC-02",
  "type": "exclusion",
  "title": "Pregnancy or breastfeeding",
  "text": "Participants who are pregnant or breastfeeding are excluded.",
  "rule": {
   "check": "text_any",
   "field": "conditions",
   "values": [
    "pregnant",
    "pregnancy",
    "breastfeeding",
    "lactating"
   ]
  }
 },
 {
  "clause_id": "TRIAL05-EXC-03",
  "type": "exclusion",
  "title": "Renal impairment",
  "text": "Estimated glomerular filtration rate (eGFR) below 45 mL/min/1.73m2 is excluded.",
  "rule": {
   "check": "numeric",
   "field": "labs.egfr",
   "op": "<",
   "value": 45,
   "borderline_margin": 2
  }
 },
 {
  "clause_id": "TRIAL06-INC-01",
  "type": "inclusion",
  "title": "Adult age",
  "text": "Participant must be at least 18 years of age.",
  "rule": {
   "check": "numeric",
   "field": "age",
   "op": ">=",
   "value": 18,
   "borderline_margin": 0
  }
 },
 {
  "clause_id": "TRIAL06-INC-02",
  "type": "inclusion",
  "title": "Type 2 diabetes diagnosis",
  "text": "Participant must have a documented diagnosis of type 2 diabetes mellitus.",
  "rule": {
   "check": "text_any",
   "field": "diagnosis",
   "values": [
    "type 2 diabetes",
    "t2dm",
    "type ii diabetes"
   ]
  }
 },
 {
  "clause_id": "TRIAL06-INC-03",
  "type": "inclusion",
  "title": "Raised liver enzymes (ALT)",
  "text": "Alanine aminotransferase (ALT) must be between 40 and 200 U/L.",
  "rule": {
   "check": "range",
   "field": "labs.alt",
   "min": 40,
   "max": 200,
   "borderline_margin": 3
  }
 },
 {
  "clause_id": "TRIAL06-INC-04",
  "type": "inclusion",
  "title": "Body mass index",
  "text": "Body mass index (BMI) must be between 25.0 and 45.0 kg/m2 inclusive.",
  "rule": {
   "check": "range",
   "field": "labs.bmi",
   "min": 25.0,
   "max": 45.0,
   "borderline_margin": 0.3
  }
 },
 {
  "clause_id": "TRIAL06-EXC-01",
  "type": "exclusion",
  "title": "Upper age limit",
  "text": "Participants older than 75 years are excluded.",
  "rule": {
   "check": "numeric",
   "field": "age",
   "op": ">",
   "value": 75,
   "borderline_margin": 0
  }
 },
 {
  "clause_id": "TRIAL06-EXC-02",
  "type": "exclusion",
  "title": "Type 1 diabetes",
  "text": "Diagnosis of type 1 diabetes mellitus is excluded.",
  "rule": {
   "check": "text_any",
   "field": "diagnosis",
   "values": [
    "type 1 diabetes",
    "t1dm"
   ]
  }
 },
 {
  "clause_id": "TRIAL06-EXC-03",
  "type": "exclusion",
  "title": "Pregnancy or breastfeeding",
  "text": "Participants who are pregnant or breastfeeding are excluded.",
  "rule": {
   "check": "text_any",
   "field": "conditions",
   "values": [
    "pregnant",
    "pregnancy",
    "breastfeeding",
    "lactating"
   ]
  }
 },
 {
  "clause_id": "TRIAL06-EXC-04",
  "type": "exclusion",
  "title": "Severe renal impairment",
  "text": "Estimated glomerular filtration rate (eGFR) below 30 mL/min/1.73m2 is excluded.",
  "rule": {
   "check": "numeric",
   "field": "labs.egfr",
   "op": "<",
   "value": 30,
   "borderline_margin": 2
  }
 }
]);
