# Liver enzyme elevation
Clause ID: TRIAL03-EXC-04
Type: exclusion
Trial: TRIAL03

Alanine aminotransferase (ALT) above 150 U/L is excluded.

Rule-JSON: {"check": "numeric", "field": "labs.alt", "op": ">", "value": 150, "borderline_margin": 5}
