# Type 1 diabetes
Clause ID: TRIAL01-EXC-05
Type: exclusion
Trial: TRIAL01

Diagnosis of type 1 diabetes mellitus or history of diabetic ketoacidosis is excluded.

Rule-JSON: {"check": "text_any", "field": "diagnosis", "values": ["type 1 diabetes", "t1dm", "ketoacidosis"]}
