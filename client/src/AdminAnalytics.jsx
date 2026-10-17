import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CalendarClock, Eye, FilePlus2, Globe2, Newspaper, RefreshCw, Send, Users } from 'lucide-react';
import { api } from './api.js';
import './AdminAnalytics.css';

const periods = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'last-week', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
];

const series = [
  { key: 'created', label: 'Created', color: '#bd2028' },
  { key: 'published', label: 'Published', color: '#167d69' },
  { key: 'scheduled', label: 'Scheduled', color: '#5375c5' },
];

function TrendChart({ points }) {
  const width = 760, height = 250, left = 38, right = 18, top = 18, bottom = 36;
  const max = Math.max(1, ...points.flatMap(point => series.map(item => point[item.key] || 0)));
  const x = index => left + (points.length <= 1 ? 0 : index * (width - left - right) / (points.length - 1));
  const y = value => top + (max - value) * (height - top - bottom) / max;
  const tickStep = points.length > 16 ? 4 : points.length > 8 ? 2 : 1;
  return (
    <div className="analytics-chart-scroll">
      <svg className="analytics-trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Articles created, published, and scheduled during the selected period">
        {[0, 1, 2, 3].map(tick => {
          const value = max - tick * max / 3, yy = y(value);
          return <g key={tick}><line x1={left} x2={width - right} y1={yy} y2={yy} className="analytics-gridline"/><text x={left - 10} y={yy + 4} textAnchor="end" className="analytics-axis-label">{Math.round(value)}</text></g>;
        })}
        {series.map(item => {
          const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point[item.key] || 0)}`).join(' ');
          return <g key={item.key}>
            <path d={path} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            {points.map((point, index) => <circle key={`${item.key}-${index}`} cx={x(index)} cy={y(point[item.key] || 0)} r="3.2" fill="white" stroke={item.color} strokeWidth="2"><title>{point.label}: {point[item.key] || 0} {item.label.toLowerCase()}</title></circle>)}
          </g>;
        })}
        {points.map((point, index) => index % tickStep === 0 || index === points.length - 1
          ? <text key={point.label} x={x(index)} y={height - 8} textAnchor="middle" className="analytics-axis-label">{point.label}</text>
          : null)}
      </svg>
    </div>
  );
}

export default function AdminAnalytics() {
  const [range, setRange] = useState('last-week');
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await api.get('/admin/analytics', { params: { range } });
      setData(response.data);
      setError('');
    } catch {
      setError('Could not load newsroom analytics. Check your connection and try again.');
    } finally {
      setRefreshing(false);
    }
  }, [range]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const cards = useMemo(() => [
    { label: 'Articles created', value: data?.summary.created ?? 0, icon: FilePlus2, tone: 'red' },
    { label: 'Published in period', value: data?.summary.published ?? 0, icon: Send, tone: 'green' },
    { label: 'Drafts created', value: data?.summary.drafts ?? 0, icon: Newspaper, tone: 'amber' },
    { label: 'Scheduled to publish', value: data?.summary.scheduled ?? 0, icon: CalendarClock, tone: 'blue' },
  ], [data]);

  const maxCategory = Math.max(1, ...(data?.categories || []).map(category => category.count));
  const maxPageViews = Math.max(1, ...(data?.audience?.topPages || []).map(page => page.views));
  const audience = data?.audience || {};
  const periodLabel = periods.find(period => period.value === range)?.label || 'Selected period';
  const isCurrentData = data?.range === range;

  return (
    <section className="analytics-module">
      <div className="analytics-toolbar">
        <div className="analytics-title-group"><span className="admin-eyebrow">LIVE NEWSROOM DATA</span><h2>Editorial analytics</h2><p>Article activity and audience data, refreshed every 30 seconds.</p></div>
        <div className="analytics-controls">
          <label htmlFor="analytics-period">Period</label>
          <select id="analytics-period" value={range} onChange={event => setRange(event.target.value)}>
            {periods.map(period => <option key={period.value} value={period.value}>{period.label}</option>)}
          </select>
          <button className="analytics-refresh" onClick={refresh} disabled={refreshing} aria-label="Refresh analytics"><RefreshCw size={15} className={refreshing ? 'analytics-spinning' : ''}/> Refresh</button>
        </div>
      </div>

      <div className="analytics-live-line"><span className="analytics-live-dot"/>Live database metrics<span className="analytics-live-separator">·</span>{periodLabel}{data?.updatedAt && isCurrentData && <span className="analytics-updated">Updated {new Date(data.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}</div>

      {isCurrentData && <section className="analytics-audience">
        <div className="analytics-audience-heading"><div><h3>Audience overview</h3><p>Anonymous browser counts. Live visitors are active within the last 90 seconds.</p></div></div>
        <div className="analytics-audience-grid">
          {[
            {label:'Live visitors',value:audience.activeVisitors??0,icon:Users,tone:'green'},
            {label:`Unique visitors · ${periodLabel}`,value:audience.uniqueVisitors??0,icon:Globe2,tone:'blue'},
            {label:'Total visitors',value:audience.totalVisitors??0,icon:Users,tone:'red'},
            {label:`Page views · ${periodLabel}`,value:audience.pageViews??0,icon:Eye,tone:'amber'},
            {label:'All-time page views',value:audience.totalPageViews??0,icon:Eye,tone:'blue'},
          ].map(({label,value,icon:Icon,tone})=><article className="analytics-stat-card" key={label}><span className={`analytics-stat-icon ${tone}`}><Icon size={17}/></span><span className="analytics-stat-label">{label}</span><strong>{value.toLocaleString()}</strong></article>)}
        </div>
      </section>}
      {error && <div className="admin-notice">{error}</div>}

      {!isCurrentData ? <div className="analytics-loading"><Activity size={19}/>{refreshing ? 'Loading analytics…' : 'Select a period to view analytics.'}</div> : <>
        <div className="analytics-stat-grid">
          {cards.map(({ label, value, icon: Icon, tone }) => <article className="analytics-stat-card" key={label}><span className={`analytics-stat-icon ${tone}`}><Icon size={17}/></span><span className="analytics-stat-label">{label}</span><strong>{value}</strong></article>)}
        </div>

        <div className="analytics-content-grid">
          <section className="admin-panel analytics-panel analytics-trend-panel">
            <div className="analytics-panel-heading"><div><h3>Publishing activity</h3><p>Created, published, and scheduled articles</p></div><Activity size={18}/></div>
            {data.trend?.length ? <TrendChart points={data.trend}/> : <div className="analytics-no-data">No activity in this period yet.</div>}
            <div className="analytics-legend">{series.map(item => <span key={item.key}><i style={{ background: item.color }}/>{item.label}</span>)}</div>
          </section>

          <section className="admin-panel analytics-panel analytics-category-panel">
            <div className="analytics-panel-heading"><div><h3>Top categories</h3><p>Published articles in this period</p></div><Newspaper size={18}/></div>
            {data.categories?.length ? <div className="analytics-category-list">{data.categories.map((category, index) => <div className="analytics-category-row" key={category.name}><div className="analytics-category-name"><span>{category.name}</span><strong>{category.count}</strong></div><div className="analytics-bar-track"><i style={{ width: `${category.count / maxCategory * 100}%`, animationDelay: `${index * 50}ms` }}/></div></div>)}</div> : <div className="analytics-no-data">No published articles in this period.</div>}
          </section>
          <section className="admin-panel analytics-panel analytics-pages-panel">
            <div className="analytics-panel-heading"><div><h3>Most viewed pages</h3><p>Page views during {periodLabel.toLowerCase()}</p></div><Eye size={18}/></div>
            {audience.topPages?.length ? <div className="analytics-category-list">{audience.topPages.map((page,index)=><div className="analytics-category-row" key={page.path}><div className="analytics-category-name"><span title={page.path}>{page.path}</span><strong>{page.views.toLocaleString()}</strong></div><div className="analytics-bar-track"><i style={{width:`${page.views/maxPageViews*100}%`,animationDelay:`${index*50}ms`}}/></div></div>)}</div> : <div className="analytics-no-data">No page views in this period yet.</div>}
          </section>
        </div>
      </>}
    </section>
  );
}
