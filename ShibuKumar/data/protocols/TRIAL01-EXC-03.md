# Renal impairment
Clause ID: TRIAL01-EXC-03
Type: exclusion
Trial: TRIAL01

Estimated glomerular filtration rate (eGFR) below 45 mL/min/1.73m2 is excluded.

Rule-JSON: {"check": "numeric", "field": "labs.egfr", "op": "<", "value": 45, "borderline_margin": 2}
