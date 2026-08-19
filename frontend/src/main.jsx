import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import {
  Activity, Database, Server, Zap, TrendingUp, Trash2, RotateCcw,
  ShieldCheck, Clock, ShoppingBag, Cpu, AlertTriangle, CheckCircle2,
  XCircle, BarChart2, Layers, ArrowUpRight, ArrowDownRight, Radio,
  Terminal, Package, ChevronRight, Wifi, WifiOff
} from 'lucide-react';
import './styles.css';

const API = import.meta.env.VITE_API_URL !== undefined 
  ? import.meta.env.VITE_API_URL 
  : (typeof window !== 'undefined' && window.location.port === '5173' ? 'http://localhost:8000' : '');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const pct   = (n) => `${Number(n || 0).toFixed(1)}%`;
const num   = (n) => Number(n || 0).toLocaleString();

const PRODUCT_ICONS = {
  Smartphones: '📱', Laptops: '💻', Audio: '🎧', Television: '📺',
  Footwear: '👟', Wearables: '⌚', Accessories: '⌨️', Peripherals: '📷', Books: '📖',
};

function statusBadge(status) {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s === 'HOT')  return <span className="badge-hot">HOT</span>;
  if (s === 'WARM') return <span className="badge-warm">WARM</span>;
  return <span className="badge-cold">COLD</span>;
}

function DemandBar({ score }) {
  const pct = Math.round((score || 0) * 100);
  const color = pct >= 75 ? '#f87171' : pct >= 40 ? '#fbbf24' : '#94a3b8';
  return (
    <div className="demand-bar">
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.5s ease' }} />
    </div>
  );
}

// ─── Service Status Bar ───────────────────────────────────────────────────────
function ServiceStatus({ services }) {
  const s = services || {};
  const items = [
    { label: 'Redis',   value: s.redis,   icon: <Server size={11} /> },
    { label: 'MongoDB', value: s.mongodb, icon: <Database size={11} /> },
    { label: 'ML Engine', value: s.ml,   icon: <Cpu size={11} /> },
  ];
  return (
    <div className="flex items-center gap-3">
      {items.map(({ label, value, icon }) => {
        const ok = value === 'connected';
        return (
          <div key={label} className="flex items-center gap-1.5 text-xs font-medium">
            <span className={ok ? 'text-emerald-400' : 'text-amber-400'}>{icon}</span>
            <span className="text-slate-500">{label}:</span>
            <span className={ok ? 'text-emerald-400' : 'text-amber-400'}>
              {ok ? 'Connected' : value === 'rule-based' ? 'Rule-based' : 'Simulation'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon, title, value, sub, accent, trend, note }) {
  const accentMap = {
    blue:   { bg: 'rgba(51,112,255,0.12)',   text: '#60a5fa', glow: 'rgba(51,112,255,0.15)' },
    green:  { bg: 'rgba(34,197,94,0.12)',    text: '#4ade80', glow: 'rgba(34,197,94,0.15)' },
    orange: { bg: 'rgba(249,115,22,0.12)',   text: '#fb923c', glow: 'rgba(249,115,22,0.15)' },
    purple: { bg: 'rgba(168,85,247,0.12)',   text: '#c084fc', glow: 'rgba(168,85,247,0.15)' },
    yellow: { bg: 'rgba(245,158,11,0.12)',   text: '#fbbf24', glow: 'rgba(245,158,11,0.15)' },
    red:    { bg: 'rgba(239,68,68,0.12)',    text: '#f87171', glow: 'rgba(239,68,68,0.15)' },
  };
  const a = accentMap[accent] || accentMap.blue;

  return (
    <div className="kpi-card" style={{ boxShadow: `0 8px 32px ${a.glow}` }}>
      <div className="flex items-start justify-between">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: a.bg, color: a.text }}
        >
          {icon}
        </div>
        {trend !== undefined && (
          <span className={`text-xs font-semibold ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'} flex items-center gap-0.5`}>
            {trend >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1">{title}</div>
        <div className="text-2xl font-bold text-white leading-none">{value}</div>
        {sub && <div className="text-xs text-slate-500 mt-1.5">{sub}</div>}
        {note && <div className="text-xs text-amber-400/70 mt-1 italic">{note}</div>}
      </div>
    </div>
  );
}

// ─── Custom Tooltip for Charts ────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'rgba(8,12,22,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', fontSize: 12 }}>
      <div className="text-slate-400 mb-1.5 text-xs">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-0.5">
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: p.color }} />
          <span className="text-slate-300">{p.name}:</span>
          <span className="text-white font-semibold">{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Live Traffic Graph ───────────────────────────────────────────────────────
function TrafficChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
        <defs>
          <linearGradient id="gradRequests" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#3370ff" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#3370ff" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradHits" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradDB" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#f97316" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis dataKey="t" hide />
        <YAxis tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(val) => <span style={{ color: '#94a3b8' }}>{val}</span>}
        />
        <Area type="monotone" dataKey="requests" stroke="#3370ff" strokeWidth={2} fill="url(#gradRequests)" name="Requests" />
        <Area type="monotone" dataKey="hits"     stroke="#22c55e" strokeWidth={2} fill="url(#gradHits)"     name="Cache Hits" />
        <Area type="monotone" dataKey="dbQ"      stroke="#f97316" strokeWidth={2} fill="url(#gradDB)"      name="DB Queries" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Event Log ────────────────────────────────────────────────────────────────
const EVENT_META = {
  hit:   { color: '#4ade80', bg: 'rgba(34,197,94,0.1)',  label: 'HIT'   },
  miss:  { color: '#fb923c', bg: 'rgba(249,115,22,0.1)', label: 'MISS'  },
  ml:    { color: '#c084fc', bg: 'rgba(168,85,247,0.1)', label: 'ML'    },
  ttl:   { color: '#60a5fa', bg: 'rgba(51,112,255,0.1)', label: 'TTL'   },
  spike: { color: '#f87171', bg: 'rgba(239,68,68,0.1)',  label: 'SPIKE' },
  evict: { color: '#fbbf24', bg: 'rgba(245,158,11,0.1)', label: 'EVICT' },
  info:  { color: '#94a3b8', bg: 'rgba(100,116,139,0.1)',label: 'SYS'   },
};

function EventLog({ events }) {
  const listRef = useRef(null);

  return (
    <div ref={listRef} className="overflow-y-auto" style={{ height: 300 }}>
      {events.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-slate-600 text-sm gap-2">
          <Terminal size={24} />
          <span>Click a product to generate events</span>
        </div>
      )}
      {events.map((e, i) => {
        const meta = EVENT_META[e.type] || EVENT_META.info;
        return (
          <div key={i} className="event-item" style={{ animationDelay: `${i * 20}ms` }}>
            <div
              className="flex-shrink-0 text-xs font-bold px-1.5 py-0.5 rounded"
              style={{ background: meta.bg, color: meta.color, fontSize: 9, minWidth: 40, textAlign: 'center', marginTop: 2 }}
            >
              {meta.label}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-200 leading-snug">{e.message}</div>
              <div className="text-xs text-slate-600 mt-0.5 font-mono">{e.time}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Product Intelligence Table ───────────────────────────────────────────────
function ProductTable({ products }) {
  const sorted = [...products].sort((a, b) => (b.demandScore || 0) - (a.demandScore || 0));
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Requests</th>
            <th>Demand Score</th>
            <th>TTL</th>
            <th>Status</th>
            <th>Hits</th>
            <th>Misses</th>
            <th>Cached</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.id}>
              <td>
                <div className="flex items-center gap-2.5">
                  <span className="text-lg">{PRODUCT_ICONS[p.category] || '📦'}</span>
                  <div>
                    <div className="font-semibold text-slate-200 text-xs">{p.name}</div>
                    <div className="text-slate-600 text-xs">{p.category}</div>
                  </div>
                </div>
              </td>
              <td className="font-mono text-slate-300 text-xs">{num(p.requestCount)}</td>
              <td>
                <div className="flex items-center">
                  <DemandBar score={p.demandScore} />
                  <span className="font-mono text-xs text-slate-300">{(p.demandScore || 0).toFixed(2)}</span>
                </div>
              </td>
              <td>
                <span className="font-mono text-xs text-slate-400">
                  {p.ttl === 60 ? '60 min' : p.ttl === 10 ? '10 min' : '1 min'}
                </span>
              </td>
              <td>{statusBadge(p.cacheStatus)}</td>
              <td className="font-mono text-emerald-400 text-xs">{num(p.cacheHits)}</td>
              <td className="font-mono text-orange-400 text-xs">{num(p.cacheMisses)}</td>
              <td>
                {p.isCached
                  ? <span className="text-emerald-400"><CheckCircle2 size={13} /></span>
                  : <span className="text-slate-600"><XCircle size={13} /></span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Traffic Simulator Panel ──────────────────────────────────────────────────
function TrafficSimulator({ metrics, onMode, onEvict, onReset }) {
  const mode = metrics?.trafficMode || 'idle';
  const modes = [
    { id: 'normal', label: 'Normal Traffic', desc: '~100 req/min', cls: 'btn-success' },
    { id: 'high',   label: 'High Traffic',   desc: '~300 req/min', cls: 'btn-warning' },
    { id: 'spike',  label: 'Traffic Spike',  desc: '~2,000 req/min', cls: 'btn-danger' },
  ];

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-white text-sm">Traffic Simulator</h3>
          <p className="text-xs text-slate-500 mt-0.5">Simulate real-world demand scenarios</p>
        </div>
        <div className="flex items-center gap-2">
          {mode !== 'idle' ? (
            <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full"
              style={{ background: mode === 'spike' ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.12)', color: mode === 'spike' ? '#f87171' : '#4ade80', border: `1px solid ${mode === 'spike' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.25)'}` }}>
              <span className={mode === 'spike' ? 'spike-dot' : 'live-dot'} />
              {mode === 'spike' ? 'TRAFFIC SPIKE ACTIVE' : mode === 'high' ? 'HIGH TRAFFIC' : 'NORMAL TRAFFIC'}
            </span>
          ) : (
            <span className="text-xs text-slate-600 px-3 py-1 rounded-full border border-slate-700/50">IDLE</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => onMode(mode === m.id ? 'stop' : m.id)}
            className={`${m.cls} flex-col items-center justify-center py-3 text-center`}
            style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}
          >
            <span className="font-semibold text-xs">{m.label}</span>
            <span className="opacity-70 text-xs">{m.desc}</span>
          </button>
        ))}
      </div>

      {/* Live metrics during simulation */}
      {mode !== 'idle' && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { label: 'Req/sec',  value: (metrics?.requestsPerSec || 0).toFixed(1) },
            { label: 'Req/min',  value: num(metrics?.requestsPerMin) },
            { label: 'Hit Rate', value: pct(metrics?.hitRate) },
          ].map(({ label, value }) => (
            <div key={label} className="text-center p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="text-base font-bold text-white">{value}</div>
              <div className="text-xs text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn-warning flex-1" onClick={onEvict}>
          <Trash2 size={14} /> Evict Cold Products
        </button>
        <button className="btn-ghost" onClick={onReset} title="Reset demo">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
    </div>
  );
}

// ─── Cache Capacity Gauge ─────────────────────────────────────────────────────
function CacheCapacity({ used, total }) {
  const pctVal = total > 0 ? (used / total) * 100 : 0;
  const color = pctVal >= 90 ? '#f87171' : pctVal >= 70 ? '#fbbf24' : '#4ade80';
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-bold text-white text-sm">Cache Capacity</h3>
          <p className="text-xs text-slate-500 mt-0.5">Max {total} concurrent items</p>
        </div>
        <Layers size={16} className="text-slate-600" />
      </div>
      <div className="flex items-end justify-between mb-2">
        <span className="text-3xl font-bold text-white">{used} / {total}</span>
        <span className="text-sm font-semibold" style={{ color }}>{pctVal.toFixed(0)}%</span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pctVal}%`, background: `linear-gradient(90deg, ${color}99, ${color})`, transition: 'width 0.5s ease' }} />
      </div>
      <div className="text-xs text-slate-600 mt-2">
        Intelligent eviction activates when full
      </div>
    </div>
  );
}

// ─── DB Load Reduction ────────────────────────────────────────────────────────
function DbLoadGauge({ reduction }) {
  const val = Math.max(0, Math.min(100, reduction || 0));
  const color = val >= 60 ? '#4ade80' : val >= 30 ? '#fbbf24' : '#f87171';
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-bold text-white text-sm">DB Load Reduction</h3>
          <p className="text-xs text-slate-500 mt-0.5">Queries avoided / total requests</p>
        </div>
        <Database size={16} className="text-slate-600" />
      </div>
      <div className="flex items-end justify-between mb-2">
        <span className="text-3xl font-bold" style={{ color }}>{val.toFixed(1)}%</span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${val}%`, background: `linear-gradient(90deg, ${color}80, ${color})`, transition: 'width 0.5s ease' }} />
      </div>
      <div className="text-xs text-slate-600 mt-2">
        Higher is better — more queries served from cache
      </div>
    </div>
  );
}

// ─── Admin Dashboard ──────────────────────────────────────────────────────────
function Dashboard({ metrics, products, events, chartData, onMode, onEvict, onReset }) {
  if (!metrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-500 text-sm flex items-center gap-2">
          <Activity size={16} className="animate-spin" />
          Connecting to backend...
        </div>
      </div>
    );
  }

  const kpis = [
    {
      icon: <Activity size={18} />, title: 'Cache Hit Rate', accent: 'green',
      value: pct(metrics.hitRate),
      sub: `${num(metrics.cacheHits)} hits / ${num(metrics.totalRequests)} requests`,
    },
    {
      icon: <Database size={18} />, title: 'Database Queries', accent: 'orange',
      value: num(metrics.databaseQueries),
      sub: 'MongoDB / in-memory lookups',
    },
    {
      icon: <TrendingUp size={18} />, title: 'Queries Avoided', accent: 'blue',
      value: num(metrics.queriesAvoided),
      sub: 'Database load reduced',
    },
    {
      icon: <Zap size={18} />, title: 'Est. Cost Savings', accent: 'purple',
      value: money(metrics.estimatedSavings),
      sub: `$${metrics.costPerQuery || '0.005'}/query estimate`,
      note: 'Simulated — not real billing',
    },
    {
      icon: <Layers size={18} />, title: 'Active Cached Items', accent: 'blue',
      value: `${metrics.cachedItems || 0} / ${metrics.cacheCapacity || 8}`,
      sub: `${metrics.cacheUsagePct || 0}% capacity used`,
    },
    {
      icon: <BarChart2 size={18} />, title: 'Total Requests', accent: 'yellow',
      value: num(metrics.totalRequests),
      sub: `${num(metrics.requestsPerMin)} req/min current`,
    },
    {
      icon: <Trash2 size={18} />, title: 'Cold Evictions', accent: 'red',
      value: num(metrics.evictions),
      sub: 'Cold products removed from cache',
    },
    {
      icon: <Radio size={18} />, title: 'Traffic Mode', accent: metrics.trafficMode === 'spike' ? 'red' : 'green',
      value: metrics.trafficMode === 'idle' ? 'IDLE' : metrics.trafficMode.toUpperCase(),
      sub: metrics.simulationActive ? 'Simulation running' : 'No simulation active',
    },
  ];

  return (
    <main className="max-w-screen-2xl mx-auto px-6 py-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-1">Operations Center</div>
          <h1 className="text-2xl font-bold text-white">SmartCache Admin Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Real-time cache intelligence, ML demand prediction and cost analysis</p>
        </div>
        <ServiceStatus services={metrics.services} />
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {kpis.map((k) => <KpiCard key={k.title} {...k} />)}
      </div>

      {/* Main Row: Chart + Events */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
        {/* Live Chart */}
        <div className="lg:col-span-3 glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-white text-sm">Live Traffic Analytics</h3>
              <p className="text-xs text-slate-500 mt-0.5">Requests vs Cache Hits vs Database Queries</p>
            </div>
            <span className={`flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full ${metrics.trafficMode === 'spike' ? 'text-red-400' : 'text-emerald-400'}`}
              style={{ background: metrics.trafficMode === 'spike' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)' }}>
              <span className={metrics.trafficMode === 'spike' ? 'spike-dot' : 'live-dot'} />
              {metrics.trafficMode === 'spike' ? 'SPIKE' : metrics.trafficMode === 'idle' ? 'IDLE' : 'LIVE'}
            </span>
          </div>
          <TrafficChart data={chartData} />
        </div>

        {/* Event Log */}
        <div className="lg:col-span-2 glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-white text-sm">System Event Log</h3>
              <p className="text-xs text-slate-500 mt-0.5">Real-time cache decisions</p>
            </div>
            <ShieldCheck size={15} className="text-slate-600" />
          </div>
          <EventLog events={events} />
        </div>
      </div>

      {/* Second Row: Simulator + Capacity + DB Load */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <TrafficSimulator metrics={metrics} onMode={onMode} onEvict={onEvict} onReset={onReset} />
        <CacheCapacity used={metrics.cachedItems || 0} total={metrics.cacheCapacity || 8} />
        <DbLoadGauge reduction={metrics.dbLoadReduction} />
      </div>

      {/* Product Intelligence Table */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-white text-sm">Product Cache Intelligence</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              ML demand scoring → Dynamic TTL → HOT / WARM / COLD classification
            </p>
          </div>
          <Clock size={15} className="text-slate-600" />
        </div>
        <ProductTable products={products} />
      </div>

      {/* TTL Policy Reference */}
      <div className="mt-4 glass-card p-5">
        <div className="flex flex-wrap gap-6 items-center">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500">TTL Policy</div>
          {[
            { label: 'HOT', ttl: '60 min', score: '≥ 0.75', cls: 'badge-hot' },
            { label: 'WARM', ttl: '10 min', score: '0.40–0.74', cls: 'badge-warm' },
            { label: 'COLD', ttl: '1 min', score: '< 0.40', cls: 'badge-cold' },
          ].map(({ label, ttl, score, cls }) => (
            <div key={label} className="flex items-center gap-2">
              <span className={cls}>{label}</span>
              <span className="text-xs text-slate-400">Demand {score}</span>
              <ChevronRight size={12} className="text-slate-600" />
              <span className="text-xs font-semibold text-white font-mono">{ttl} TTL</span>
            </div>
          ))}
          <div className="ml-auto text-xs text-slate-600 italic">
            Cost model: $0.005 per avoided DB query — Simulation only
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── Store Product Card ───────────────────────────────────────────────────────
function ProductCard({ product, onRequest }) {
  const icon = PRODUCT_ICONS[product.category] || '📦';
  const status = product.cacheStatus || 'COLD';
  return (
    <div className="product-card" onClick={() => onRequest(product.id)}>
      <div className="flex items-center justify-center py-8"
        style={{ background: 'rgba(255,255,255,0.03)', fontSize: 48 }}>
        {icon}
      </div>
      <div className="p-4">
        <div className="text-xs text-blue-400 font-semibold uppercase tracking-wider mb-1">{product.category}</div>
        <h3 className="font-bold text-white text-sm leading-snug mb-1">{product.name}</h3>
        <div className="text-lg font-bold text-white mb-3">
          ₹{Number(product.price).toLocaleString()}
        </div>
        <div className="flex items-center justify-between">
          {statusBadge(status)}
          <span className="text-xs text-slate-500 font-mono">TTL {product.ttl}m</span>
        </div>
        <div className="mt-2.5 text-xs text-slate-500 flex justify-between">
          <span>Hits: <span className="text-emerald-400 font-mono">{num(product.cacheHits)}</span></span>
          <span>Score: <span className="text-slate-300 font-mono">{(product.demandScore || 0).toFixed(2)}</span></span>
        </div>
        <button
          className="btn-primary w-full mt-3 justify-center text-xs py-2"
          onClick={(e) => { e.stopPropagation(); onRequest(product.id); }}
        >
          View Product
        </button>
      </div>
    </div>
  );
}

// ─── Request Result Banner ────────────────────────────────────────────────────
function RequestResult({ result, onClose }) {
  if (!result) return null;
  const isHit = result.source === 'cache';
  const product = result.product || {};
  const meta = result.meta || {};

  return (
    <div className={`animate-fade-up p-4 mb-5 ${isHit ? 'result-hit' : 'result-miss'}`}>
      <div className="flex items-start gap-4">
        <div className="text-2xl">{isHit ? '⚡' : '🗄️'}</div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            {isHit
              ? <span className="badge-hit">CACHE HIT</span>
              : <span className="badge-miss">CACHE MISS</span>}
            <span className="text-xs font-mono text-slate-400">{meta.responseTimeMs}ms response time</span>
            {isHit
              ? <span className="text-xs text-emerald-400">Served from {result.cacheBackend || 'Redis'}</span>
              : <span className="text-xs text-orange-400">Fetched from {result.source || 'Database'}</span>}
          </div>
          <div className="text-sm font-semibold text-white mb-1">{product.name}</div>
          <div className="flex flex-wrap gap-4 text-xs text-slate-400 mt-2">
            <span>Demand Score: <b className="text-slate-200">{(meta.demandScore || 0).toFixed(2)}</b></span>
            <span>TTL: <b className="text-slate-200">{meta.ttl} min</b></span>
            <span>Status: {statusBadge(meta.cacheStatus)}</span>
            {meta.mlSource && <span>ML: <b className="text-slate-200">{meta.mlSource}</b></span>}
          </div>
          {!isHit && (
            <div className="mt-2 text-xs text-orange-300/70 italic">
              Product fetched from database, ML demand score calculated, TTL assigned, and product cached for future requests.
            </div>
          )}
          {isHit && (
            <div className="mt-2 text-xs text-emerald-300/70 italic">
              Database query avoided. This request was served instantly from cache.
            </div>
          )}
        </div>
        <button className="text-slate-600 hover:text-slate-400 transition-colors text-xl leading-none" onClick={onClose}>
          ×
        </button>
      </div>
    </div>
  );
}

// ─── Store Page ───────────────────────────────────────────────────────────────
function Store({ products, onRequest, lastResult, onClearResult, loading }) {
  return (
    <main className="max-w-screen-2xl mx-auto px-6 py-6">
      {/* Hero */}
      <div className="rounded-2xl p-6 mb-6 overflow-hidden relative"
        style={{ background: 'linear-gradient(135deg, rgba(19,32,68,0.8), rgba(11,17,38,0.95))', border: '1px solid rgba(51,112,255,0.2)' }}>
        <div className="absolute inset-0 opacity-5"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, #3370ff 0%, transparent 50%), radial-gradient(circle at 80% 50%, #8b5cf6 0%, transparent 50%)' }} />
        <div className="relative">
          <div className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-2">Smart E-Commerce Demo</div>
          <h1 className="text-3xl font-bold text-white mb-2">
            Every product request is <span className="text-blue-400">intelligently cached.</span>
          </h1>
          <p className="text-slate-400 text-sm max-w-2xl">
            Click any product to generate a real API request through the SmartCache middleware.
            First click = Cache MISS (database fetch). Second click = Cache HIT (Redis served).
            Watch demand scores and TTL values update dynamically.
          </p>
        </div>
      </div>

      {/* Result Banner */}
      {lastResult && (
        <RequestResult result={lastResult} onClose={onClearResult} />
      )}

      {/* Products Grid */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-white">Product Catalog</h2>
          <p className="text-xs text-slate-500 mt-0.5">Click a product to trigger a real cache lookup</p>
        </div>
        {loading && (
          <span className="text-xs text-blue-400 flex items-center gap-1.5">
            <Activity size={12} className="animate-spin" /> Processing request...
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} onRequest={onRequest} />
        ))}
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        {[
          { icon: '⚡', title: 'Cache HIT', color: '#4ade80', desc: 'Product returned from Redis instantly. No database query. Response time: 10–30ms.' },
          { icon: '🗄️', title: 'Cache MISS', color: '#fb923c', desc: 'Product fetched from MongoDB. ML predicts demand score. TTL calculated. Cached for next request. Response time: 100–250ms.' },
          { icon: '🧠', title: 'ML Prediction', color: '#c084fc', desc: 'RandomForest model scores demand 0–1. HOT gets 60min TTL, WARM gets 10min, COLD gets 1min. Eviction targets lowest scores.' },
        ].map(({ icon, title, color, desc }) => (
          <div key={title} className="glass-card p-4 flex gap-3">
            <div className="text-2xl">{icon}</div>
            <div>
              <div className="font-bold text-sm mb-1" style={{ color }}>{title}</div>
              <div className="text-xs text-slate-500 leading-relaxed">{desc}</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
function App() {
  const [tab, setTab] = useState('store');
  const [products, setProducts] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [events, setEvents] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [chartData, setChartData] = useState([]);
  const [backendOk, setBackendOk] = useState(true);
  const prevMetricsRef = useRef(null);

  const fetchAll = useCallback(async () => {
    try {
      const [metricsRes, productsRes, eventsRes] = await Promise.all([
        fetch(`${API}/api/metrics`).then((r) => r.json()),
        fetch(`${API}/api/products`).then((r) => r.json()),
        fetch(`${API}/api/events`).then((r) => r.json()),
      ]);
      setMetrics(metricsRes);
      setProducts(productsRes);
      setEvents(eventsRes);
      setBackendOk(true);

      // Append to chart data
      setChartData((prev) => {
        const point = {
          t: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          requests: metricsRes.totalRequests,
          hits: metricsRes.cacheHits,
          dbQ: metricsRes.databaseQueries,
        };
        return [...prev.slice(-29), point];
      });
    } catch {
      setBackendOk(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 1200);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const handleRequest = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/products/${id}`);
      const data = await res.json();
      setLastResult(data);
      await fetchAll();
    } catch (e) {
      console.error('Request failed:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleMode = async (mode) => {
    try {
      await fetch(`${API}/api/simulation/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      await fetchAll();
    } catch (e) { console.error(e); }
  };

  const handleEvict = async () => {
    try {
      await fetch(`${API}/api/cache/evict-cold`, { method: 'POST' });
      await fetchAll();
    } catch (e) { console.error(e); }
  };

  const handleReset = async () => {
    try {
      await fetch(`${API}/api/simulation/reset`, { method: 'POST' });
      setLastResult(null);
      setChartData([]);
      await fetchAll();
    } catch (e) { console.error(e); }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#080c14' }}>
      {/* Header */}
      <header style={{ background: 'rgba(8,12,22,0.95)', borderBottom: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div className="max-w-screen-2xl mx-auto px-6 flex items-center justify-between" style={{ height: 60 }}>
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl font-black text-sm text-white"
              style={{ background: 'linear-gradient(135deg, #3370ff, #1a4ff5)', boxShadow: '0 4px 15px rgba(51,112,255,0.35)' }}>
              SC
            </div>
            <div>
              <div className="font-bold text-white text-base leading-none">
                SmartCache <span style={{ color: '#60a5fa' }}>AI</span>
              </div>
              <div className="text-xs text-slate-600">Predictive Cache Optimization</div>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex items-center" style={{ gap: 0 }}>
            <button
              className={`nav-tab ${tab === 'store' ? 'active' : ''}`}
              onClick={() => setTab('store')}
            >
              <ShoppingBag size={15} /> SmartShop
            </button>
            <button
              className={`nav-tab ${tab === 'admin' ? 'active' : ''}`}
              onClick={() => setTab('admin')}
            >
              <Activity size={15} /> Admin Dashboard
            </button>
          </nav>

          {/* Status */}
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(51,112,255,0.1)', border: '1px solid rgba(51,112,255,0.2)', color: '#60a5fa' }}>
              <span className="live-dot" /> DEMO MODE
            </div>
            <div className={`flex items-center gap-1.5 text-xs ${backendOk ? 'text-emerald-400' : 'text-red-400'}`}>
              {backendOk ? <Wifi size={13} /> : <WifiOff size={13} />}
              <span className="hidden sm:inline">{backendOk ? 'Backend Online' : 'Backend Offline'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Page */}
      {tab === 'store' ? (
        <Store
          products={products}
          onRequest={handleRequest}
          lastResult={lastResult}
          onClearResult={() => setLastResult(null)}
          loading={loading}
        />
      ) : (
        <Dashboard
          metrics={metrics}
          products={products}
          events={events}
          chartData={chartData}
          onMode={handleMode}
          onEvict={handleEvict}
          onReset={handleReset}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
