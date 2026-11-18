# Severe renal impairment
Clause ID: TRIAL04-EXC-04
Type: exclusion
Trial: TRIAL04

Estimated glomerular filtration rate (eGFR) below 30 mL/min/1.73m2 is excluded.

Rule-JSON: {"check": "numeric", "field": "labs.egfr", "op": "<", "value": 30, "borderline_margin": 2}
