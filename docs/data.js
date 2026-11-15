/* Synthetic data mirrored from the project:
 *   CLINICAL TRIAL ELIGIBILITY MATCHING DESK/data/patients.json   (B6)
 *   CLINICAL TRIAL ELIGIBILITY MATCHING DESK/data/protocols/*.md  (B1)
 * Academic demonstration only. Not medical advice. */
window.CT_DATA = {
  patients: [
    { case_id: "P001", raw_summary: "Patient P001: 54-year-old with type 2 diabetes mellitus. HbA1c 8.2%, BMI 31.4, eGFR 78, ALT 35. Medications: metformin, atorvastatin. History: hypertension.", expected_verdict: "eligible", expected_clause_ids: ["TRIAL01-INC-01","TRIAL01-INC-02","TRIAL01-INC-03","TRIAL01-INC-04","TRIAL01-INC-05"], note: "clean eligible case" },
    { case_id: "P002", raw_summary: "Patient P002: 61-year-old with type 2 diabetes mellitus. HbA1c 8.5%, BMI 29.0, eGFR 70, ALT 30. Medications: metformin, insulin glargine. History: none.", expected_verdict: "ineligible", expected_clause_ids: ["TRIAL01-EXC-04"], note: "banned medication (insulin)" },
    { case_id: "P003", raw_summary: "Patient P003: 48-year-old with type 2 diabetes mellitus. HbA1c 10.4%, BMI 33.0, eGFR 85, ALT 28. Medications: metformin. History: none.", expected_verdict: "ineligible", expected_clause_ids: ["TRIAL01-EXC-02"], note: "HbA1c > 9" },
    { case_id: "P004", raw_summary: "Patient P004: 67-year-old with type 2 diabetes mellitus. HbA1c 7.8%, BMI 28.0, eGFR 38, ALT 40. Medications: metformin, amlodipine. History: hypertension.", expected_verdict: "ineligible", expected_clause_ids: ["TRIAL01-EXC-03"], note: "renal impairment eGFR < 45" },
    { case_id: "P005", raw_summary: "Patient P005: 35-year-old with type 1 diabetes mellitus. HbA1c 8.0%, BMI 26.0, eGFR 95, ALT 22. Medications: insulin aspart, insulin glargine. History: none.", expected_verdict: "ineligible", expected_clause_ids: ["TRIAL01-EXC-05","TRIAL01-EXC-04"], note: "type 1 diabetes on insulin" },
    { case_id: "P006", raw_summary: "Patient P006: 79-year-old with type 2 diabetes mellitus. HbA1c 7.6%, BMI 27.0, eGFR 55, ALT 30. Medications: metformin. History: osteoarthritis.", expected_verdict: "ineligible", expected_clause_ids: ["TRIAL01-EXC-01"], note: "age > 75" },
    { case_id: "P007", raw_summary: "Patient P007: 50-year-old with type 2 diabetes mellitus. HbA1c 7.9%, BMI 30.0, eGFR 80, ALT 25. Medications: metformin, lisinopril. History: none.", expected_verdict: "eligible", expected_clause_ids: ["TRIAL01-INC-01","TRIAL01-INC-02","TRIAL01-INC-03","TRIAL01-INC-04","TRIAL01-INC-05"], note: "clean eligible case" },
    { case_id: "P008", raw_summary: "Patient P008: 58-year-old with type 2 diabetes mellitus. HbA1c 9.1%, BMI 30.0, eGFR 70, ALT 30. Medications: metformin. History: none.", expected_verdict: "review", expected_clause_ids: ["TRIAL01-EXC-02"], note: "BORDERLINE: HbA1c 9.1 sits at the 9.0 exclusion edge -> coordinator review" },
    { case_id: "P009", raw_summary: "Patient P009: 44-year-old with type 2 diabetes mellitus. HbA1c 8.0%, BMI 29.0, ALT 30. Medications: metformin. History: none.", expected_verdict: "review", expected_clause_ids: ["TRIAL01-EXC-03"], note: "BORDERLINE: eGFR missing, renal exclusion cannot be evaluated -> coordinator review" },
    { case_id: "P010", raw_summary: "Patient P010: 63-year-old with type 2 diabetes mellitus. HbA1c 7.5%, BMI 40.2, eGFR 46, ALT 30. Medications: metformin. History: hypertension.", expected_verdict: "review", expected_clause_ids: ["TRIAL01-INC-04","TRIAL01-EXC-03"], note: "BORDERLINE: BMI 40.2 at the 40 edge and eGFR 46 at the 45 edge -> coordinator review" }
  ],
  protocols: [
    { clause_id: "TRIAL01-INC-01", type: "inclusion", title: "Adult age", text: "Participant must be at least 18 years of age at the time of screening.", rule: { check: "numeric", field: "age", op: ">=", value: 18, borderline_margin: 0 } },
    { clause_id: "TRIAL01-INC-02", type: "inclusion", title: "Type 2 diabetes diagnosis", text: "Participant must have a documented diagnosis of type 2 diabetes mellitus (T2DM).", rule: { check: "text_any", field: "diagnosis", values: ["type 2 diabetes","t2dm","type ii diabetes"] } },
    { clause_id: "TRIAL01-INC-03", type: "inclusion", title: "Minimum HbA1c", text: "Glycated haemoglobin (HbA1c) at screening must be 7.0 percent or higher, showing inadequate glycaemic control.", rule: { check: "numeric", field: "labs.hba1c", op: ">=", value: 7.0, borderline_margin: 0.1 } },
    { clause_id: "TRIAL01-INC-04", type: "inclusion", title: "Body mass index", text: "Body mass index (BMI) must be between 25.0 and 40.0 kg/m2 inclusive.", rule: { check: "range", field: "labs.bmi", min: 25.0, max: 40.0, borderline_margin: 0.3 } },
    { clause_id: "TRIAL01-INC-05", type: "inclusion", title: "Stable metformin therapy", text: "Participant must be taking metformin as background therapy.", rule: { check: "medication_any", values: ["metformin"], required: true } },
    { clause_id: "TRIAL01-EXC-01", type: "exclusion", title: "Upper age limit", text: "Participants older than 75 years are excluded.", rule: { check: "numeric", field: "age", op: ">", value: 75, borderline_margin: 0 } },
    { clause_id: "TRIAL01-EXC-02", type: "exclusion", title: "Severe hyperglycaemia", text: "HbA1c greater than 9.0 percent at screening is excluded; such participants need intensified therapy rather than study drug.", rule: { check: "numeric", field: "labs.hba1c", op: ">", value: 9.0, borderline_margin: 0.1 } },
    { clause_id: "TRIAL01-EXC-03", type: "exclusion", title: "Renal impairment", text: "Estimated glomerular filtration rate (eGFR) below 45 mL/min/1.73m2 is excluded.", rule: { check: "numeric", field: "labs.egfr", op: "<", value: 45, borderline_margin: 2 } },
    { clause_id: "TRIAL01-EXC-04", type: "exclusion", title: "Prohibited glucose-lowering medication", text: "Current use of insulin or any GLP-1 receptor agonist (semaglutide, liraglutide, dulaglutide, exenatide) is excluded.", rule: { check: "medication_any", values: ["insulin","glargine","semaglutide","liraglutide","dulaglutide","exenatide"] } },
    { clause_id: "TRIAL01-EXC-05", type: "exclusion", title: "Type 1 diabetes", text: "Diagnosis of type 1 diabetes mellitus or history of diabetic ketoacidosis is excluded.", rule: { check: "text_any", field: "diagnosis", values: ["type 1 diabetes","t1dm","ketoacidosis"] } },
    { clause_id: "TRIAL01-EXC-06", type: "exclusion", title: "Pregnancy or breastfeeding", text: "Participants who are pregnant or breastfeeding are excluded.", rule: { check: "text_any", field: "conditions", values: ["pregnant","pregnancy","breastfeeding","lactating"] } },
    { clause_id: "TRIAL01-EXC-07", type: "exclusion", title: "Pancreatitis history", text: "Any history of acute or chronic pancreatitis is excluded.", rule: { check: "text_any", field: "conditions", values: ["pancreatitis"] } },
    { clause_id: "TRIAL01-EXC-08", type: "exclusion", title: "Liver enzyme elevation", text: "Alanine aminotransferase (ALT) above 120 U/L (3 times the upper limit of normal) is excluded.", rule: { check: "numeric", field: "labs.alt", op: ">", value: 120, borderline_margin: 5 } }
  ],
  review_hints: {
    P008: "borderline HbA1c acceptable per PI decision",
    P009: "request eGFR lab before screening",
    P010: "BMI and eGFR both at edge; confirm with PI"
  }
};
