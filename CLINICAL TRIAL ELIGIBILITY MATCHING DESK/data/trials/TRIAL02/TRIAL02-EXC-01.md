# Upper age limit
Clause ID: TRIAL02-EXC-01
Type: exclusion
Trial: TRIAL02

Participants older than 70 years are excluded.

Rule-JSON: {"check": "numeric", "field": "age", "op": ">", "value": 70, "borderline_margin": 0}
