# Upper age limit
Clause ID: TRIAL01-EXC-01
Type: exclusion
Trial: TRIAL01

Participants older than 75 years are excluded.

Rule-JSON: {"check": "numeric", "field": "age", "op": ">", "value": 75, "borderline_margin": 0}
