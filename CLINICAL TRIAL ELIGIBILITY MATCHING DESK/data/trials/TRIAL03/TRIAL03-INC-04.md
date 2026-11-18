# HbA1c window
Clause ID: TRIAL03-INC-04
Type: inclusion
Trial: TRIAL03

Glycated haemoglobin (HbA1c) must be between 6.5 and 10.0 percent.

Rule-JSON: {"check": "range", "field": "labs.hba1c", "min": 6.5, "max": 10.0, "borderline_margin": 0.1}
