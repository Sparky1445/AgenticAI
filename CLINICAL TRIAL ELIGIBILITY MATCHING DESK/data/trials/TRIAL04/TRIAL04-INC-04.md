# HbA1c window
Clause ID: TRIAL04-INC-04
Type: inclusion
Trial: TRIAL04

Glycated haemoglobin (HbA1c) must be between 7.5 and 11.0 percent.

Rule-JSON: {"check": "range", "field": "labs.hba1c", "min": 7.5, "max": 11.0, "borderline_margin": 0.1}
