# Upper age limit
Clause ID: TRIAL05-EXC-01
Type: exclusion
Trial: TRIAL05

Participants older than 65 years are excluded.

Rule-JSON: {"check": "numeric", "field": "age", "op": ">", "value": 65, "borderline_margin": 0}
