"""B2 - Criteria Retrieval Agent (RAG over the protocol documents).

Pipeline: load docs -> chunk -> embed -> vector store -> similarity search.
Embeddings are local hashed TF-IDF vectors (no external service), stored in a
tiny in-memory cosine vector store. Returns the governing criteria with clause
IDs and the machine-readable rule attached to each clause.

Entry point: run(case_record) -> case_record   (fills retrieved_criteria[])
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter
from pathlib import Path

from framework import kernel_function

PROTOCOL_DIR = Path(__file__).resolve().parent.parent / "data" / "protocols"
DIM = 512          # hashed embedding dimension
TOP_K = 8          # per query
LAB_NAMES = {"hba1c": "glycated haemoglobin HbA1c percent", "bmi": "body mass index BMI kg/m2",
             "egfr": "estimated glomerular filtration rate eGFR renal", "alt": "alanine aminotransferase ALT liver"}
CHUNK_WORDS = 60

_TOKEN = re.compile(r"[a-z0-9][a-z0-9.%]*")


# ---------------------------------------------------------------- chunking ---
def load_documents(protocol_dir: Path = PROTOCOL_DIR) -> list[dict]:
    docs = []
    for p in sorted(protocol_dir.glob("*.md")):
        text = p.read_text(encoding="utf-8")
        meta = {"clause_id": None, "type": None, "rule": None, "title": None}
        for line in text.splitlines():
            if line.startswith("# "):
                meta["title"] = line[2:].strip()
            elif line.startswith("Clause ID:"):
                meta["clause_id"] = line.split(":", 1)[1].strip()
            elif line.startswith("Type:"):
                meta["type"] = line.split(":", 1)[1].strip()
            elif line.startswith("Rule-JSON:"):
                meta["rule"] = json.loads(line.split(":", 1)[1])
        docs.append({"source": p.name, "text": text, **meta})
    return docs


def chunk_text(text: str, size: int = CHUNK_WORDS) -> list[str]:
    body = "\n".join(l for l in text.splitlines() if not l.startswith("Rule-JSON:"))
    words = body.split()
    return [" ".join(words[i:i + size]) for i in range(0, len(words), size)] or [body]


# --------------------------------------------------------------- embedding ---
def _tokens(text: str) -> list[str]:
    toks = _TOKEN.findall(text.lower())
    return toks + [f"{a}_{b}" for a, b in zip(toks, toks[1:])]   # unigrams + bigrams


class LocalEmbedder:
    """Deterministic hashed TF-IDF embedding (feature hashing, cosine-normalised)."""

    def __init__(self, dim: int = DIM):
        self.dim = dim
        self.idf: dict[int, float] = {}

    def _bucket(self, tok: str) -> int:
        h = 0
        for ch in tok:
            h = (h * 131 + ord(ch)) % 1_000_003
        return h % self.dim

    def fit(self, texts: list[str]) -> None:
        n = len(texts)
        df: Counter = Counter()
        for t in texts:
            df.update({self._bucket(tok) for tok in _tokens(t)})
        self.idf = {b: math.log((1 + n) / (1 + c)) + 1 for b, c in df.items()}

    def embed(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for b, tf in Counter(self._bucket(t) for t in _tokens(text)).items():
            vec[b] += (1 + math.log(tf)) * self.idf.get(b, 1.0)
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


# ------------------------------------------------------------ vector store ---
class VectorStore:
    def __init__(self):
        self.items: list[tuple[list[float], dict]] = []

    def add(self, vector: list[float], payload: dict) -> None:
        self.items.append((vector, payload))

    def search(self, query_vec: list[float], k: int) -> list[tuple[float, dict]]:
        scored = [(sum(a * b for a, b in zip(query_vec, v)), p) for v, p in self.items]
        scored.sort(key=lambda s: -s[0])
        return scored[:k]


class CriteriaIndex:
    """Builds once; reused across cases."""

    def __init__(self, protocol_dir: Path = PROTOCOL_DIR):
        self.docs = load_documents(protocol_dir)
        self.embedder = LocalEmbedder()
        chunks = []
        for d in self.docs:
            for i, c in enumerate(chunk_text(d["text"])):
                chunks.append((c, {"chunk_id": f"{d['source']}#{i}", "doc": d, "chunk": c}))
        self.embedder.fit([c for c, _ in chunks])
        self.store = VectorStore()
        for c, payload in chunks:
            self.store.add(self.embedder.embed(c), payload)

    def query(self, text: str, k: int = TOP_K) -> list[tuple[float, dict]]:
        return self.store.search(self.embedder.embed(text), k)


_INDEX: CriteriaIndex | None = None


def get_index() -> CriteriaIndex:
    global _INDEX
    if _INDEX is None:
        _INDEX = CriteriaIndex()
    return _INDEX


# ------------------------------------------------------------------ agent ---
def build_queries(structured: dict) -> list[str]:
    """One focused query per patient signal so every governing clause surfaces."""
    labs = structured.get("labs") or {}
    qs = [f"age {structured.get('age')} years inclusion exclusion age limit",
          f"diagnosis {structured.get('diagnosis', '')} type 2 diabetes type 1 diabetes",
          "medication " + " ".join(structured.get("medications") or []) + " insulin GLP-1 metformin"]
    qs += [f"{LAB_NAMES.get(name.lower(), name)} {val} laboratory value threshold" for name, val in labs.items()]
    conds = structured.get("conditions") or []
    qs.append(("history " + " ".join(conds)) if conds else "history pregnancy pancreatitis")
    return qs


def retrieve(structured: dict) -> list[dict]:
    index = get_index()
    best: dict[str, dict] = {}
    for q in build_queries(structured):
        for score, payload in index.query(q):
            d = payload["doc"]
            cid = d["clause_id"]
            if not cid or d["type"] not in ("inclusion", "exclusion"):
                continue
            if cid not in best or score > best[cid]["score"]:
                best[cid] = {"clause_id": cid, "type": d["type"], "title": d["title"],
                             "text": payload["chunk"], "rule": d["rule"], "score": round(score, 4),
                             "source": d["source"], "query": q}
    return sorted(best.values(), key=lambda c: c["clause_id"])


def run(case_record: dict) -> dict:
    case_record["retrieved_criteria"] = retrieve(case_record.get("structured") or {})
    case_record["status"] = "criteria_retrieved"
    return case_record


class CriteriaRetrievalPlugin:
    """Semantic Kernel plugin wrapper."""

    @kernel_function(name="run", description="RAG over trial protocol docs; returns governing criteria with clause IDs")
    def run(self, case_record_json: str) -> str:
        return json.dumps(run(json.loads(case_record_json)))
