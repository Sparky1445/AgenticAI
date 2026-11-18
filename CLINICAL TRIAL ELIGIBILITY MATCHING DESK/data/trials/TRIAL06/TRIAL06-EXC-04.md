# Severe renal impairment
Clause ID: TRIAL06-EXC-04
Type: exclusion
Trial: TRIAL06

Estimated glomerular filtration rate (eGFR) below 30 mL/min/1.73m2 is excluded.

Rule-JSON: {"check": "numeric", "field": "labs.egfr", "op": "<", "value": 30, "borderline_margin": 2}
