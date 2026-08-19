from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np

app = FastAPI(title="SmartCache AI — Demand Prediction Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Synthetic Training Data ──────────────────────────────────────────────────
# Feature order: [requestsLast5Min, requestsLast30Min, recentTrafficGrowth,
#                 cacheHits, cacheMisses, hourOfDay, basePopularity]

rng = np.random.default_rng(42)
N = 2000

requests_5m   = rng.integers(0, 120, N).astype(float)
requests_30m  = rng.integers(0, 600, N).astype(float)
traffic_growth= rng.uniform(-0.5, 1.5, N)
cache_hits    = rng.integers(0, 1000, N).astype(float)
cache_misses  = rng.integers(0, 500, N).astype(float)
hour_of_day   = rng.integers(0, 24, N).astype(float)
base_pop      = rng.uniform(0.05, 0.99, N)

hit_ratio = cache_hits / np.maximum(cache_hits + cache_misses, 1)
recency   = requests_5m / 120.0
volume    = requests_30m / 600.0
growth    = np.clip(traffic_growth / 1.5, 0, 1)
prime_time = ((hour_of_day >= 17) & (hour_of_day <= 22)).astype(float)

y = np.clip(
    0.28 * base_pop
    + 0.25 * recency
    + 0.18 * volume
    + 0.12 * hit_ratio
    + 0.12 * growth
    + 0.05 * prime_time
    + rng.uniform(-0.03, 0.03, N),   # small noise
    0.01, 0.99
)

X = np.column_stack([requests_5m, requests_30m, traffic_growth,
                     cache_hits, cache_misses, hour_of_day, base_pop])

# ─── Train Model ──────────────────────────────────────────────────────────────
try:
    from sklearn.ensemble import RandomForestRegressor
    model = RandomForestRegressor(
        n_estimators=100,
        max_depth=8,
        min_samples_leaf=5,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X, y)
    MODEL_SOURCE = "RandomForestRegressor"
    USE_ML = True
    print(f"[SmartCache ML] Model trained: {MODEL_SOURCE} on {N} samples")
except Exception as e:
    print(f"[SmartCache ML] sklearn unavailable ({e}), using rule-based fallback")
    USE_ML = False
    MODEL_SOURCE = "rule-based"


# ─── Request Schema ───────────────────────────────────────────────────────────
class PredictRequest(BaseModel):
    requestsLast5Min: float = 0
    requestsLast30Min: float = 0
    recentTrafficGrowth: float = 0.1
    cacheHits: float = 0
    cacheMisses: float = 0
    hourOfDay: float = 12
    basePopularity: float = 0.5


def classify(score: float) -> str:
    if score >= 0.75:
        return "HOT"
    if score >= 0.40:
        return "WARM"
    return "COLD"


def rule_based_score(f: PredictRequest) -> float:
    hit_ratio = f.cacheHits / max(f.cacheHits + f.cacheMisses, 1)
    recency   = min(1.0, f.requestsLast5Min / 80.0)
    volume    = min(1.0, f.requestsLast30Min / 400.0)
    growth    = min(0.2, max(0.0, f.recentTrafficGrowth) * 0.2)
    prime     = 0.05 if 17 <= f.hourOfDay <= 22 else 0.0
    raw = (0.30 * f.basePopularity + 0.28 * recency + 0.20 * volume
           + 0.12 * hit_ratio + growth + prime)
    return round(float(np.clip(raw, 0.01, 0.99)), 4)


# ─── Endpoints ────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL_SOURCE,
        "training_samples": N,
        "features": ["requestsLast5Min","requestsLast30Min","recentTrafficGrowth",
                     "cacheHits","cacheMisses","hourOfDay","basePopularity"],
    }


@app.post("/predict")
def predict(f: PredictRequest):
    if USE_ML:
        features = np.array([[f.requestsLast5Min, f.requestsLast30Min,
                               f.recentTrafficGrowth, f.cacheHits,
                               f.cacheMisses, f.hourOfDay, f.basePopularity]])
        raw_score = float(model.predict(features)[0])
        score = round(float(np.clip(raw_score, 0.01, 0.99)), 4)
        source = "RandomForest"
    else:
        score = rule_based_score(f)
        source = "rule-based"

    classification = classify(score)
    ttl_minutes = 60 if classification == "HOT" else (10 if classification == "WARM" else 1)

    return {
        "demand_score": score,
        "classification": classification,
        "ttl_minutes": ttl_minutes,
        "model": source,
    }
