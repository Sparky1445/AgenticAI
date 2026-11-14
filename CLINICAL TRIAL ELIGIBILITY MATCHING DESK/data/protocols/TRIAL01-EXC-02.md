# Severe hyperglycaemia
Clause ID: TRIAL01-EXC-02
Type: exclusion
Trial: TRIAL01

HbA1c greater than 9.0 percent at screening is excluded; such participants need intensified therapy rather than study drug.

Rule-JSON: {"check": "numeric", "field": "labs.hba1c", "op": ">", "value": 9.0, "borderline_margin": 0.1}
