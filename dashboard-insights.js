(() => {
  'use strict';

  const renderedMarkup = new WeakMap();
  const dateFormats = [false, true].map((long) => new Intl.DateTimeFormat(undefined, long ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' }));
  const palette = ['#64dcc4', '#79a7ff', '#b99cff', '#ffad7d', '#f2ce75'];
  const observedNumber = (value) => value === null || value === undefined || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) || Number(value) < 0 ? null : Number(value);
  const safeColor = (value, index) => /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value || '') ? value : palette[index % palette.length];
  const defaultEscape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const percent = (value) => value > 0 && value < .1 ? '<0.1%' : `${value.toFixed(1)}%`;
  const dateLabel = (value, long = false) => dateFormats[Number(long)].format(new Date(`${value}T12:00:00`));
  const icon = (kind) => {
    const paths = {
      activity: '<path d="M3 16V9m6 7V4m6 12v-5m6 5V6"/>',
      allocation: '<path d="M10 3a9 9 0 1 0 11 11h-11V3Z"/><path d="M14 2v8h8a9 9 0 0 0-8-8Z"/>',
      composition: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>'
    };
    return `<span class="insight-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${paths[kind]}</svg></span>`;
  };

  function activityCard({ daily, providers, metric, rangeLabel, format, formatTokens, formatCurrency, escape }) {
    const ordered = daily.filter((point) => typeof point?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(new Date(`${point.date}T12:00:00`).getTime())).slice().sort((a, b) => a.date.localeCompare(b.date));
    const days = ordered.slice(-90).map((point) => {
      const values = (suffix) => providers.map((provider) => observedNumber(point[`${provider.id}${suffix}`]));
      const costs = values('');
      const tokens = values('Tokens');
      const chosen = metric === 'tokens' ? tokens : costs;
      return {
        date: point.date,
        cost: costs.some((value) => value !== null) ? costs.reduce((sum, value) => sum + (value ?? 0), 0) : null,
        tokens: tokens.some((value) => value !== null) ? tokens.reduce((sum, value) => sum + (value ?? 0), 0) : null,
        value: chosen.some((value) => value !== null) ? chosen.reduce((sum, value) => sum + (value ?? 0), 0) : null,
        partial: chosen.some((value) => value === null),
        costPartial: costs.some((value) => value === null),
        tokensPartial: tokens.some((value) => value === null)
      };
    });
    const maximum = Math.max(0, ...days.map((point) => point.value ?? 0));
    const active = days.filter((point) => point.value > 0).length;
    const peak = maximum > 0 ? days.find((point) => point.value === maximum) : null;
    const clipped = ordered.length > days.length;
    const partial = days.some((point) => point.partial || point.value === null);
    const columns = days.length <= 14 ? 7 : days.length <= 35 ? 10 : 15;
    const tiles = days.map((point) => {
      const level = point.value === null ? 'unknown' : point.value === 0 ? '0' : String(Math.min(4, Math.max(1, Math.ceil(point.value / maximum * 4))));
      const tokens = point.tokens === null ? 'tokens not reported' : `${formatTokens(point.tokens)} tokens${point.tokensPartial ? ' (partial)' : ''}`;
      const cost = point.cost === null ? 'API estimate not reported' : `${formatCurrency(point.cost)} API estimate${point.costPartial ? ' (partial)' : ''}`;
      const description = `${dateLabel(point.date, true)} · ${tokens} · ${cost}`;
      return `<span class="insight-day" data-level="${level}" tabindex="0" role="img" aria-label="${escape(description)}" title="${escape(description)}"><span class="insight-day-tip" aria-hidden="true">${escape(dateLabel(point.date))}<strong>${escape(point.value === null ? 'Not reported' : format(point.value))}</strong></span></span>`;
    }).join('');
    return `<article class="insight-card insight-activity"><div class="insight-card-heading">${icon('activity')}<div><h3>Activity fingerprint</h3><p>${escape(clipped ? `Latest 90 of ${ordered.length} daily records` : rangeLabel)} · ${metric === 'tokens' ? 'token intensity' : 'API estimate intensity'}</p></div><span class="insight-card-tag">DAILY</span></div><div class="insight-activity-stats"><div><strong>${days.length ? active : '—'}<small>${days.length ? ` / ${days.length}` : ''}</small></strong><span>days with recorded ${metric === 'tokens' ? 'tokens' : 'cost'}</span></div><div><strong>${escape(peak ? format(peak.value) : maximum === 0 && days.some((point) => point.value !== null) ? format(0) : '—')}</strong><span>${peak ? `peak · ${escape(dateLabel(peak.date))}` : 'peak daily activity'}</span></div></div>${days.length ? `<div class="insight-heatmap" style="--heat-columns:${columns}" role="group" aria-label="Daily ${metric === 'tokens' ? 'token' : 'API estimate'} activity. Focus each day for details.">${tiles}</div><div class="insight-heatmap-axis"><span>${escape(dateLabel(days[0].date))}</span><span>${escape(dateLabel(days[days.length - 1].date))}</span></div>` : '<div class="insight-empty">No daily records available for this range.</div>'}<div class="insight-card-foot"><span>${partial ? 'Available daily values · some incomplete' : 'One square per daily record'}</span><span class="insight-heatmap-key" aria-label="Intensity from low to high">Low<i data-level="1"></i><i data-level="2"></i><i data-level="3"></i><i data-level="4"></i>High</span></div></article>`;
  }

  function allocationCard({ providers, metric, rangeLabel, format, escape }) {
    const entries = providers.map((provider, index) => ({ name: provider.name || provider.shortName || provider.id || 'Unknown provider', value: observedNumber(provider[metric === 'tokens' ? 'tokens' : 'cost']), color: safeColor(provider.color, index) }));
    const total = entries.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
    const partial = entries.some((entry) => entry.value === null);
    let offset = 0;
    const segments = entries.filter((entry) => entry.value > 0).map((entry) => {
      const share = entry.value / total * 100;
      const segment = `<circle class="insight-donut-segment" cx="80" cy="80" r="63" pathLength="100" stroke="${entry.color}" stroke-dasharray="${share} ${100 - share}" stroke-dashoffset="${-offset}"><title>${escape(entry.name)}: ${escape(format(entry.value))} · ${escape(percent(share))}</title></circle>`;
      offset += share;
      return segment;
    }).join('');
    const legend = entries.map((entry) => `<li><span class="insight-provider-name"><i style="--insight-color:${entry.color}"></i>${escape(entry.name)}</span><span class="insight-provider-amount">${escape(entry.value === null ? 'Not reported' : format(entry.value))}<small>${escape(entry.value === null ? '—' : total ? percent(entry.value / total * 100) : '0.0%')}</small></span></li>`).join('');
    return `<article class="insight-card insight-allocation"><div class="insight-card-heading">${icon('allocation')}<div><h3>Provider mix</h3><p>${escape(rangeLabel)} · ${metric === 'tokens' ? 'observed tokens' : 'estimated API value'}</p></div><span class="insight-card-tag">SHARE</span></div><div class="insight-allocation-body"><div class="insight-donut"><svg viewBox="0 0 160 160" role="img" aria-label="${escape(`Provider allocation: ${entries.map((entry) => `${entry.name} ${entry.value === null ? 'not reported' : format(entry.value)}`).join(', ') || 'no data'}`)}"><circle class="insight-donut-track" cx="80" cy="80" r="63"/>${segments}</svg><div class="insight-donut-center"><strong>${escape(entries.some((entry) => entry.value !== null) ? format(total) : '—')}</strong><span>${metric === 'tokens' ? 'total tokens' : 'API estimate'}</span></div></div><ul class="insight-provider-legend">${legend || '<li class="insight-empty">No provider totals available.</li>'}</ul></div><div class="insight-card-foot"><span>${partial ? 'Shares use available provider totals.' : total === 0 ? 'No allocation to display in this range.' : metric === 'tokens' ? 'Share of reported provider tokens.' : 'API estimates are not subscription charges.'}</span></div></article>`;
  }

  function compositionCard({ summary, rangeLabel, formatTokens, escape }) {
    const parts = [
      { label: 'Cache reads', key: 'cachedInput', color: '#64dcc4' },
      { label: 'Uncached input', key: 'uncachedInput', color: '#79a7ff' },
      { label: 'Cache writes', key: 'cacheCreationInput', color: '#b99cff' },
      { label: 'Output', key: 'output', color: '#ffad7d' }
    ].map((part) => ({ ...part, value: observedNumber(summary[part.key]) }));
    const classified = parts.reduce((sum, part) => sum + (part.value ?? 0), 0);
    const total = observedNumber(summary.totalTokens);
    const exceedsTotal = total !== null && classified > total + Math.max(1, total * 1e-9);
    const denominator = total !== null && !exceedsTotal ? Math.max(total, classified) : classified;
    const unclassified = Math.max(0, denominator - classified);
    if (unclassified > 0) parts.push({ label: 'Unclassified', key: 'unclassified', color: '#677386', value: unclassified });
    const inputs = parts.slice(0, 3);
    const inputTotal = inputs.reduce((sum, part) => sum + (part.value ?? 0), 0);
    const cacheShare = inputs.every((part) => part.value !== null) && inputTotal > 0 ? inputs[0].value / inputTotal * 100 : null;
    const someReported = parts.some((part) => part.value !== null);
    const segments = parts.filter((part) => part.value > 0).map((part) => `<span style="width:${part.value / denominator * 100}%;--insight-color:${part.color}" title="${escape(`${part.label}: ${formatTokens(part.value)} tokens`)}"></span>`).join('');
    const legend = parts.map((part) => `<li><span class="insight-provider-name"><i style="--insight-color:${part.color}"></i>${part.label}</span><span class="insight-provider-amount">${escape(part.value === null ? 'Not reported' : formatTokens(part.value))}<small>${escape(part.value === null ? '—' : denominator ? percent(part.value / denominator * 100) : '0.0%')}</small></span></li>`).join('');
    const denominatorLabel = total !== null && !exceedsTotal ? 'reported tokens' : 'classified tokens';
    return `<article class="insight-card insight-composition"><div class="insight-card-heading">${icon('composition')}<div><h3>Token anatomy</h3><p>${escape(rangeLabel)} · summary breakdown</p></div><span class="insight-card-tag">FLOW</span></div><div class="insight-cache-stat"><strong>${escape(cacheShare === null ? '—' : percent(cacheShare))}</strong><span>of classified input<br>read from cache</span></div><div class="insight-token-stack" role="img" aria-label="${escape(`Token composition: ${parts.map((part) => `${part.label} ${part.value === null ? 'not reported' : `${formatTokens(part.value)} tokens`}`).join(', ')}`)}">${segments}</div><ul class="insight-provider-legend insight-token-legend">${legend}</ul><div class="insight-card-foot"><span>${someReported ? `Shares of ${escape(formatTokens(denominator))} ${denominatorLabel}.` : 'Token composition has not been reported.'}${exceedsTotal ? ' Breakdown exceeds the reported total.' : ''}<span class="insight-foot-detail">Cache rate uses reads + uncached input + writes.</span></span></div></article>`;
  }

  window.renderUsageInsights = function renderUsageInsights(options = {}) {
    const target = document.querySelector('#usage-insights');
    if (!target) return;
    const metric = options.metric === 'tokens' ? 'tokens' : 'cost';
    const formatTokens = typeof options.formatTokens === 'function' ? options.formatTokens : (value) => value.toLocaleString();
    const formatCurrency = typeof options.formatCurrency === 'function' ? options.formatCurrency : (value) => `$${value.toFixed(2)}`;
    const context = {
      daily: Array.isArray(options.daily) ? options.daily : [],
      providers: Array.isArray(options.providers) ? options.providers.filter((provider) => provider && typeof provider === 'object') : [],
      summary: options.summary && typeof options.summary === 'object' ? options.summary : {},
      rangeLabel: options.rangeLabel || 'Selected range',
      metric,
      formatTokens,
      formatCurrency,
      format: metric === 'tokens' ? formatTokens : formatCurrency,
      escape: typeof options.escapeHtml === 'function' ? options.escapeHtml : defaultEscape
    };
    const markup = `<div class="insights-heading"><div><span class="insights-eyebrow">THE BIG PICTURE</span><h2 id="usage-insights-title">Usage patterns<span>.</span></h2></div><span class="insights-range">${context.escape(context.rangeLabel)}</span></div><div class="insights-grid">${activityCard(context)}${allocationCard(context)}${compositionCard(context)}</div>`;
    if (renderedMarkup.get(target) !== markup) {
      target.innerHTML = markup;
      renderedMarkup.set(target, markup);
    }
  };
})();
