# Current insulin therapy
Clause ID: TRIAL05-INC-03
Type: inclusion
Trial: TRIAL05

Participant must currently be treated with insulin.

Rule-JSON: {"check": "medication_any", "values": ["insulin", "glargine", "aspart", "lispro", "degludec", "detemir"], "required": true}
