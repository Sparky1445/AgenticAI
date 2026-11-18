# Raised liver enzymes (ALT)
Clause ID: TRIAL06-INC-03
Type: inclusion
Trial: TRIAL06

Alanine aminotransferase (ALT) must be between 40 and 200 U/L.

Rule-JSON: {"check": "range", "field": "labs.alt", "min": 40, "max": 200, "borderline_margin": 3}
