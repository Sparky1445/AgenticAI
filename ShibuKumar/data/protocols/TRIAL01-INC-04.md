# Body mass index
Clause ID: TRIAL01-INC-04
Type: inclusion
Trial: TRIAL01

Body mass index (BMI) must be between 25.0 and 40.0 kg/m2 inclusive.

Rule-JSON: {"check": "range", "field": "labs.bmi", "min": 25.0, "max": 40.0, "borderline_margin": 0.3}
