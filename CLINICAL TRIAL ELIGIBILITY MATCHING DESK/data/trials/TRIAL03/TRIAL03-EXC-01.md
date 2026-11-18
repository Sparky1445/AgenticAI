# Upper age limit
Clause ID: TRIAL03-EXC-01
Type: exclusion
Trial: TRIAL03

Participants older than 80 years are excluded.

Rule-JSON: {"check": "numeric", "field": "age", "op": ">", "value": 80, "borderline_margin": 0}
