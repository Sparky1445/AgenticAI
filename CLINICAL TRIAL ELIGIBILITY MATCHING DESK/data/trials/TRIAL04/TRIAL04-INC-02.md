# Type 2 diabetes diagnosis
Clause ID: TRIAL04-INC-02
Type: inclusion
Trial: TRIAL04

Participant must have a documented diagnosis of type 2 diabetes mellitus.

Rule-JSON: {"check": "text_any", "field": "diagnosis", "values": ["type 2 diabetes", "t2dm", "type ii diabetes"]}
