# Reduced kidney function (eGFR)
Clause ID: TRIAL03-INC-03
Type: inclusion
Trial: TRIAL03

Estimated glomerular filtration rate (eGFR) must be between 25 and 60 mL/min/1.73m2.

Rule-JSON: {"check": "range", "field": "labs.egfr", "min": 25, "max": 60, "borderline_margin": 2}
