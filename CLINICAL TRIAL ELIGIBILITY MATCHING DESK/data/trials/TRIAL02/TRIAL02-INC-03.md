# Obesity (BMI)
Clause ID: TRIAL02-INC-03
Type: inclusion
Trial: TRIAL02

Body mass index (BMI) must be between 30.0 and 45.0 kg/m2 inclusive.

Rule-JSON: {"check": "range", "field": "labs.bmi", "min": 30.0, "max": 45.0, "borderline_margin": 0.3}
