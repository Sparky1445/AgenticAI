# Severe renal impairment
Clause ID: TRIAL02-EXC-05
Type: exclusion
Trial: TRIAL02

Estimated glomerular filtration rate (eGFR) below 30 mL/min/1.73m2 is excluded.

Rule-JSON: {"check": "numeric", "field": "labs.egfr", "op": "<", "value": 30, "borderline_margin": 2}
