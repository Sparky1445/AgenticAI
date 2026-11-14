# Minimum HbA1c
Clause ID: TRIAL01-INC-03
Type: inclusion
Trial: TRIAL01

Glycated haemoglobin (HbA1c) at screening must be 7.0 percent or higher, showing inadequate glycaemic control.

Rule-JSON: {"check": "numeric", "field": "labs.hba1c", "op": ">=", "value": 7.0, "borderline_margin": 0.1}
