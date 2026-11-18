# HbA1c window
Clause ID: TRIAL02-INC-04
Type: inclusion
Trial: TRIAL02

Glycated haemoglobin (HbA1c) must be between 7.0 and 11.0 percent.

Rule-JSON: {"check": "range", "field": "labs.hba1c", "min": 7.0, "max": 11.0, "borderline_margin": 0.1}
