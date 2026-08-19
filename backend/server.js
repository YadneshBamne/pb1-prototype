import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from 'redis';
import { MongoClient } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const PORT = process.env.PORT || 8000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const MONGO_DB  = process.env.MONGO_DB  || 'smartcache';
const ML_URL    = process.env.ML_URL    || 'http://localhost:8001';

// ─── Service State ────────────────────────────────────────────────────────────
let redisClient  = null;
let mongoDb      = null;
let redisOk      = false;
let mongoOk      = false;
let mlOk         = false;

// ─── In-Memory Fallback Cache ─────────────────────────────────────────────────
const memCache = new Map(); // key -> { val, exp }
function memGet(k) {
  const i = memCache.get(k);
  if (!i) return null;
  if (Date.now() > i.exp) { memCache.delete(k); return null; }
  return i.val;
}
function memSet(k, v, ttlSec) { memCache.set(k, { val: v, exp: Date.now() + ttlSec * 1000 }); }
function memDel(k) { return memCache.delete(k) ? 1 : 0; }
function memKeys(prefix) { return [...memCache.keys()].filter(k => k.startsWith(prefix.replace('*',''))); }

// ─── Cache Abstraction ────────────────────────────────────────────────────────
async function cacheGet(k) {
  if (redisOk && redisClient) {
    try { const v = await redisClient.get(k); return v; }
    catch { redisOk = false; }
  }
  return memGet(k);
}
async function cacheSet(k, v, ttlSec) {
  if (redisOk && redisClient) {
    try { await redisClient.set(k, v, { EX: ttlSec }); return; }
    catch { redisOk = false; }
  }
  memSet(k, v, ttlSec);
}
async function cacheDel(k) {
  if (redisOk && redisClient) {
    try { return await redisClient.del(k); }
    catch { redisOk = false; }
  }
  return memDel(k);
}
async function cacheKeys(pattern) {
  if (redisOk && redisClient) {
    try { return await redisClient.keys(pattern); }
    catch { redisOk = false; }
  }
  return memKeys(pattern);
}

// ─── Product Catalog (in-memory + MongoDB) ────────────────────────────────────
const PRODUCTS = [
  { id:'p1',  name:'iPhone 17',            category:'Smartphones', price:99999,  basePopularity:0.95 },
  { id:'p2',  name:'MacBook Air M4',        category:'Laptops',     price:129999, basePopularity:0.85 },
  { id:'p3',  name:'Sony WH-1000XM6',      category:'Audio',       price:29999,  basePopularity:0.72 },
  { id:'p4',  name:'Samsung 4K QLED TV',   category:'Television',  price:89999,  basePopularity:0.68 },
  { id:'p5',  name:'Nike Air Max 2025',    category:'Footwear',    price:12999,  basePopularity:0.61 },
  { id:'p6',  name:'Gaming Laptop RTX',    category:'Laptops',     price:159999, basePopularity:0.58 },
  { id:'p7',  name:'Apple Watch Ultra 3',  category:'Wearables',   price:89999,  basePopularity:0.54 },
  { id:'p8',  name:'Adidas Running Shoes', category:'Footwear',    price:8999,   basePopularity:0.49 },
  { id:'p9',  name:'Mechanical Keyboard',  category:'Accessories', price:7999,   basePopularity:0.38 },
  { id:'p10', name:'Wireless Mouse Pro',   category:'Accessories', price:4999,   basePopularity:0.34 },
  { id:'p11', name:'USB-C Hub 12-Port',    category:'Accessories', price:3499,   basePopularity:0.28 },
  { id:'p12', name:'Webcam 4K',            category:'Peripherals', price:9999,   basePopularity:0.22 },
  { id:'p13', name:'HDMI Cable 8K',        category:'Accessories', price:1299,   basePopularity:0.17 },
  { id:'p14', name:'Laptop Stand',         category:'Accessories', price:2499,   basePopularity:0.13 },
  { id:'p15', name:'Old Tech Manual',      category:'Books',       price:499,    basePopularity:0.08 },
];

async function getProductFromDB(id) {
  if (mongoOk && mongoDb) {
    try { const p = await mongoDb.collection('products').findOne({ id }); if (p) return p; }
    catch { mongoOk = false; }
  }
  return PRODUCTS.find(p => p.id === id) || null;
}

// ─── TTL / Classification Helpers ────────────────────────────────────────────
function ttlFor(score)     { return score >= 0.75 ? 60 : score >= 0.4 ? 10 : 1; }
function classify(score)   { return score >= 0.75 ? 'HOT' : score >= 0.4 ? 'WARM' : 'COLD'; }

// ─── Per-Product Stats ────────────────────────────────────────────────────────
const productStats = new Map();
for (const p of PRODUCTS) {
  productStats.set(p.id, {
    requestCount: 0, cacheHits: 0, cacheMisses: 0,
    demandScore: p.basePopularity,
    ttl: ttlFor(p.basePopularity),
    cacheStatus: classify(p.basePopularity),
    lastAccessed: null, isCached: false,
    ts5m: [], ts30m: [],
  });
}

// ─── Global Metrics ───────────────────────────────────────────────────────────
const G = {
  totalRequests:0, cacheHits:0, cacheMisses:0, databaseQueries:0,
  queriesAvoided:0, evictions:0,
  trafficMode:'idle', requestsPerSec:0, requestsPerMin:0, simulationActive:false,
};
const COST_PER_QUERY = 0.005;
const MAX_CACHE_CAP  = 8;

// ─── Event Log ────────────────────────────────────────────────────────────────
const events = [];
function pushEvent(msg, type = 'info') {
  events.unshift({ time: new Date().toLocaleTimeString('en-GB'), message: msg, type });
  if (events.length > 50) events.pop();
}
pushEvent('SmartCache AI system initialized — ready for demo', 'info');

// ─── ML Prediction ────────────────────────────────────────────────────────────
async function predictDemand(features) {
  try {
    const r = await fetch(`${ML_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(features),
      signal: AbortSignal.timeout(1500),
    });
    if (r.ok) {
      const d = await r.json();
      mlOk = true;
      return { score: d.demand_score, classification: d.classification, source: 'RandomForest' };
    }
  } catch { /* fall through */ }
  mlOk = false;
  // Rule-based fallback
  const { requestsLast5Min:r5, requestsLast30Min:r30, recentTrafficGrowth:g, cacheHits:ch, cacheMisses:cm, basePopularity:bp, hourOfDay:h } = features;
  const hitR    = ch / Math.max(ch + cm, 1);
  const recency = Math.min(1, r5 / 80);
  const volume  = Math.min(1, r30 / 400);
  const growth  = Math.min(0.2, Math.max(0, g) * 0.2);
  const prime   = (h >= 17 && h <= 22) ? 0.05 : 0;
  const raw     = 0.30*bp + 0.28*recency + 0.20*volume + 0.12*hitR + growth + prime;
  const score   = parseFloat(Math.min(0.99, Math.max(0.01, raw)).toFixed(2));
  return { score, classification: classify(score), source: 'rule-based' };
}

// ─── Cache Capacity Enforcement ───────────────────────────────────────────────
async function getCachedCount() {
  const keys = await cacheKeys('product:*');
  return keys.length;
}
async function autoEvictColdest() {
  let coldId = null, lowest = Infinity;
  for (const [id, s] of productStats.entries()) {
    if (s.isCached && s.demandScore < lowest) { lowest = s.demandScore; coldId = id; }
  }
  if (coldId) {
    await cacheDel(`product:${coldId}`);
    productStats.get(coldId).isCached = false;
    G.evictions++;
    const name = PRODUCTS.find(p => p.id === coldId)?.name;
    pushEvent(`AUTO EVICTION — ${name} evicted (cache at capacity)`, 'evict');
  }
}

// ─── Core Request Handler ─────────────────────────────────────────────────────
async function handleProductRequest(id, simCtx = null) {
  const cacheKey = `product:${id}`;
  const cached = await cacheGet(cacheKey);
  const s = productStats.get(id);
  const now = Date.now();

  s.requestCount++;
  s.lastAccessed = new Date().toISOString();
  s.ts5m.push(now);  s.ts30m.push(now);
  s.ts5m  = s.ts5m.filter(t  => t > now - 5*60*1000);
  s.ts30m = s.ts30m.filter(t => t > now - 30*60*1000);
  G.totalRequests++;

  if (cached) {
    s.cacheHits++;
    G.cacheHits++;
    G.queriesAvoided++;
    s.isCached = true;
    const name = JSON.parse(cached).name;
    if (!simCtx) pushEvent(`CACHE HIT — ${name} served from ${redisOk ? 'Redis' : 'in-memory'} cache`, 'hit');
    return { source:'cache', product:JSON.parse(cached), meta:{ ttl:s.ttl, demandScore:s.demandScore, cacheStatus:s.cacheStatus, responseTimeMs: 10 + Math.floor(Math.random()*20) } };
  }

  s.cacheMisses++;
  G.cacheMisses++;
  G.databaseQueries++;
  const product = await getProductFromDB(id);
  if (!product) return null;
  if (!simCtx) pushEvent(`CACHE MISS — ${product.name} fetched from ${mongoOk ? 'MongoDB' : 'in-memory'} database`, 'miss');

  const features = {
    requestsLast5Min:     s.ts5m.length,
    requestsLast30Min:    s.ts30m.length,
    recentTrafficGrowth:  simCtx?.growth ?? (G.trafficMode === 'spike' ? 0.9 : 0.1),
    cacheHits:   s.cacheHits,
    cacheMisses: s.cacheMisses,
    hourOfDay:   new Date().getHours(),
    basePopularity: product.basePopularity || 0.5,
  };

  const pred = await predictDemand(features);
  s.demandScore  = pred.score;
  s.ttl          = ttlFor(pred.score);
  s.cacheStatus  = classify(pred.score);

  if (!simCtx) {
    pushEvent(`ML PREDICTION — ${product.name} demand score = ${pred.score.toFixed(2)} [${pred.source}]`, 'ml');
    pushEvent(`TTL UPDATED — ${product.name} TTL set to ${s.ttl} min (${s.cacheStatus})`, 'ttl');
  }

  if (await getCachedCount() >= MAX_CACHE_CAP) await autoEvictColdest();
  await cacheSet(cacheKey, JSON.stringify(product), s.ttl * 60);
  s.isCached = true;

  return {
    source: mongoOk ? 'MongoDB' : 'in-memory',
    cacheBackend: redisOk ? 'Redis' : 'In-Memory',
    product,
    meta: { ttl:s.ttl, demandScore:s.demandScore, cacheStatus:s.cacheStatus, mlSource:pred.source, responseTimeMs: 100 + Math.floor(Math.random()*150) },
  };
}

// ─── Traffic Simulation ───────────────────────────────────────────────────────
const TRAFFIC = {
  normal: { rps:1.7,  rpm:100,  bias:0.60, growth:0.1 },
  high:   { rps:5.0,  rpm:300,  bias:0.70, growth:0.4 },
  spike:  { rps:33.0, rpm:2000, bias:0.85, growth:0.9 },
};

let simTimer = null;
let simElapsed = 0;

function pickProduct(bias) {
  const sorted = [...PRODUCTS].sort((a,b) => b.basePopularity - a.basePopularity);
  const r = Math.random();
  if (r < bias * 0.45) return sorted[0].id;
  if (r < bias * 0.65) return sorted[1].id;
  if (r < bias * 0.80) return sorted[2].id;
  if (r < bias * 0.90) return sorted[3].id;
  return PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)].id;
}

function startSim(mode) {
  if (simTimer) clearInterval(simTimer);
  const cfg = TRAFFIC[mode];
  if (!cfg) return;
  G.simulationActive = true; G.trafficMode = mode;
  G.requestsPerSec = cfg.rps; G.requestsPerMin = cfg.rpm;
  simElapsed = 0;

  const label = { normal:'100 req/min', high:'300 req/min', spike:'2,000 req/min' }[mode];
  if (mode === 'spike') pushEvent(`TRAFFIC SPIKE — Surge to 2,000 req/min detected!`, 'spike');
  else pushEvent(`${mode.toUpperCase()} TRAFFIC — ${label} simulation started`, 'info');

  const TICK_MS   = 500;
  const perTick   = Math.max(1, Math.round(cfg.rps * (TICK_MS / 1000)));

  simTimer = setInterval(async () => {
    simElapsed += TICK_MS;
    for (let i = 0; i < perTick; i++) {
      const id = pickProduct(cfg.bias);
      await handleProductRequest(id, { growth: cfg.growth });
    }
    // Demand score boost during spike
    if (mode === 'spike' && simElapsed % 6000 === 0) {
      for (const [id, s] of productStats.entries()) {
        if (s.ts5m.length >= 5) {
          s.demandScore = parseFloat(Math.min(0.99, s.demandScore + 0.08).toFixed(2));
          s.ttl = ttlFor(s.demandScore);
          s.cacheStatus = classify(s.demandScore);
        }
      }
      pushEvent('CACHE OPTIMIZATION — Hot products TTL extended during spike', 'ml');
    }
  }, TICK_MS);
}

function stopSim() {
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
  G.simulationActive = false; G.trafficMode = 'idle';
  G.requestsPerSec = 0; G.requestsPerMin = 0;
  pushEvent('Traffic simulation stopped', 'info');
}

// ─── Metrics Helper ───────────────────────────────────────────────────────────
function buildMetrics(cachedItems) {
  const hitRate = G.totalRequests > 0 ? (G.cacheHits / G.totalRequests)*100 : 0;
  const dbLoadReduction = G.totalRequests > 0 ? (1 - G.databaseQueries / G.totalRequests)*100 : 0;
  return {
    ...G,
    hitRate:          parseFloat(hitRate.toFixed(1)),
    dbLoadReduction:  parseFloat(dbLoadReduction.toFixed(1)),
    estimatedSavings: parseFloat((G.queriesAvoided * COST_PER_QUERY).toFixed(4)),
    cachedItems,
    cacheCapacity:    MAX_CACHE_CAP,
    cacheUsagePct:    parseFloat(((cachedItems / MAX_CACHE_CAP)*100).toFixed(1)),
    costPerQuery:     COST_PER_QUERY,
    services: {
      redis:   redisOk  ? 'connected'  : 'simulation',
      mongodb: mongoOk  ? 'connected'  : 'simulation',
      ml:      mlOk     ? 'connected'  : 'rule-based',
    },
  };
}

function buildProducts() {
  return PRODUCTS.map(p => {
    const s = productStats.get(p.id);
    return { ...p, ...s, requestsLast5Min: s.ts5m.length, requestsLast30Min: s.ts30m.length };
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok:true, redis: redisOk?'connected':'simulation', mongodb: mongoOk?'connected':'simulation', ml: mlOk?'connected':'rule-based' });
});

app.get('/api/products', (req, res) => res.json(buildProducts()));

app.get('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  if (!PRODUCTS.find(p => p.id === id)) return res.status(404).json({ error:'Product not found' });
  const result = await handleProductRequest(id);
  if (!result) return res.status(404).json({ error:'Not found' });
  res.json(result);
});

app.get('/api/metrics', async (req, res) => {
  const c = await getCachedCount();
  res.json(buildMetrics(c));
});

app.get('/api/cache/status', async (req, res) => {
  const c = await getCachedCount();
  res.json({ products: buildProducts(), capacity: MAX_CACHE_CAP, cachedCount: c });
});

app.get('/api/events', (req, res) => res.json(events.slice(0, 30)));

app.get('/api/stats', async (req, res) => {
  const c = await getCachedCount();
  res.json({ ...buildMetrics(c), products: buildProducts(), events });
});

app.post('/api/simulation/start', (req, res) => {
  const { mode } = req.body;
  if (!TRAFFIC[mode]) return res.status(400).json({ error:'Invalid mode: normal|high|spike' });
  startSim(mode);
  res.json({ ok:true, mode });
});

app.post('/api/simulation/mode', (req, res) => {
  const { mode } = req.body;
  if (mode === 'stop') { stopSim(); return res.json({ ok:true, mode:'stopped' }); }
  if (!TRAFFIC[mode]) return res.status(400).json({ error:'Invalid mode' });
  startSim(mode);
  res.json({ ok:true, mode });
});

app.post('/api/simulation/reset', async (req, res) => {
  stopSim();
  Object.assign(G, { totalRequests:0, cacheHits:0, cacheMisses:0, databaseQueries:0, queriesAvoided:0, evictions:0, trafficMode:'idle', requestsPerSec:0, requestsPerMin:0, simulationActive:false });
  for (const p of PRODUCTS) {
    productStats.set(p.id, { requestCount:0, cacheHits:0, cacheMisses:0, demandScore:p.basePopularity, ttl:ttlFor(p.basePopularity), cacheStatus:classify(p.basePopularity), lastAccessed:null, isCached:false, ts5m:[], ts30m:[] });
  }
  const keys = await cacheKeys('product:*');
  for (const k of keys) await cacheDel(k);
  memCache.clear();
  events.length = 0;
  pushEvent('Demo reset — cache, metrics, and events cleared', 'info');
  res.json({ ok:true });
});

app.post('/api/cache/evict-cold', async (req, res) => {
  let evicted = 0;
  const names = [];
  for (const p of PRODUCTS) {
    const s = productStats.get(p.id);
    if (s.cacheStatus === 'COLD') {
      const n = await cacheDel(`product:${p.id}`);
      if (n) { evicted++; s.isCached = false; G.evictions++; names.push(p.name); }
    }
  }
  const msg = evicted > 0
    ? `EVICTION — ${evicted} cold product(s) removed from cache: ${names.join(', ')}`
    : 'No cold products in cache to evict';
  pushEvent(msg, 'evict');
  res.json({ evicted, evictedNames: names });
});

// Legacy endpoints (for any existing frontend calls)
app.post('/api/simulate/spike', (req, res) => {
  const isSpike = G.trafficMode !== 'spike';
  if (isSpike) startSim('spike'); else stopSim();
  res.json({ spike: isSpike });
});

// ─── Static Frontend Serving ────────────────────────────────────────────────
const distPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    res.status(404).json({ error: 'Endpoint not found' });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`SmartCache AI backend running on :${PORT}`));
}

// ─── Connect Services (non-blocking background) ───────────────────────────────
async function connectRedis() {
  try {
    redisClient = createClient({ url: REDIS_URL, socket: { connectTimeout: 2000 } });
    redisClient.on('error', () => { redisOk = false; });
    redisClient.on('end',   () => { redisOk = false; });
    await redisClient.connect();
    redisOk = true;
    console.log('Redis connected');
  } catch (e) {
    redisOk = false;
    console.log('Redis unavailable — using in-memory cache');
  }
}

async function connectMongo() {
  try {
    const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 2000, connectTimeoutMS: 2000 });
    await client.connect();
    mongoDb = client.db(MONGO_DB);
    mongoOk = true;
    console.log('MongoDB connected');
    // Seed products
    const col = mongoDb.collection('products');
    for (const p of PRODUCTS) await col.updateOne({ id:p.id }, { $set:p }, { upsert:true });
    console.log('MongoDB seeded');
  } catch (e) {
    mongoOk = false;
    console.log('MongoDB unavailable — using in-memory catalog');
  }
}

// Connect in background — server is already accepting requests
connectRedis().catch(() => {});
connectMongo().catch(() => {});

export default app;

