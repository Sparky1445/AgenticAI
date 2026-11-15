# Liver enzyme elevation
Clause ID: TRIAL01-EXC-08
Type: exclusion
Trial: TRIAL01

Alanine aminotransferase (ALT) above 120 U/L (3 times the upper limit of normal) is excluded.

Rule-JSON: {"check": "numeric", "field": "labs.alt", "op": ">", "value": 120, "borderline_margin": 5}
