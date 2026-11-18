# Current insulin therapy
Clause ID: TRIAL04-INC-03
Type: inclusion
Trial: TRIAL04

Participant must currently be treated with insulin (for example insulin glargine, degludec or detemir).

Rule-JSON: {"check": "medication_any", "values": ["insulin", "glargine", "aspart", "lispro", "degludec", "detemir"], "required": true}
