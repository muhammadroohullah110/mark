/**
 * Mark AI -- Admin Dashboard SPA
 * Renders inside #mark-ai-app container
 * Celestial High-Key Design System
 * Single-store flow with onboarding wizard.
 *
 * No external dependencies. Pure vanilla JS.
 * All styles are inline to survive WordPress admin CSS overrides.
 */

(function () {
    'use strict';

    /* ================================================================
       CONFIG
       ================================================================ */
    const REST  = markAI.restUrl;
    const NONCE = markAI.nonce;
    const PAGE  = markAI.currentPage;

    /* ================================================================
       STATE
       ================================================================ */
    let stores         = [];
    let currentStore   = null;
    let dashboardStats = {};
    let globalSettings = {};
    let activeTab      = 'settings';
    let currentPage    = 'dashboard';
    let chartInstances = {};  // Track Chart.js instances for cleanup

    /* ================================================================
       DESIGN TOKENS  — Mark "Aurora" (light, premium-fintech)
       page #F4F5FA / cards #FFFFFF · accent violet #7C5CFF -> pink #FF6FA8
       text #14152A · muted #6B6F86 / #8A8FA8 · font Plus Jakarta Sans
       ================================================================ */
    const T = {
        pageBg: `background:radial-gradient(1000px 520px at 88% -12%, rgba(124,92,255,0.10), transparent 58%), radial-gradient(820px 520px at -5% 108%, rgba(255,111,168,0.09), transparent 58%), #F4F5FA;position:relative;color:#14152A;`,
        glass: `background:#FFFFFF;border:1px solid rgba(20,21,42,0.06);box-shadow:0 12px 34px rgba(20,21,60,0.07);border-radius:20px;position:relative;overflow:hidden;`,
        glassLight: `background:#FFFFFF;border:1px solid rgba(20,21,42,0.05);box-shadow:0 6px 20px rgba(20,21,60,0.05);border-radius:20px;`,
        input: `background:#FFFFFF;border:1px solid rgba(20,21,42,0.12);color:#14152A;padding:12px 14px;font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;width:100%;outline:none;border-radius:12px;transition:border-color .22s ease,box-shadow .22s ease;`,
        select: `background:#FFFFFF;border:1px solid rgba(20,21,42,0.12);color:#14152A;padding:12px 14px;font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;width:100%;outline:none;border-radius:12px;appearance:none;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237C5CFF' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;`,
        btnPrimary: `background:#14152A;color:#FFFFFF;border:none;border-radius:12px;padding:12px 24px;font-family:'Plus Jakarta Sans',sans-serif;font-weight:600;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:transform .2s ease,box-shadow .25s ease,filter .2s ease;box-shadow:0 8px 22px rgba(20,21,42,0.18);letter-spacing:0.01em;`,
        btnSecondary: `background:#FFFFFF;color:#14152A;border:1px solid rgba(20,21,42,0.12);border-radius:12px;padding:10px 20px;font-family:'Plus Jakarta Sans',sans-serif;font-weight:600;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all .2s ease;box-shadow:0 2px 8px rgba(20,21,60,0.04);`,
        btnDanger: `background:#FFFFFF;color:#D83A52;border:1px solid rgba(216,58,82,0.28);border-radius:12px;padding:10px 20px;font-family:'Plus Jakarta Sans',sans-serif;font-weight:600;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all .2s ease;`,
        label: `display:block;font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;font-weight:600;color:#8A8FA8;margin-bottom:6px;letter-spacing:0.02em;line-height:1;`,
        statValue: `font-family:'Plus Jakarta Sans',sans-serif;font-size:46px;font-weight:800;line-height:1.05;letter-spacing:-0.03em;background:linear-gradient(120deg,#7C5CFF 0%,#FF6FA8 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;`,
        headline: `font-family:'Plus Jakarta Sans',sans-serif;font-weight:700;color:#14152A;`,
        muted: `color:#6B6F86;font-size:13px;`,
        cardHoverShadow: '0 20px 48px rgba(124,92,255,0.18)',
        cardHoverBorder: 'rgba(124,92,255,0.4)',
        badgeActive: `display:inline-flex;align-items:center;gap:6px;padding:4px 12px;font-size:12px;font-weight:700;border-radius:9999px;background:#E7F8F0;border:1px solid #BFE9D4;color:#0E8A5C;font-family:'Plus Jakarta Sans',sans-serif;`,
        badgeInactive: `display:inline-flex;align-items:center;gap:6px;padding:4px 12px;font-size:12px;font-weight:700;border-radius:9999px;background:#F0F1F5;border:1px solid rgba(20,21,42,0.08);color:#8A8FA8;font-family:'Plus Jakarta Sans',sans-serif;`,
        tabBtn: `padding:12px 22px;font-family:'Plus Jakarta Sans',sans-serif;font-size:16px;font-weight:500;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;transition:all .2s ease;white-space:nowrap;color:#8A8FA8;`,
        tabBtnActive: `padding:12px 22px;font-family:'Plus Jakarta Sans',sans-serif;font-size:16px;font-weight:700;background:none;border:none;border-bottom:2px solid #7C5CFF;cursor:pointer;transition:all .2s ease;white-space:nowrap;color:#7C5CFF;`,
    };

    /* ================================================================
       UTILITIES
       ================================================================ */
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    function esc(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    function formatNum(n) {
        if (n === undefined || n === null) return '0';
        return Number(n).toLocaleString();
    }

    function formatDate(dateStr) {
        if (!dateStr) return '--';
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) { return dateStr; }
    }

    /* ================================================================
       API
       ================================================================ */
    async function api(method, path, body = null) {
        const opts = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-WP-Nonce': NONCE,
            },
        };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(REST + path, opts);
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || data.error || 'HTTP ' + res.status);
        }
        return data;
    }

    /* ================================================================
       TOAST
       ================================================================ */
    function toast(message, type = 'success') {
        const existing = document.querySelector('.mark-ai-toast');
        if (existing) existing.remove();

        const colors = {
            success: { bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.3)', text: '#16a34a', icon: 'check_circle' },
            error:   { bg: 'rgba(186,26,26,0.1)', border: 'rgba(186,26,26,0.25)', text: '#D83A52', icon: 'error' },
            info:    { bg: 'rgba(79,97,105,0.1)', border: 'rgba(79,97,105,0.25)', text: '#6B6F86', icon: 'info' },
        };
        const c = colors[type] || colors.info;

        const el = document.createElement('div');
        el.className = 'mark-ai-toast';
        el.style.cssText = `position:fixed;top:40px;right:20px;z-index:999999;min-width:320px;padding:16px 20px;border-radius:12px;font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;backdrop-filter:blur(16px);border:1px solid ${c.border};background:${c.bg};color:${c.text};transform:translateX(120%);transition:transform 0.4s cubic-bezier(0.4,0,0.2,1);display:flex;align-items:center;gap:10px;`;
        el.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px;">${c.icon}</span><span>${esc(message)}</span>`;
        document.body.appendChild(el);
        requestAnimationFrame(() => { el.style.transform = 'translateX(0)'; });
        setTimeout(() => { el.style.transform = 'translateX(120%)'; setTimeout(() => el.remove(), 400); }, 3500);
    }

    /* ================================================================
       SKELETON + KEYFRAMES
       ================================================================ */
    function skeleton(height = '200px') {
        return `<div style="height:${height};border-radius:14px;background:linear-gradient(90deg,rgba(20,21,42,0.05) 25%,rgba(124,92,255,0.12) 50%,rgba(20,21,42,0.05) 75%);background-size:200% 100%;animation:markShimmer 1.5s infinite;"></div>`;
    }

    /** Cute robot head loader — replaces boring spinners */
    function robotLoader(text = 'Loading...', size = 32) {
        return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#6B6F86;padding:40px;min-height:55vh;text-align:center;">
            <div style="animation:markRobotBob 1s ease-in-out infinite;">
                <svg width="${size}" height="${size}" viewBox="0 0 20 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <line x1="10" y1="0.5" x2="10" y2="3" stroke="#7C5CFF" stroke-width="1" stroke-linecap="round"/>
                    <circle cx="10" cy="0.5" r="0.8" fill="#7C5CFF"/>
                    <rect x="3" y="3" width="14" height="10" rx="3" fill="#7C5CFF"/>
                    <circle cx="7" cy="7.5" r="2" fill="white"/>
                    <circle cx="13" cy="7.5" r="2" fill="white"/>
                    <circle cx="7" cy="7.5" r="0.9" fill="#1a1a1a"/>
                    <circle cx="13" cy="7.5" r="0.9" fill="#1a1a1a"/>
                    <path d="M7.5 10.5 Q10 12.5 12.5 10.5" stroke="#7C5CFF" stroke-width="0.7" fill="none" stroke-linecap="round"/>
                </svg>
            </div>
            <span style="font-size:14px;">${text}</span>
        </div>`;
    }

    function injectKeyframes() {
        if (document.getElementById('mark-ai-keyframes')) return;
        const style = document.createElement('style');
        style.id = 'mark-ai-keyframes';
        style.textContent = `
            @keyframes markShimmer { 0%{background-position:200% 0}100%{background-position:-200% 0} }
            @keyframes markPulse { 0%,100%{opacity:1}50%{opacity:0.4} }
            @keyframes markSpin { 0%{transform:rotate(0deg)}100%{transform:rotate(360deg)} }
            @keyframes markRobotBob { 0%,100%{transform:translateY(0) rotate(0deg)}25%{transform:translateY(-6px) rotate(-4deg)}50%{transform:translateY(0) rotate(0deg)}75%{transform:translateY(-6px) rotate(4deg)} }
            @keyframes markFloat { 0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)} }
            @keyframes markRise { 0%{opacity:0;transform:translateY(14px)}100%{opacity:1;transform:none} }
            @keyframes markGlow { 0%,100%{opacity:0.5}50%{opacity:0.9} }
            #mark-ai-app, .mark-ai-app-root { color:#14152A; }
            .mark-ai-app-root ::selection { background:rgba(124,92,255,0.22); color:#14152A; }
            .mark-ai-app-root input::placeholder, .mark-ai-app-root textarea::placeholder { color:rgba(20,21,42,0.4); }
            .mark-ai-app-root input:focus,.mark-ai-app-root textarea:focus,.mark-ai-app-root select:focus {
                border-color:#7C5CFF !important;box-shadow:0 0 0 4px rgba(124,92,255,0.15) !important;outline:none !important;
            }
            .mark-ai-app-root select option { background:#FFFFFF;color:#14152A; }
            #mark-ai-app .mark-ai-app-root { margin:0 !important; }
            /* card entrance + hover lift (the "tabahi" motion) */
            .mark-rise { animation:markRise .5s cubic-bezier(0.16,1,0.3,1) both; }
            .mark-lift { transition:transform .25s cubic-bezier(0.16,1,0.3,1), box-shadow .25s ease, border-color .25s ease; }
            .mark-lift:hover { transform:translateY(-4px); box-shadow:0 20px 48px rgba(124,92,255,0.16); border-color:rgba(124,92,255,0.32) !important; }
            .mark-ai-app-root button { transition:transform .18s ease, box-shadow .25s ease, filter .2s ease; }
            .mark-ai-app-root button:hover { filter:brightness(1.04); }
            .mark-ai-app-root button:active { transform:scale(0.97); }
            .mark-ai-app-root a { color:#7C5CFF; }
            .mark-orb-mars { position:absolute;width:560px;height:560px;border-radius:50%;background:radial-gradient(circle,rgba(124,92,255,0.18) 0%,transparent 70%);filter:blur(60px);top:-200px;right:-140px;pointer-events:none;z-index:0;animation:markFloat 12s ease-in-out infinite; }
            .mark-orb-saturn { position:absolute;width:640px;height:640px;border-radius:50%;background:radial-gradient(circle,rgba(255,111,168,0.15) 0%,transparent 70%);filter:blur(65px);bottom:-240px;left:-180px;pointer-events:none;z-index:0;animation:markFloat 16s ease-in-out infinite reverse; }
            /* ── elevated motion + components (the "insane" layer) ── */
            @keyframes markTextShine { to { background-position:200% center; } }
            .mark-gradient-text {
                background:linear-gradient(100deg,#7C5CFF 0%,#B14BF0 40%,#FF6FA8 70%,#7C5CFF 100%);
                background-size:200% auto;-webkit-background-clip:text;background-clip:text;
                -webkit-text-fill-color:transparent;color:transparent;
                animation:markTextShine 7s linear infinite;
            }
            /* staggered card entrance — cards rise in sequence, not all at once */
            .mark-stagger > * { animation:markRise .55s cubic-bezier(0.16,1,0.3,1) both; }
            .mark-stagger > *:nth-child(1){animation-delay:.04s}
            .mark-stagger > *:nth-child(2){animation-delay:.10s}
            .mark-stagger > *:nth-child(3){animation-delay:.16s}
            .mark-stagger > *:nth-child(4){animation-delay:.22s}
            .mark-stagger > *:nth-child(5){animation-delay:.28s}
            .mark-stagger > *:nth-child(6){animation-delay:.34s}
            /* premium stat card: gradient top accent + lift on hover */
            .mark-stat-card { position:relative; transition:transform .28s cubic-bezier(0.16,1,0.3,1), box-shadow .28s ease, border-color .28s ease; }
            .mark-stat-card::before {
                content:'';position:absolute;top:0;left:0;right:0;height:3px;
                background:linear-gradient(90deg,#7C5CFF,#FF6FA8);
                opacity:0;transition:opacity .28s ease;
            }
            .mark-stat-card:hover { transform:translateY(-5px); box-shadow:0 26px 56px rgba(124,92,255,0.20); border-color:rgba(124,92,255,0.3) !important; }
            .mark-stat-card:hover::before { opacity:1; }
            /* gradient icon chip used in stat cards */
            .mark-icon-chip {
                display:inline-flex;align-items:center;justify-content:center;
                width:40px;height:40px;border-radius:13px;
                background:linear-gradient(135deg,#7C5CFF,#B14BF0);
                box-shadow:0 6px 16px rgba(124,92,255,0.32);
                color:#FFFFFF;
            }
            .mark-icon-chip .material-symbols-outlined { font-size:22px; }
            @media (prefers-reduced-motion: reduce) {
                .mark-gradient-text { animation:none; }
                .mark-stagger > * { animation:none; }
                .mark-orb-mars, .mark-orb-saturn { animation:none; }
            }
        `;
        document.head.appendChild(style);
    }

    /* ================================================================
       RENDER: APP SHELL
       ================================================================ */
    async function renderAppShell() {
        injectKeyframes();
        const app = $('#mark-ai-app');
        if (!app) return;

        const pageMap = {
            'mark-ai': 'dashboard',
            'mark-ai-stores': 'store',
            'mark-ai-analytics': 'analytics',
            'mark-ai-learning': 'learning',
            'mark-ai-training': 'training',
            'mark-ai-sales': 'sales',
            'mark-ai-voice': 'voice',
            'mark-ai-ai': 'ai',
            'mark-ai-conversations': 'conversations',
            'mark-ai-settings': 'settings',
        };
        currentPage = pageMap[PAGE] || 'dashboard';

        app.innerHTML = `
        <div class="mark-ai-app-root" style="${T.pageBg}min-height:500px;padding:0;font-family:'Plus Jakarta Sans',sans-serif;color:#14152A;-webkit-font-smoothing:antialiased;border-radius:8px;overflow:hidden;">
            <div class="mark-orb-mars"></div>
            <div class="mark-orb-saturn"></div>
            <div style="padding:40px 40px 72px;max-width:1280px;margin:0 auto;position:relative;z-index:1;" id="mark-page-content">
                ${skeleton('200px')}<div style="margin-top:16px;">${skeleton('300px')}</div>
            </div>
            <div id="mark-modal-container"></div>
        </div>`;

        // Load global settings once (api_token, remote_store_id, backend_url) up
        // front, so EVERY page's backend sync (voice/training/crawl) works no
        // matter which sidebar page was opened directly.
        try { globalSettings = await api('GET', 'settings'); } catch (e) {}

        navigate(currentPage);
    }

    /* ================================================================
       SPA NAVIGATION
       ================================================================ */
    function navigate(page) {
        currentPage = page;
        // Tear down any live charts before leaving a page — otherwise Chart.js
        // instances on the previous page keep animation/resize listeners alive
        // on detached canvases (leak when navigating repeatedly).
        destroyCharts();
        // Store-scoped pages: each sidebar tab loads the store then renders one tab.
        const STORE_TABS = ['settings', 'analytics', 'learning', 'training', 'sales', 'voice', 'ai'];
        if (page === 'store') { activeTab = 'settings'; loadStorePage(); return; }
        if (STORE_TABS.indexOf(page) !== -1) { activeTab = page; loadStorePage(); return; }
        switch (page) {
            case 'conversations': loadConversationsPage(); break;
            case 'settings':      loadSettingsPage(); break;
            default:              loadDashboardPage(); break;
        }
    }

    /* ================================================================
       HELPER: Get the single store
       ================================================================ */
    function getMainStore() {
        return stores.length > 0 ? stores[0] : null;
    }

    /* ================================================================
       RENDER: STAT CARD
       ================================================================ */
    function renderStatCard(label, value, icon) {
        return `
        <div class="mark-stat-card" style="${T.glass}padding:28px 28px 30px;min-height:158px;display:flex;flex-direction:column;justify-content:space-between;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
                <span style="${T.label}margin-bottom:0;text-transform:uppercase;letter-spacing:0.1em;font-size:11px;">${esc(label)}</span>
                <span class="mark-icon-chip"><span class="material-symbols-outlined">${icon}</span></span>
            </div>
            <div style="${T.statValue}">${formatNum(value)}</div>
        </div>`;
    }

    function renderMiniStat(label, value, icon) {
        return `
        <div class="mark-stat-card" style="${T.glassLight}padding:20px;display:flex;flex-direction:column;justify-content:space-between;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                <span style="${T.label}margin-bottom:0;text-transform:uppercase;letter-spacing:0.1em;font-size:11px;">${esc(label)}</span>
                <span class="mark-icon-chip" style="width:32px;height:32px;border-radius:10px;"><span class="material-symbols-outlined" style="font-size:18px;">${icon}</span></span>
            </div>
            <div style="${T.statValue}font-size:32px;">${formatNum(value)}</div>
        </div>`;
    }

    function renderBadge(isActive) {
        return isActive
            ? `<span style="${T.badgeActive}"><span style="width:6px;height:6px;border-radius:50%;background:#4ade80;animation:markPulse 2s ease-in-out infinite;display:inline-block;"></span>Active</span>`
            : `<span style="${T.badgeInactive}"><span style="width:6px;height:6px;border-radius:50%;background:#94a3b8;display:inline-block;"></span>Inactive</span>`;
    }

    /* ================================================================
       CHARTS (Chart.js integration)
       ================================================================ */
    function destroyCharts() {
        Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch (e) {} });
        chartInstances = {};
    }

    async function loadDashboardCharts() {
        if (typeof Chart === 'undefined') return; // Chart.js not loaded
        try {
            const data = await api('GET', 'chart-data?days=14');
            renderConversationTrendChart(data.daily || {});
            renderPeakHoursChart(data.hourly || []);
        } catch (e) { /* charts are supplementary */ }
    }

    function renderConversationTrendChart(dailyData) {
        const canvas = document.getElementById('mark-chart-trend');
        if (!canvas || typeof Chart === 'undefined') return;

        if (chartInstances.trend) { try { chartInstances.trend.destroy(); } catch (e) {} }

        const labels = Object.keys(dailyData).map(d => {
            const dt = new Date(d + 'T00:00:00');
            return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        });
        const values = Object.values(dailyData);

        chartInstances.trend = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Conversations',
                    data: values,
                    borderColor: '#7C5CFF',
                    backgroundColor: 'rgba(124,92,255,0.15)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#7C5CFF',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(26,28,28,0.9)',
                        titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
                        bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 13 },
                        padding: 12,
                        cornerRadius: 8,
                    },
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(194,199,202,0.15)' },
                        ticks: { font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 }, color: '#6B6F86' },
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(194,199,202,0.15)' },
                        ticks: { font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 }, color: '#6B6F86', stepSize: 1 },
                    },
                },
            },
        });
    }

    function renderPeakHoursChart(hourlyData) {
        const canvas = document.getElementById('mark-chart-hours');
        if (!canvas || typeof Chart === 'undefined') return;

        if (chartInstances.hours) { try { chartInstances.hours.destroy(); } catch (e) {} }

        const labels = Array.from({ length: 24 }, (_, i) => {
            const h = i % 12 || 12;
            return h + (i < 12 ? 'am' : 'pm');
        });

        chartInstances.hours = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Chats',
                    data: hourlyData,
                    backgroundColor: hourlyData.map((v, i) => {
                        const max = Math.max(...hourlyData, 1);
                        const intensity = v / max;
                        return `rgba(124,92,255,${0.15 + intensity * 0.65})`;
                    }),
                    borderRadius: 4,
                    borderSkipped: false,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(26,28,28,0.9)',
                        titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
                        bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 13 },
                        padding: 12,
                        cornerRadius: 8,
                    },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { family: "'Plus Jakarta Sans', sans-serif", size: 10 }, color: '#6B6F86', maxRotation: 0 },
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(194,199,202,0.15)' },
                        ticks: { font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 }, color: '#6B6F86', stepSize: 1 },
                    },
                },
            },
        });
    }

    /* ================================================================
       LIVE PREVIEW MODAL
       ================================================================ */
    function showPreview() {
        const store = getMainStore();
        const name = store?.assistant_name || 'Mark';
        const personality = store?.personality || 'friendly';
        const greetings = {
            friendly: "Hey there! I'm " + name + ", your friendly shopping buddy! What can I help you find today?",
            professional: "Welcome! I'm " + name + ", your website assistant. How may I assist you?",
            playful: "Beep boop! I'm " + name + " -- a tiny robot from Mars here to help you shop! What are we looking for?",
        };
        const greeting = greetings[personality] || greetings.friendly;

        const container = $('#mark-modal-container');
        container.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.4);backdrop-filter:blur(8px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;" onclick="markAdmin.closeModal(event)">
            <div style="background:#FFFFFF;border:1px solid rgba(124,92,255,0.18);border-radius:20px;width:90%;max-width:900px;max-height:90vh;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.2);" onclick="event.stopPropagation()">
                <!-- Header -->
                <div style="padding:24px 32px;border-bottom:1px solid rgba(194,199,202,0.3);display:flex;align-items:center;justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <span class="material-symbols-outlined" style="font-size:24px;color:#7C5CFF;">visibility</span>
                        <h2 style="${T.headline}font-size:20px;font-weight:600;margin:0;">Widget Preview</h2>
                    </div>
                    <button style="background:none;border:none;cursor:pointer;padding:8px;" onclick="markAdmin.closeModal()">
                        <span class="material-symbols-outlined" style="font-size:24px;color:#6B6F86;">close</span>
                    </button>
                </div>
                <!-- Preview Area -->
                <div style="padding:32px;display:flex;gap:32px;flex-wrap:wrap;align-items:flex-start;">
                    <!-- Simulated Website -->
                    <div style="flex:1;min-width:300px;background:#f5f5f5;border-radius:12px;height:440px;position:relative;border:1px solid #e0e0e0;overflow:hidden;">
                        <!-- Fake browser bar -->
                        <div style="background:#e8e8e8;padding:8px 16px;display:flex;align-items:center;gap:8px;">
                            <div style="display:flex;gap:6px;">
                                <span style="width:10px;height:10px;border-radius:50%;background:#ff5f57;display:inline-block;"></span>
                                <span style="width:10px;height:10px;border-radius:50%;background:#ffbd2e;display:inline-block;"></span>
                                <span style="width:10px;height:10px;border-radius:50%;background:#28ca41;display:inline-block;"></span>
                            </div>
                            <div style="flex:1;background:rgba(20,21,42,0.04);border-radius:6px;padding:4px 12px;font-size:12px;color:#6B6F86;font-family:monospace;">${esc(store?.website_url || 'yourstore.com')}</div>
                        </div>
                        <!-- Fake page content -->
                        <div style="padding:24px;">
                            <div style="width:60%;height:20px;background:#ddd;border-radius:4px;margin-bottom:12px;"></div>
                            <div style="width:90%;height:12px;background:#e5e5e5;border-radius:3px;margin-bottom:8px;"></div>
                            <div style="width:75%;height:12px;background:#e5e5e5;border-radius:3px;margin-bottom:24px;"></div>
                            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
                                <div style="height:100px;background:#e0e0e0;border-radius:8px;"></div>
                                <div style="height:100px;background:#e0e0e0;border-radius:8px;"></div>
                                <div style="height:100px;background:#e0e0e0;border-radius:8px;"></div>
                            </div>
                        </div>
                        <!-- Robot widget simulation -->
                        <div style="position:absolute;bottom:16px;right:16px;">
                            <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#7C5CFF,#7C5CFF);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(124,92,255,0.4);cursor:pointer;animation:markPulse 3s ease-in-out infinite;">
                                <span class="material-symbols-outlined" style="font-size:32px;color:#fff;">smart_toy</span>
                            </div>
                        </div>
                        <!-- Chat bubble simulation -->
                        <div style="position:absolute;bottom:92px;right:16px;width:280px;background:rgba(20,21,42,0.04);border-radius:16px 16px 4px 16px;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,0.12);font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;color:#14152A;line-height:1.5;">
                            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                                <div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#7C5CFF,#7C5CFF);display:flex;align-items:center;justify-content:center;">
                                    <span class="material-symbols-outlined" style="font-size:14px;color:#fff;">smart_toy</span>
                                </div>
                                <strong style="font-size:13px;color:#7C5CFF;">${esc(name)}</strong>
                            </div>
                            ${esc(greeting)}
                        </div>
                    </div>
                    <!-- Info Panel -->
                    <div style="width:240px;display:flex;flex-direction:column;gap:16px;">
                        <div style="${T.glassLight}padding:20px;">
                            <h4 style="${T.headline}font-size:14px;font-weight:600;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.08em;">Current Config</h4>
                            <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;color:#4B4F66;">
                                <div><strong>Name:</strong> ${esc(name)}</div>
                                <div><strong>Style:</strong> ${esc(personality)}</div>
                                <div><strong>Position:</strong> ${esc(globalSettings.widget_position || 'bottom-right')}</div>
                                <div><strong>Auto Greet:</strong> ${globalSettings.auto_greet !== false && globalSettings.auto_greet !== '0' ? 'Yes' : 'No'}</div>
                            </div>
                        </div>
                        <div style="padding:16px;background:rgba(124,92,255,0.08);border-radius:12px;border:1px solid rgba(124,92,255,0.2);">
                            <p style="font-size:12px;color:#7C5CFF;margin:0;line-height:1.6;">
                                <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">info</span>
                                This is a visual preview. Visit your website to see the real 3D robot in action!
                            </p>
                        </div>
                        <a href="${esc(store?.website_url || '#')}" target="_blank" style="${T.btnPrimary}justify-content:center;text-decoration:none;width:100%;">
                            <span class="material-symbols-outlined" style="font-size:18px;">open_in_new</span> View Live Widget
                        </a>
                    </div>
                </div>
            </div>
        </div>`;
    }

    /* ================================================================
       ONBOARDING WIZARD
       ================================================================ */
    function renderOnboarding() {
        return `
        <div style="max-width:640px;margin:0 auto;text-align:center;padding:40px 0;">
            <!-- Welcome Header with Robot -->
            <div style="margin-bottom:48px;">
                <div id="mark-welcome-visual" style="width:180px;height:180px;border-radius:50%;overflow:hidden;margin:0 auto 24px;box-shadow:0 8px 40px rgba(124,92,255,0.35);border:4px solid rgba(124,92,255,0.3);position:relative;">
                    <div style="display:flex;width:100%;height:100%;background:linear-gradient(135deg,#7C5CFF,#7C5CFF);align-items:center;justify-content:center;">
                        <div style="animation:markRobotBob 1.5s ease-in-out infinite;">
                            <svg width="90" height="90" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <line x1="10" y1="0.5" x2="10" y2="3" stroke="white" stroke-width="1" stroke-linecap="round"/>
                                <circle cx="10" cy="0.5" r="0.8" fill="rgba(255,255,255,0.8)"/>
                                <rect x="3" y="3" width="14" height="10" rx="3" fill="white" opacity="0.95"/>
                                <circle cx="7" cy="7.5" r="2" fill="#7C5CFF"/>
                                <circle cx="13" cy="7.5" r="2" fill="#7C5CFF"/>
                                <circle cx="7.3" cy="7.2" r="0.6" fill="white"/>
                                <circle cx="13.3" cy="7.2" r="0.6" fill="white"/>
                                <path d="M7.5 10.5 Q10 12.5 12.5 10.5" stroke="#7C5CFF" stroke-width="0.7" fill="none" stroke-linecap="round"/>
                                <rect x="5.5" y="14" width="9" height="4.5" rx="1.5" fill="white" opacity="0.85"/>
                                <circle cx="10" cy="16.2" r="1" fill="#7C5CFF"/>
                            </svg>
                        </div>
                    </div>
                </div>
                <h1 style="${T.headline}font-size:36px;font-weight:300;letter-spacing:-0.02em;margin:0 0 12px;">Welcome to Mark AI</h1>
                <p style="color:#4B4F66;font-size:18px;line-height:1.6;margin:0;">
                    Meet your AI robot assistant! Let's set it up in under 2 minutes.
                </p>
            </div>

            <!-- Step: API Key -->
            <div style="${T.glass}padding:40px;text-align:left;margin-bottom:24px;">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
                    <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7C5CFF,#7C5CFF);display:flex;align-items:center;justify-content:center;">
                        <span style="color:#fff;font-weight:600;font-size:14px;">1</span>
                    </div>
                    <h3 style="${T.headline}font-size:20px;font-weight:600;margin:0;">Connect your AI</h3>
                </div>
                <p style="color:#4B4F66;font-size:14px;margin:0 0 20px;line-height:1.6;">
                    Mark uses <strong>Groq</strong> for blazing-fast AI responses. It's free — just grab an API key:
                </p>
                <ol style="color:#4B4F66;font-size:14px;line-height:2;margin:0 0 20px;padding-left:20px;">
                    <li>Go to <a href="https://console.groq.com" target="_blank" style="color:#7C5CFF;font-weight:600;text-decoration:none;">console.groq.com</a></li>
                    <li>Sign up (free) and create an API key</li>
                    <li>Paste it below</li>
                </ol>
                <div>
                    <label style="${T.label}">Groq API Key</label>
                    <div style="position:relative;">
                        <input id="onboard-key" type="password" placeholder="gsk_..." style="${T.input}" />
                        <span class="material-symbols-outlined" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#6B6F86;cursor:pointer;font-size:20px;"
                              onclick="const i=document.getElementById('onboard-key');i.type=i.type==='password'?'text':'password';">visibility_off</span>
                    </div>
                </div>
            </div>

            <!-- Step: Customize -->
            <div style="${T.glass}padding:40px;text-align:left;margin-bottom:32px;">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
                    <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7C5CFF,#7C5CFF);display:flex;align-items:center;justify-content:center;">
                        <span style="color:#fff;font-weight:600;font-size:14px;">2</span>
                    </div>
                    <h3 style="${T.headline}font-size:20px;font-weight:600;margin:0;">Customize your robot</h3>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
                    <div>
                        <label style="${T.label}">Store Name</label>
                        <input id="onboard-store-name" type="text" value="${esc(getMainStore()?.store_name || '')}" style="${T.input}" />
                    </div>
                    <div>
                        <label style="${T.label}">Assistant Name</label>
                        <input id="onboard-assistant" type="text" value="${esc(getMainStore()?.assistant_name || 'Mark')}" style="${T.input}" />
                    </div>
                    <div style="grid-column:1/-1;">
                        <label style="${T.label}">Website URL</label>
                        <input id="onboard-url" type="url" value="${esc(getMainStore()?.website_url || '')}" style="${T.input}" />
                    </div>
                    <div>
                        <label style="${T.label}">Personality</label>
                        <select id="onboard-personality" style="${T.select}">
                            <option value="friendly" selected>Friendly & Approachable</option>
                            <option value="professional">Professional & Precise</option>
                            <option value="playful">Playful & Witty</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Complete Button -->
            <button style="${T.btnPrimary}padding:16px 48px;font-size:16px;" onclick="markAdmin.completeSetup()"
                    onmouseenter="this.style.boxShadow='0 6px 20px rgba(124,92,255,0.4)';this.style.transform='translateY(-2px)'"
                    onmouseleave="this.style.boxShadow='0 4px 15px rgba(124,92,255,0.25)';this.style.transform='translateY(0)'">
                <span class="material-symbols-outlined" style="font-size:20px;">rocket_launch</span>
                Launch Mark AI
            </button>
        </div>`;
    }

    async function completeSetup() {
        const apiKey    = ($('#onboard-key') || {}).value?.trim();
        const storeName = ($('#onboard-store-name') || {}).value?.trim();
        const url       = ($('#onboard-url') || {}).value?.trim();
        const assistant = ($('#onboard-assistant') || {}).value?.trim() || 'Mark';
        const personality = ($('#onboard-personality') || {}).value || 'friendly';

        if (!apiKey || apiKey.length < 10) {
            toast('Please enter a valid Groq API key.', 'error');
            return;
        }

        try {
            // 1. Save global API key
            await api('POST', 'settings', { groq_api_key: apiKey });

            // 2. Update the store
            const store = getMainStore();
            if (store) {
                await api('PUT', 'stores/' + store.store_id, {
                    store_name: storeName || store.store_name,
                    website_url: url || store.website_url,
                    assistant_name: assistant,
                    personality: personality,
                });
            }

            // 3. Test connection
            const test = await api('POST', 'test-connection');
            if (test.connected) {
                toast('Mark AI is live! Your robot companion is ready.', 'success');
            } else {
                toast('Settings saved, but API key test failed: ' + (test.error || 'Unknown error'), 'error');
            }

            // Reload dashboard then start tour
            navigate('dashboard');
            try {
                if (!localStorage.getItem('mark_ai_tour_complete')) {
                    setTimeout(() => startTour(), 1500);
                }
            } catch(_) {}
        } catch (e) {
            toast('Setup error: ' + e.message, 'error');
        }
    }

    /* ================================================================
       PAGE: DASHBOARD (Single-store flow)
       ================================================================ */
    async function loadDashboardPage() {
        const content = $('#mark-page-content');
        try {
            dashboardStats = await api('GET', 'dashboard');
            stores = dashboardStats.stores || [];
            const store = getMainStore();

            // No API key yet → show onboarding
            if (!dashboardStats.has_api_key) {
                content.innerHTML = renderOnboarding();
                return;
            }

            destroyCharts();

            content.innerHTML = `
            <!-- Header -->
            <div style="margin-bottom:40px;display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px;">
                <div>
                    <h1 class="mark-gradient-text" style="${T.headline}font-size:52px;line-height:58px;letter-spacing:-0.025em;font-weight:600;margin:0 0 8px;">Overview</h1>
                    <p style="font-family:'Plus Jakarta Sans',sans-serif;font-size:18px;color:#4B4F66;line-height:1.6;margin:0;">Monitor your Mark AI performance.</p>
                </div>
                <div style="display:flex;gap:10px;">
                    <button style="${T.btnSecondary}" onclick="markAdmin.startTour()">
                        <span class="material-symbols-outlined" style="font-size:18px;">school</span> Take a Tour
                    </button>
                    ${store ? `<button style="${T.btnSecondary}" onclick="markAdmin.showPreview()">
                        <span class="material-symbols-outlined" style="font-size:18px;">visibility</span> Preview Widget
                    </button>` : ''}
                </div>
            </div>

            <!-- Stats Grid -->
            <div class="mark-stagger" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;margin-bottom:40px;">
                ${renderStatCard('Total Conversations', dashboardStats.total_conversations, 'forum')}
                ${renderStatCard("Today's Chats", dashboardStats.today_conversations, 'chat')}
                ${renderStatCard('Active Stores', dashboardStats.active_stores, 'bolt')}
                ${renderStatCard('Total Stores', dashboardStats.total_stores, 'store')}
            </div>

            <!-- Charts Row -->
            <div class="mark-stagger" style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:40px;" id="mark-charts-row">
                <div class="mark-lift" style="${T.glass}padding:24px;">
                    <h3 style="${T.headline}font-size:16px;font-weight:600;margin:0 0 16px;">
                        <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;margin-right:6px;color:#7C5CFF;">trending_up</span>
                        Conversation Trend (14 days)
                    </h3>
                    <div style="height:220px;position:relative;">
                        <canvas id="mark-chart-trend"></canvas>
                    </div>
                </div>
                <div class="mark-lift" style="${T.glass}padding:24px;">
                    <h3 style="${T.headline}font-size:16px;font-weight:600;margin:0 0 16px;">
                        <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;margin-right:6px;color:#7C5CFF;">schedule</span>
                        Peak Hours (last 30 days)
                    </h3>
                    <div style="height:220px;position:relative;">
                        <canvas id="mark-chart-hours"></canvas>
                    </div>
                </div>
            </div>

            ${store ? `
            <!-- Quick Store Info -->
            <div style="${T.glass}padding:32px;">
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
                    <div>
                        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
                            <h2 style="${T.headline}font-size:24px;font-weight:600;margin:0;">${esc(store.store_name)}</h2>
                            ${renderBadge(store.is_active)}
                        </div>
                        <p style="color:#4B4F66;font-size:14px;margin:0;">
                            <span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;margin-right:4px;">language</span>
                            ${esc(store.website_url)}
                            &nbsp;&middot;&nbsp;
                            <span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;margin-right:4px;">smart_toy</span>
                            ${esc(store.assistant_name || 'Mark')}
                        </p>
                    </div>
                    <div style="display:flex;gap:12px;">
                        <button style="${T.btnPrimary}" onclick="markAdmin.navigate('store')">
                            <span class="material-symbols-outlined" style="font-size:18px;">settings</span> Manage Store
                        </button>
                    </div>
                </div>
            </div>` : `
            <div style="${T.glass}padding:48px;text-align:center;">
                <span class="material-symbols-outlined" style="font-size:48px;color:#6B6F86;opacity:0.5;margin-bottom:12px;">storefront</span>
                <h3 style="${T.headline}font-size:20px;margin:0 0 8px;">No store configured</h3>
                <p style="color:#4B4F66;font-size:14px;margin:0;">Go to <strong>My Store</strong> in the sidebar to set up your store.</p>
            </div>`}
            `;

            // Load charts async (non-blocking)
            loadDashboardCharts();
        } catch (e) {
            content.innerHTML = `
            <div style="text-align:center;padding:80px 20px;">
                <span class="material-symbols-outlined" style="font-size:64px;color:rgba(186,26,26,0.3);">error</span>
                <h3 style="${T.headline}font-size:20px;margin:16px 0 8px;">Failed to load dashboard</h3>
                <p style="color:#4B4F66;font-size:14px;margin:0 0 20px;">${esc(e.message)}</p>
                <button style="${T.btnSecondary}" onclick="markAdmin.navigate('dashboard')">
                    <span class="material-symbols-outlined" style="font-size:18px;">refresh</span> Retry
                </button>
            </div>`;
        }
    }

    /* ================================================================
       PAGE: STORE (Single store detail)
       ================================================================ */
    async function loadStorePage() {
        const content = $('#mark-page-content');
        content.innerHTML = robotLoader('Loading store...');

        try {
            const data = await api('GET', 'dashboard');
            stores = data.stores || [];
            const store = getMainStore();

            if (!store) {
                content.innerHTML = `<div style="text-align:center;padding:60px;">
                    <span class="material-symbols-outlined" style="font-size:48px;color:#6B6F86;opacity:0.5;margin-bottom:12px;">storefront</span>
                    <h3 style="${T.headline}font-size:20px;">No store found</h3>
                    <p style="color:#4B4F66;margin:0 0 20px;">Your store was deleted or hasn't been created yet.</p>
                    <button style="${T.btnPrimary}" onclick="markAdmin.navigate('dashboard')">
                        <span class="material-symbols-outlined" style="font-size:18px;">add</span> Set Up a New Store
                    </button>
                </div>`;
                return;
            }

            const storeData = await api('GET', 'stores/' + store.store_id);
            currentStore = storeData.store || storeData;
            if (!activeTab) activeTab = 'settings';
            renderStoreDetail();
        } catch (e) {
            toast('Failed to load store: ' + e.message, 'error');
        }
    }

    async function openStore(storeId) {
        const content = $('#mark-page-content');
        content.innerHTML = robotLoader('Loading store...');
        try {
            const data = await api('GET', 'stores/' + storeId);
            currentStore = data.store || data;
            activeTab = 'settings';
            renderStoreDetail();
        } catch (e) {
            toast('Failed to load store: ' + e.message, 'error');
            navigate('dashboard');
        }
    }

    function renderStoreDetail() {
        const s = currentStore;
        const content = $('#mark-page-content');

        const isSettings = (activeTab === 'settings');
        const tabTitles = { settings:'Store Settings', analytics:'Analytics', learning:'Auto-Learning', training:'Mark Training', sales:'Sales Skills', voice:'Voice', ai:'AI Config' };

        content.innerHTML = `
        <!-- Store Header -->
        <div style="margin-bottom:32px;">
            <div style="font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#6B6F86;margin-bottom:6px;">${esc(tabTitles[activeTab] || 'Store')}</div>
            <h2 style="${T.headline}font-size:42px;line-height:50px;letter-spacing:-0.025em;font-weight:600;margin:0 0 4px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
                <span class="mark-gradient-text">${esc(s.store_name)}</span>
                ${renderBadge(s.is_active)}
            </h2>
            <a style="font-size:15px;color:#4B4F66;text-decoration:none;display:inline-flex;align-items:center;gap:4px;"
               href="${esc(s.website_url)}" target="_blank"
               onmouseenter="this.style.color='#6B6F86'" onmouseleave="this.style.color='#4B4F66'">
                ${esc(s.website_url)}
                <span class="material-symbols-outlined" style="font-size:16px;">open_in_new</span>
            </a>
        </div>

        ${isSettings ? `<div id="store-analytics" class="mark-stagger" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:24px;margin-bottom:48px;">
            ${renderMiniStat('Total Chats', '--', 'forum')}
            ${renderMiniStat('Today', '--', 'today')}
            ${renderMiniStat('This Week', '--', 'date_range')}
            ${renderMiniStat('Unique Visitors', '--', 'person')}
        </div>` : ''}

        <div id="tab-content"></div>

        ${isSettings ? `<div style="margin-top:64px;padding:24px;border:1px solid rgba(186,26,26,0.2);border-radius:12px;background:rgba(255,218,214,0.1);">
            <h3 style="${T.headline}font-size:20px;color:#D83A52;margin:0 0 8px;">Danger Zone</h3>
            <p style="color:#4B4F66;font-size:14px;margin:0 0 16px;">Permanently delete this store and all its data.</p>
            <button style="${T.btnDanger}" onclick="markAdmin.confirmDelete()">
                <span class="material-symbols-outlined" style="font-size:18px;">delete_forever</span> Delete Store
            </button>
        </div>` : ''}`;

        if (isSettings) loadStoreAnalytics(s.store_id);
        renderTab(activeTab);
    }

    // Render one tab's content into #tab-content (sidebar drives which tab).
    function renderTab(tab) {
        const container = $('#tab-content');
        if (!container) return;
        const s = currentStore;
        switch (tab) {
            case 'settings':  container.innerHTML = renderSettingsTab(s); break;
            case 'analytics': container.innerHTML = renderAnalyticsTab(s); loadEventAnalytics(s); break;
            case 'learning':  container.innerHTML = renderLearningTab(s); loadPlaybook(s); break;
            case 'training':  container.innerHTML = renderTrainingTab(s); initTrainingTab(s); break;
            case 'sales':     container.innerHTML = renderSalesTab(s); break;
            case 'voice':     container.innerHTML = renderVoiceTab(s); break;
            case 'ai':        container.innerHTML = renderAITab(s); break;
            default:          container.innerHTML = renderSettingsTab(s); break;
        }
    }

    async function loadStoreAnalytics(storeId) {
        try {
            const data = await api('GET', 'stores/' + storeId + '/analytics');
            const container = $('#store-analytics');
            if (container) {
                container.innerHTML = `
                    ${renderMiniStat('Total Chats', data.total_conversations, 'forum')}
                    ${renderMiniStat('Today', data.today, 'today')}
                    ${renderMiniStat('This Week', data.this_week, 'date_range')}
                    ${renderMiniStat('Unique Visitors', data.unique_visitors, 'person')}`;
            }
        } catch (e) { /* analytics are supplementary */ }
    }

    /* ================================================================
       TAB SWITCHING
       ================================================================ */
    function switchTab(tab) {
        activeTab = tab;
        renderTab(tab);
    }

    /* ================================================================
       TAB: SETTINGS
       ================================================================ */
    function renderSettingsTab(s) {
        const deskScale = s.widget_scale_desktop || 5;
        const mobScale  = s.widget_scale_mobile  || 5;
        return `
        <div style="${T.glassLight}padding:40px;">
            <form style="display:flex;flex-direction:column;gap:40px;" onsubmit="event.preventDefault();markAdmin.saveStoreSettings();">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
                    <div><label style="${T.label}">Store Name</label><input id="s-store-name" type="text" value="${esc(s.store_name)}" style="${T.input}" /></div>
                    <div><label style="${T.label}">Website URL</label><input id="s-website-url" type="url" value="${esc(s.website_url)}" style="${T.input}" /></div>
                    <div><label style="${T.label}">Assistant Name</label><input id="s-assistant-name" type="text" value="${esc(s.assistant_name || 'Mark')}" style="${T.input}" /><span style="font-size:13px;color:#6B6F86;margin-top:4px;">What should the AI call itself?</span></div>
                    <div><label style="${T.label}">Personality</label><select id="s-personality" style="${T.select}"><option value="professional" ${s.personality==='professional'?'selected':''}>Professional & Precise</option><option value="friendly" ${s.personality==='friendly'?'selected':''}>Friendly & Approachable</option><option value="playful" ${s.personality==='playful'?'selected':''}>Playful & Witty</option></select></div>
                    <div><label style="${T.label}">Primary Language</label><select id="s-primary-lang" style="${T.select}"><option value="en" selected>English</option></select></div>
                    <div><label style="${T.label}">Idle Timeout (Seconds)</label><input id="s-idle-timeout" type="number" value="${s.idle_timeout||300}" style="${T.input}" /></div>
                    <div><label style="${T.label}">Max Crawl Pages</label><input id="s-max-crawl" type="number" value="${s.max_crawl_pages||120}" style="${T.input}" /></div>
                    <div><label style="${T.label}">Status</label><select id="s-is-active" style="${T.select}"><option value="1" ${s.is_active?'selected':''}>Active (Deployed)</option><option value="0" ${!s.is_active?'selected':''}>Inactive (Maintenance)</option></select></div>
                </div>

                <!-- ── MARK SIZE CONTROL ── -->
                <div style="padding:28px;border:1px solid rgba(124,92,255,0.15);border-radius:12px;background:rgba(124,92,255,0.04);">
                    <h3 style="${T.headline}font-size:20px;margin:0 0 4px;display:flex;align-items:center;gap:8px;">
                        <span class="material-symbols-outlined" style="font-size:22px;color:#7C5CFF;">straighten</span>
                        Mark Size
                    </h3>
                    <p style="color:#6B6F86;font-size:13px;margin:0 0 24px;">Control how big Mark appears on your website. Desktop and mobile have separate scales.</p>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;">
                        <!-- Desktop Size -->
                        <div>
                            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                                <label style="${T.label}margin:0;">
                                    <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;margin-right:4px;">desktop_windows</span>
                                    Desktop Size
                                </label>
                                <span id="s-desk-val" style="font-size:22px;font-weight:600;color:#7C5CFF;font-family:'Plus Jakarta Sans',sans-serif;">${deskScale}</span>
                            </div>
                            <div style="position:relative;padding:4px 0;">
                                <input id="s-scale-desktop" type="range" min="1" max="10" step="1" value="${deskScale}"
                                    oninput="document.getElementById('s-desk-val').textContent=this.value;markAdmin.updateSizePreview();"
                                    style="width:100%;height:6px;-webkit-appearance:none;appearance:none;background:linear-gradient(90deg,rgba(124,92,255,0.15),rgba(124,92,255,0.4));border-radius:3px;outline:none;cursor:pointer;" />
                            </div>
                            <div style="display:flex;justify-content:space-between;font-size:11px;color:#6B6F86;margin-top:4px;">
                                <span>Tiny</span><span>Default</span><span>Large</span>
                            </div>
                        </div>

                        <!-- Mobile Size -->
                        <div>
                            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                                <label style="${T.label}margin:0;">
                                    <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;margin-right:4px;">smartphone</span>
                                    Mobile Size
                                </label>
                                <span id="s-mob-val" style="font-size:22px;font-weight:600;color:#7C5CFF;font-family:'Plus Jakarta Sans',sans-serif;">${mobScale}</span>
                            </div>
                            <div style="position:relative;padding:4px 0;">
                                <input id="s-scale-mobile" type="range" min="1" max="10" step="1" value="${mobScale}"
                                    oninput="document.getElementById('s-mob-val').textContent=this.value;markAdmin.updateSizePreview();"
                                    style="width:100%;height:6px;-webkit-appearance:none;appearance:none;background:linear-gradient(90deg,rgba(124,92,255,0.15),rgba(124,92,255,0.4));border-radius:3px;outline:none;cursor:pointer;" />
                            </div>
                            <div style="display:flex;justify-content:space-between;font-size:11px;color:#6B6F86;margin-top:4px;">
                                <span>Tiny</span><span>Default</span><span>Large</span>
                            </div>
                        </div>
                    </div>

                    <!-- Preview -->
                    <div style="margin-top:24px;padding:20px;background:rgba(20,21,42,0.03);border-radius:10px;border:1px dashed rgba(124,92,255,0.25);">
                        <div style="display:flex;align-items:center;justify-content:center;gap:48px;">
                            <div style="text-align:center;">
                                <div id="s-preview-desktop" style="width:115px;height:115px;border-radius:12px;background:linear-gradient(135deg,#7C5CFF,#7C5CFF);display:flex;align-items:center;justify-content:center;margin:0 auto 8px;transition:all 0.3s ease;box-shadow:0 4px 15px rgba(124,92,255,0.25);">
                                    <svg width="40" height="40" viewBox="0 0 20 20" fill="none"><line x1="10" y1="1" x2="10" y2="3.5" stroke="white" stroke-width="1.2" stroke-linecap="round"/><circle cx="10" cy="1" r="1" fill="rgba(255,255,255,0.7)"/><rect x="3.5" y="3.5" width="13" height="9" rx="3" fill="white"/><circle cx="7.2" cy="8" r="1.8" fill="#7C5CFF"/><circle cx="12.8" cy="8" r="1.8" fill="#7C5CFF"/><path d="M7.5 10.5 Q10 12.5 12.5 10.5" stroke="#7C5CFF" stroke-width="0.8" fill="none" stroke-linecap="round"/><rect x="5.5" y="13.5" width="9" height="4.5" rx="1.5" fill="white"/></svg>
                                </div>
                                <span style="font-size:12px;color:#6B6F86;font-weight:600;">Desktop</span>
                                <span id="s-preview-desk-px" style="display:block;font-size:11px;color:#7C5CFF;">115px</span>
                            </div>
                            <div style="text-align:center;">
                                <div id="s-preview-mobile" style="width:90px;height:90px;border-radius:10px;background:linear-gradient(135deg,#7C5CFF,#7C5CFF);display:flex;align-items:center;justify-content:center;margin:0 auto 8px;transition:all 0.3s ease;box-shadow:0 4px 15px rgba(124,92,255,0.25);">
                                    <svg width="30" height="30" viewBox="0 0 20 20" fill="none"><line x1="10" y1="1" x2="10" y2="3.5" stroke="white" stroke-width="1.2" stroke-linecap="round"/><circle cx="10" cy="1" r="1" fill="rgba(255,255,255,0.7)"/><rect x="3.5" y="3.5" width="13" height="9" rx="3" fill="white"/><circle cx="7.2" cy="8" r="1.8" fill="#7C5CFF"/><circle cx="12.8" cy="8" r="1.8" fill="#7C5CFF"/><path d="M7.5 10.5 Q10 12.5 12.5 10.5" stroke="#7C5CFF" stroke-width="0.8" fill="none" stroke-linecap="round"/><rect x="5.5" y="13.5" width="9" height="4.5" rx="1.5" fill="white"/></svg>
                                </div>
                                <span style="font-size:12px;color:#6B6F86;font-weight:600;">Mobile</span>
                                <span id="s-preview-mob-px" style="display:block;font-size:11px;color:#7C5CFF;">90px</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div style="padding-top:24px;border-top:1px solid rgba(194,199,202,0.3);display:flex;justify-content:flex-end;">
                    <button type="submit" style="${T.btnPrimary}">Save Settings</button>
                </div>
            </form>
        </div>`;
    }

    /** Map scale 1-10 to pixel size for preview */
    function scaleToPixels(scale, type) {
        // Desktop: 60px (scale 1) → 200px (scale 10), default 115px at scale 5
        // Mobile:  45px (scale 1) → 150px (scale 10), default 90px at scale 5
        if (type === 'desktop') return Math.round(60 + (scale - 1) * (200 - 60) / 9);
        return Math.round(45 + (scale - 1) * (150 - 45) / 9);
    }

    function updateSizePreview() {
        const dv = parseInt($('#s-scale-desktop')?.value || 5);
        const mv = parseInt($('#s-scale-mobile')?.value || 5);
        const dpx = scaleToPixels(dv, 'desktop');
        const mpx = scaleToPixels(mv, 'mobile');
        const dp = $('#s-preview-desktop');
        const mp = $('#s-preview-mobile');
        if (dp) { dp.style.width = dpx + 'px'; dp.style.height = dpx + 'px'; }
        if (mp) { mp.style.width = mpx + 'px'; mp.style.height = mpx + 'px'; }
        const dpxEl = $('#s-preview-desk-px');
        const mpxEl = $('#s-preview-mob-px');
        if (dpxEl) dpxEl.textContent = dpx + 'px';
        if (mpxEl) mpxEl.textContent = mpx + 'px';
    }

    async function saveStoreSettings() {
        const storeName = $('#s-store-name').value.trim();
        const websiteUrl = $('#s-website-url').value.trim();
        // Clamp numeric fields instead of hard-aborting the whole save —
        // changing widget size should never be blocked by the idle/crawl inputs.
        const idleTimeout = Math.max(15, Math.min(600, parseInt($('#s-idle-timeout').value) || 300));
        const maxCrawl = Math.max(10, Math.min(500, parseInt($('#s-max-crawl').value) || 120));

        // Validation
        if (!storeName) { toast('Store name is required.', 'error'); return; }
        if (websiteUrl && !websiteUrl.startsWith('http://') && !websiteUrl.startsWith('https://')) {
            toast('Website URL must start with http:// or https://', 'error'); return;
        }

        const data = {
            store_name: storeName, website_url: websiteUrl,
            assistant_name: $('#s-assistant-name').value, personality: $('#s-personality').value,
            primary_language: $('#s-primary-lang').value, is_active: $('#s-is-active').value === '1',
            max_crawl_pages: maxCrawl, idle_timeout: idleTimeout,
            widget_scale_desktop: parseInt($('#s-scale-desktop')?.value || 5),
            widget_scale_mobile: parseInt($('#s-scale-mobile')?.value || 5),
        };
        try {
            await api('PUT', 'stores/' + currentStore.store_id, data);
            currentStore = { ...currentStore, ...data };
            toast('Settings saved!', 'success');
        } catch (e) { toast(e.message, 'error'); }
    }

    /* ================================================================
       TAB: MARK TRAINING — Brand Knowledge + Product Awareness
       ================================================================ */
    function renderTrainingTab(s) {
        const brandInfo = s.brand_description || '';
        const seasonalProducts = s.seasonal_products || '';
        const priorityProducts = s.priority_products || '';
        return `
        <div style="${T.glassLight}padding:40px;">
            <h3 style="${T.headline}font-size:24px;margin:0 0 4px;">
                <span class="material-symbols-outlined" style="vertical-align:middle;font-size:28px;margin-right:8px;color:#7C5CFF;">school</span>
                Train Mark About Your Brand
            </h3>
            <p style="color:#4B4F66;font-size:14px;margin:0 0 36px;">The more Mark knows about your brand, the better conversations he'll have with your visitors.</p>

            <!-- SECTION 1: Brand Knowledge -->
            <div style="margin-bottom:40px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                    <span class="material-symbols-outlined" style="font-size:22px;color:#7C5CFF;">store</span>
                    <label style="${T.label}margin:0;">Brand Story & Identity</label>
                </div>
                <p style="font-size:13px;color:#6B6F86;margin:0 0 12px;">Tell Mark everything about your brand — mission, values, what makes you unique, target audience, tone. The more detail, the smarter Mark becomes.</p>
                <textarea id="tt-brand-info" style="${T.input}min-height:140px;resize:vertical;line-height:1.6;" placeholder="Example: We are FreshBite — a family-owned organic food store since 2018. We believe in farm-to-table freshness. Our customers are health-conscious families aged 25-45. We're known for our handpicked seasonal fruits and same-day delivery in Lahore...">${esc(brandInfo)}</textarea>
                <span style="font-size:12px;color:#6B6F86;margin-top:6px;display:block;">This is fed directly into Mark's brain. He'll speak about your brand with pride and accuracy.</span>
            </div>

            <!-- SECTION 2: Products from RAG -->
            <div style="margin-bottom:40px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span class="material-symbols-outlined" style="font-size:22px;color:#7C5CFF;">inventory_2</span>
                        <label style="${T.label}margin:0;">Products Mark Knows About</label>
                    </div>
                    <button type="button" id="tt-sync-btn" style="${T.btnSecondary}padding:8px 16px;font-size:13px;" onclick="markAdmin.syncProducts()">
                        <span class="material-symbols-outlined" style="font-size:16px;">sync</span> Sync Products
                    </button>
                </div>
                <p style="font-size:13px;color:#6B6F86;margin:0 0 12px;">These products were auto-discovered from your website via RAG crawling. If products are missing, click <strong>Sync Products</strong> to re-crawl.</p>
                <div id="tt-products-list" style="background:rgba(20,21,42,0.03);border:1px solid rgba(124,92,255,0.15);border-radius:10px;padding:16px;min-height:80px;">
                    <div style="text-align:center;color:#6B6F86;font-size:14px;padding:20px 0;">
                        <span class="material-symbols-outlined" style="font-size:32px;display:block;margin-bottom:8px;opacity:0.5;">hourglass_top</span>
                        Loading products...
                    </div>
                </div>
            </div>

            <!-- SECTION 3: Seasonal / Priority Products -->
            <div style="margin-bottom:40px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                    <span class="material-symbols-outlined" style="font-size:22px;color:#7C5CFF;">trending_up</span>
                    <label style="${T.label}margin:0;">Priority Products (What to Push)</label>
                </div>
                <p style="font-size:13px;color:#6B6F86;margin:0 0 12px;">Tell Mark which products are your current focus — bestsellers, new arrivals, or seasonal items. Mark will naturally recommend these first.</p>
                <textarea id="tt-priority-products" style="${T.input}min-height:90px;resize:vertical;line-height:1.6;" placeholder="Example: Our Mango Collection is the star right now — Pakistani Chaunsa and Sindhri mangoes are in season. Also push the Summer Hydration Bundle (20% off this week).">${esc(priorityProducts)}</textarea>
            </div>

            <div style="margin-bottom:40px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                    <span class="material-symbols-outlined" style="font-size:22px;color:#7C5CFF;">calendar_month</span>
                    <label style="${T.label}margin:0;">Seasonal Context</label>
                </div>
                <p style="font-size:13px;color:#6B6F86;margin:0 0 12px;">Current season, events, or promotions Mark should know about. Update this regularly.</p>
                <textarea id="tt-seasonal" style="${T.input}min-height:80px;resize:vertical;line-height:1.6;" placeholder="Example: It's Ramadan season — our Iftar Boxes are selling fast. Free delivery on orders above Rs 3,000. Eid sale starts next week with 30% off on all dry fruits.">${esc(seasonalProducts)}</textarea>
            </div>

            <!-- Save Button -->
            <div style="display:flex;justify-content:flex-end;">
                <button type="button" style="${T.btnPrimary}padding:14px 32px;font-size:15px;" onclick="markAdmin.saveTraining()">
                    <span class="material-symbols-outlined" style="font-size:18px;">save</span> Save Training Data
                </button>
            </div>
        </div>`;
    }

    async function initTrainingTab(s) {
        // Load products from RAG
        const remoteId = globalSettings.remote_store_id;
        const backendUrl = globalSettings.backend_url || 'https://mark-udfz.onrender.com';
        if (!remoteId) {
            const el = document.getElementById('tt-products-list');
            if (el) el.innerHTML = '<p style="color:#6B6F86;font-size:14px;padding:8px;">Connect to backend first (set Remote Store ID in Settings).</p>';
            return;
        }
        try {
            const resp = await fetch(backendUrl + '/api/status', {
                headers: { 'X-Store-ID': remoteId }
            });
            const data = await resp.json();
            const el = document.getElementById('tt-products-list');
            if (!el) return;

            const pagesIndexed = data.pages_indexed || 0;
            const productsLoaded = data.products_loaded || 0;
            const ragReady = data.rag_ready;

            let html = `<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:12px;">`;
            html += `<div style="padding:8px 16px;border-radius:8px;background:${ragReady ? 'rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.3)' : 'rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3)'};font-size:13px;font-weight:600;color:${ragReady ? '#16a34a' : '#d97706'};">
                RAG: ${ragReady ? 'Ready' : 'Indexing...'}
            </div>`;
            html += `<div style="padding:8px 16px;border-radius:8px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);font-size:13px;font-weight:600;color:#6366f1;">
                ${pagesIndexed} Pages Indexed
            </div>`;
            html += `<div style="padding:8px 16px;border-radius:8px;background:rgba(124,92,255,0.08);border:1px solid rgba(124,92,255,0.2);font-size:13px;font-weight:600;color:#7C5CFF;">
                ${productsLoaded} Products Found
            </div>`;
            html += `</div>`;

            if (productsLoaded === 0) {
                html += `<p style="font-size:13px;color:#6B6F86;">No products detected yet. If your site has products, click <strong>Sync Products</strong> to re-crawl.</p>`;
            } else {
                html += `<p style="font-size:13px;color:#6B6F86;">Mark knows about ${productsLoaded} products from your website. These are used for recommendations and answering product questions.</p>`;
            }
            el.innerHTML = html;
        } catch (e) {
            const el = document.getElementById('tt-products-list');
            if (el) el.innerHTML = '<p style="color:#D83A52;font-size:14px;padding:8px;">Could not reach backend. Make sure your backend is running.</p>';
        }
    }

    async function syncProducts() {
        const btn = document.getElementById('tt-sync-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;animation:markSpin 1s linear infinite;">sync</span> Syncing...'; }

        const remoteId = globalSettings.remote_store_id;
        const token = globalSettings.api_token;
        const backendUrl = globalSettings.backend_url || 'https://mark-udfz.onrender.com';
        if (!remoteId || !token) {
            toast('Connect to backend first (Remote Store ID + token in Settings).', 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">sync</span> Sync Products'; }
            return;
        }
        try {
            // Correct authenticated endpoint is /api/rag-crawl (needs website_url + token).
            await fetch(backendUrl + '/api/rag-crawl', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Store-Token': token },
                body: JSON.stringify({ store_id: remoteId, website_url: (currentStore && currentStore.website_url) || '' })
            });
            toast('Product sync started! RAG is re-crawling your website. This may take a minute.', 'success');
            // Refresh after a few seconds
            setTimeout(() => { if (currentStore) initTrainingTab(currentStore); }, 8000);
        } catch (e) {
            toast('Sync failed. Check your backend connection.', 'error');
        }
        if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">sync</span> Sync Products'; }
    }

    async function saveTraining() {
        const brandInfo = document.getElementById('tt-brand-info')?.value || '';
        const priorityProducts = document.getElementById('tt-priority-products')?.value || '';
        const seasonalProducts = document.getElementById('tt-seasonal')?.value || '';

        try {
            await api('PUT', 'stores/' + currentStore.store_id, {
                brand_description: brandInfo,
                priority_products: priorityProducts,
                seasonal_products: seasonalProducts,
            });
            currentStore.brand_description = brandInfo;
            currentStore.priority_products = priorityProducts;
            currentStore.seasonal_products = seasonalProducts;

            // Also sync to backend (token-authenticated)
            const remoteId = globalSettings.remote_store_id;
            const token = globalSettings.api_token;
            const backendUrl = globalSettings.backend_url || 'https://mark-udfz.onrender.com';
            if (remoteId && token) {
                fetch(backendUrl + '/api/sync-training', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Store-ID': remoteId, 'X-Store-Token': token },
                    body: JSON.stringify({ brand_description: brandInfo, priority_products: priorityProducts, seasonal_products: seasonalProducts })
                }).catch(() => {});
            }

            toast('Training data saved! Mark is now smarter about your brand.', 'success');
        } catch (e) {
            toast('Failed to save training data.', 'error');
        }
    }

    /* ================================================================
       TAB: ANALYTICS (Event-driven insights)
       ================================================================ */
    function renderAnalyticsTab(s) {
        return `
        <div style="margin-bottom:32px;">
            <h3 style="${T.headline}font-size:24px;font-weight:400;margin:0 0 8px;">
                <span class="material-symbols-outlined" style="font-size:24px;vertical-align:middle;margin-right:8px;color:#7C5CFF;">analytics</span>
                Event Analytics
            </h3>
            <p style="color:#4B4F66;font-size:14px;margin:0;">Track how visitors interact with Mark on your site.</p>
        </div>

        <!-- Event Stat Cards -->
        <div id="analytics-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:40px;">
            ${renderMiniStat('Widget Opens', '--', 'widgets')}
            ${renderMiniStat('Chats Started', '--', 'chat_bubble')}
            ${renderMiniStat('Messages', '--', 'forum')}
            ${renderMiniStat('Voice Used', '--', 'mic')}
            ${renderMiniStat('Links Clicked', '--', 'link')}
            ${renderMiniStat('Leads', '--', 'contact_mail')}
        </div>

        <!-- Conversion Funnel -->
        <div style="${T.glass}padding:32px;margin-bottom:32px;">
            <h4 style="${T.headline}font-size:18px;font-weight:600;margin:0 0 24px;">
                <span class="material-symbols-outlined" style="font-size:20px;vertical-align:middle;margin-right:6px;color:#7C5CFF;">filter_alt</span>
                Conversion Funnel (30 days)
            </h4>
            <div id="analytics-funnel" style="display:flex;flex-direction:column;gap:0;">
                ${renderFunnelStep('Widget Opened', '--', 100, '#7C5CFF')}
                ${renderFunnelStep('Chat Started', '--', 0, '#e88a5e')}
                ${renderFunnelStep('Message Sent', '--', 0, '#d47a50')}
                ${renderFunnelStep('Lead Captured', '--', 0, '#7C5CFF')}
            </div>
        </div>

        <!-- Daily Trends Chart -->
        <div style="${T.glass}padding:32px;margin-bottom:32px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
                <h4 style="${T.headline}font-size:18px;font-weight:600;margin:0;">
                    <span class="material-symbols-outlined" style="font-size:20px;vertical-align:middle;margin-right:6px;color:#7C5CFF;">trending_up</span>
                    Daily Trends (14 days)
                </h4>
                <div style="display:flex;gap:16px;flex-wrap:wrap;">
                    <span style="display:flex;align-items:center;gap:4px;font-size:12px;color:#4B4F66;">
                        <span style="width:12px;height:3px;border-radius:2px;background:#7C5CFF;display:inline-block;"></span> Widget Opens
                    </span>
                    <span style="display:flex;align-items:center;gap:4px;font-size:12px;color:#4B4F66;">
                        <span style="width:12px;height:3px;border-radius:2px;background:#6B6F86;display:inline-block;"></span> Chats
                    </span>
                    <span style="display:flex;align-items:center;gap:4px;font-size:12px;color:#4B4F66;">
                        <span style="width:12px;height:3px;border-radius:2px;background:#16a34a;display:inline-block;"></span> Voice
                    </span>
                </div>
            </div>
            <div style="height:260px;position:relative;">
                <canvas id="analytics-trend-chart"></canvas>
            </div>
        </div>

        <!-- Unique Visitors -->
        <div style="${T.glassLight}padding:24px;display:flex;align-items:center;gap:16px;">
            <span class="material-symbols-outlined" style="font-size:32px;color:#6B6F86;">group</span>
            <div>
                <div style="font-size:14px;color:#4B4F66;font-weight:600;">Unique Visitors (30 days)</div>
                <div id="analytics-unique" style="font-family:'Plus Jakarta Sans',sans-serif;font-size:28px;font-weight:300;color:#14152A;">--</div>
            </div>
        </div>`;
    }

    function renderFunnelStep(label, value, pct, color) {
        const width = Math.max(pct, 8);
        return `
        <div style="display:flex;align-items:center;gap:16px;padding:8px 0;">
            <div style="width:140px;font-size:13px;color:#4B4F66;font-weight:500;text-align:right;flex-shrink:0;">${label}</div>
            <div style="flex:1;position:relative;height:36px;background:rgba(194,199,202,0.1);border-radius:6px;overflow:hidden;">
                <div style="height:100%;width:${width}%;background:${color};border-radius:6px;transition:width 0.6s ease;display:flex;align-items:center;justify-content:flex-end;padding-right:12px;">
                    <span style="font-size:14px;font-weight:600;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.2);" class="funnel-val">${formatNum(value)}</span>
                </div>
            </div>
            <div style="width:50px;font-size:12px;color:#6B6F86;text-align:right;flex-shrink:0;" class="funnel-pct">${pct > 0 ? pct + '%' : '--'}</div>
        </div>`;
    }

    async function loadEventAnalytics(s) {
        // Ensure globalSettings is loaded (may not be if user navigated directly to store page)
        if (!globalSettings || !globalSettings.api_token) {
            try { globalSettings = await api('GET', 'settings'); } catch (e) {}
        }
        const backendUrl = globalSettings.backend_url || 'https://mark-udfz.onrender.com';
        const settings = globalSettings || {};
        const token = settings.api_token || '';
        const remoteStoreId = settings.remote_store_id || s.store_id;

        try {
            const resp = await fetch(backendUrl + '/api/stores/' + remoteStoreId + '/event-analytics?days=30', {
                headers: { 'X-Store-Token': token }
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();

            const totals = data.totals || {};
            const daily = data.daily || {};
            const leads = data.lead_count || 0;
            const unique = data.unique_visitors || 0;

            // Update stat cards
            const cardValues = [
                totals.widget_open || 0,
                totals.chat_start || 0,
                totals.chat_message || 0,
                totals.voice_used || 0,
                totals.link_clicked || 0,
                leads
            ];
            const cards = document.querySelectorAll('#analytics-cards > div');
            cards.forEach((card, i) => {
                const numEl = card.querySelector('div:last-child');
                if (numEl && cardValues[i] !== undefined) numEl.textContent = formatNum(cardValues[i]);
            });

            // Update funnel
            const funnelData = [
                totals.widget_open || 0,
                totals.chat_start || 0,
                totals.chat_message || 0,
                leads
            ];
            const funnelMax = Math.max(funnelData[0], 1);
            const funnelContainer = document.getElementById('analytics-funnel');
            if (funnelContainer) {
                const steps = funnelContainer.querySelectorAll(':scope > div');
                steps.forEach((step, i) => {
                    const pct = Math.round((funnelData[i] / funnelMax) * 100);
                    const bar = step.querySelector('div:nth-child(2) > div');
                    const valEl = step.querySelector('.funnel-val');
                    const pctEl = step.querySelector('.funnel-pct');
                    if (bar) bar.style.width = Math.max(pct, 8) + '%';
                    if (valEl) valEl.textContent = formatNum(funnelData[i]);
                    if (pctEl) pctEl.textContent = pct + '%';
                });
            }

            // Update unique visitors
            const uniqueEl = document.getElementById('analytics-unique');
            if (uniqueEl) uniqueEl.textContent = formatNum(unique);

            // Render daily trends chart
            renderAnalyticsTrendChart(daily);

        } catch (e) {
            console.warn('Event analytics load error:', e);
            // Show a subtle error message in the cards area
            const cards = document.getElementById('analytics-cards');
            if (cards) {
                cards.insertAdjacentHTML('afterend',
                    `<p style="color:#6B6F86;font-size:13px;margin:-24px 0 24px;font-style:italic;">
                        <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">info</span>
                        Event analytics unavailable — backend may be starting up. Try again in a moment.
                    </p>`);
            }
        }
    }

    function renderAnalyticsTrendChart(dailyData) {
        const canvas = document.getElementById('analytics-trend-chart');
        if (!canvas || typeof Chart === 'undefined') return;

        if (chartInstances.analyticsTrend) {
            try { chartInstances.analyticsTrend.destroy(); } catch (e) {}
        }

        // Build sorted date labels from daily data
        const dates = Object.keys(dailyData).sort();
        const labels = dates.map(d => {
            const dt = new Date(d + 'T00:00:00');
            return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        });

        const widgetOpens = dates.map(d => (dailyData[d] || {}).widget_open || 0);
        const chatStarts = dates.map(d => (dailyData[d] || {}).chat_start || 0);
        const voiceUsed = dates.map(d => (dailyData[d] || {}).voice_used || 0);

        chartInstances.analyticsTrend = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Widget Opens',
                        data: widgetOpens,
                        borderColor: '#7C5CFF',
                        backgroundColor: 'rgba(124,92,255,0.08)',
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 5,
                        pointBackgroundColor: '#7C5CFF',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                    },
                    {
                        label: 'Chats',
                        data: chatStarts,
                        borderColor: '#6B6F86',
                        backgroundColor: 'rgba(79,97,105,0.06)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 5,
                        pointBackgroundColor: '#6B6F86',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                    },
                    {
                        label: 'Voice',
                        data: voiceUsed,
                        borderColor: '#16a34a',
                        backgroundColor: 'rgba(22,163,74,0.06)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 5,
                        pointBackgroundColor: '#16a34a',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(26,28,28,0.92)',
                        titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
                        bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 13 },
                        padding: 12,
                        cornerRadius: 8,
                        callbacks: {
                            label: function(ctx) {
                                return ' ' + ctx.dataset.label + ': ' + ctx.parsed.y;
                            }
                        }
                    },
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(194,199,202,0.12)' },
                        ticks: { font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 }, color: '#6B6F86', maxRotation: 45 },
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(194,199,202,0.12)' },
                        ticks: { font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 }, color: '#6B6F86', stepSize: 1 },
                    },
                },
            },
        });
    }

    /* ================================================================
       TAB: AUTO-LEARNING (MAIE — Mark Adaptive Intelligence Engine)
       Glass box into what Mark has learned from real conversations.
       ================================================================ */
    const PERSONA_META = {
        price_hunter:  { label: 'Price Hunter',   icon: 'sell',            color: '#16a34a' },
        researcher:    { label: 'Researcher',     icon: 'fact_check',      color: '#6B6F86' },
        impulse_buyer: { label: 'Impulse Buyer',  icon: 'bolt',           color: '#d97706' },
        skeptic:       { label: 'Skeptic',        icon: 'gpp_maybe',       color: '#9333ea' },
        gift_buyer:    { label: 'Gift Buyer',     icon: 'redeem',          color: '#db2777' },
        browser:       { label: 'Casual Browser', icon: 'visibility',      color: '#0891b2' },
    };

    // Shared token-auth fetch to the backend (same pattern as analytics).
    async function maieFetch(s, path, opts) {
        if (!globalSettings || !globalSettings.api_token) {
            try { globalSettings = await api('GET', 'settings'); } catch (e) {}
        }
        const settings = globalSettings || {};
        const backendUrl = settings.backend_url || 'https://mark-udfz.onrender.com';
        const token = settings.api_token || '';
        const remoteStoreId = settings.remote_store_id || s.store_id;
        const o = opts || {};
        o.headers = Object.assign({ 'X-Store-Token': token, 'Content-Type': 'application/json' }, o.headers || {});
        const resp = await fetch(backendUrl + '/api/stores/' + remoteStoreId + path, o);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
    }

    function renderLearningTab(s) {
        return `
        <div style="margin-bottom:32px;">
            <h3 style="${T.headline}font-size:24px;font-weight:400;margin:0 0 8px;">
                <span class="material-symbols-outlined" style="font-size:24px;vertical-align:middle;margin-right:8px;color:#7C5CFF;">neurology</span>
                Auto-Learning
            </h3>
            <p style="color:#4B4F66;font-size:14px;margin:0;max-width:680px;">
                Mark studies real (anonymized) conversations on your store and learns who your buyers are
                and how to sell to them — automatically. This is a glass box: everything Mark learns is shown
                below, and you stay in control.
            </p>
        </div>

        <!-- Controls -->
        <div style="${T.glass}padding:28px;margin-bottom:24px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap;">
                <div style="flex:1;min-width:240px;">
                    <div id="learn-toggle-row" style="display:flex;flex-direction:column;gap:18px;">
                        <label style="display:flex;align-items:center;gap:12px;cursor:pointer;">
                            <input type="checkbox" id="learn-enabled" onchange="markAdmin.toggleLearning('auto_learning_enabled', this.checked)" style="width:18px;height:18px;accent-color:#7C5CFF;cursor:pointer;">
                            <span>
                                <span style="font-weight:600;color:#14152A;font-size:15px;">Enable auto-learning</span>
                                <span style="display:block;color:#6B6F86;font-size:13px;">Capture conversation patterns and improve Mark over time.</span>
                            </span>
                        </label>
                        <label style="display:flex;align-items:center;gap:12px;cursor:pointer;">
                            <input type="checkbox" id="learn-autoapprove" onchange="markAdmin.toggleLearning('learning_autoapprove', this.checked)" style="width:18px;height:18px;accent-color:#7C5CFF;cursor:pointer;">
                            <span>
                                <span style="font-weight:600;color:#14152A;font-size:15px;">Auto-apply new playbooks</span>
                                <span style="display:block;color:#6B6F86;font-size:13px;">Apply each new playbook automatically. Turn off to review before activating.</span>
                            </span>
                        </label>
                    </div>
                </div>
                <div style="text-align:right;">
                    <button id="learn-train-btn" style="${T.btnPrimary}" onclick="markAdmin.trainPlaybook()">
                        <span class="material-symbols-outlined" style="font-size:18px;">model_training</span>
                        Train Now
                    </button>
                    <div style="color:#6B6F86;font-size:12px;margin-top:8px;">Distills new conversations into a fresh playbook.</div>
                </div>
            </div>
        </div>

        <!-- Status strip -->
        <div id="learn-status" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:32px;">
            ${renderMiniStat('Signals Collected', '--', 'database')}
            ${renderMiniStat('Pending Distill', '--', 'pending')}
            ${renderMiniStat('Playbook Version', '--', 'menu_book')}
            ${renderMiniStat('Last Trained', '--', 'schedule')}
        </div>

        <!-- Playbook body -->
        <div id="learn-playbook"></div>`;
    }

    function renderLearningEmpty(pending, minNeeded) {
        const need = Math.max(0, (minNeeded || 12) - (pending || 0));
        return `
        <div style="${T.glassLight}padding:48px 32px;text-align:center;">
            <span class="material-symbols-outlined" style="font-size:48px;color:#7C5CFF;">school</span>
            <h4 style="${T.headline}font-size:18px;font-weight:600;margin:16px 0 8px;">No playbook yet</h4>
            <p style="color:#4B4F66;font-size:14px;margin:0 auto;max-width:460px;">
                Mark needs at least <strong>${minNeeded || 12}</strong> meaningful conversations before it can
                distill a playbook. ${need > 0 ? `About <strong>${need}</strong> more to go.` : 'Enough data — hit <strong>Train Now</strong>!'}
            </p>
        </div>`;
    }

    function renderPersonaCard(p) {
        const meta = PERSONA_META[p.key] || { label: p.label || p.key, icon: 'person', color: '#7C5CFF' };
        const phrases = (p.winning_phrases || []).map(x =>
            `<span style="display:inline-block;background:rgba(22,163,74,0.1);color:#15803d;font-size:12px;padding:3px 10px;border-radius:12px;margin:2px 4px 2px 0;">${esc(x)}</span>`).join('');
        const avoid = (p.avoid || []).map(x =>
            `<span style="display:inline-block;background:rgba(186,26,26,0.08);color:#D83A52;font-size:12px;padding:3px 10px;border-radius:12px;margin:2px 4px 2px 0;">${esc(x)}</span>`).join('');
        return `
        <div style="${T.glassLight}padding:24px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
                <span class="material-symbols-outlined" style="font-size:26px;color:${meta.color};">${meta.icon}</span>
                <span style="font-weight:700;font-size:16px;color:#14152A;">${esc(meta.label)}</span>
            </div>
            ${p.psychology ? `<p style="margin:0 0 12px;font-size:13px;color:#4B4F66;font-style:italic;">${esc(p.psychology)}</p>` : ''}
            ${p.how_to_talk ? `<div style="margin-bottom:8px;font-size:13px;"><strong style="color:#6B6F86;">Talk:</strong> <span style="color:#4B4F66;">${esc(p.how_to_talk)}</span></div>` : ''}
            ${p.how_to_sell ? `<div style="margin-bottom:12px;font-size:13px;"><strong style="color:#6B6F86;">Sell:</strong> <span style="color:#4B4F66;">${esc(p.how_to_sell)}</span></div>` : ''}
            ${phrases ? `<div style="margin-bottom:8px;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6B6F86;margin-bottom:4px;">Phrasing that works</div>${phrases}</div>` : ''}
            ${avoid ? `<div><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6B6F86;margin-bottom:4px;">Avoid</div>${avoid}</div>` : ''}
        </div>`;
    }

    // "Who shops on your store" — live persona distribution + win-rate per type.
    // This is the headline 'what Mark learned' insight for the owner.
    function renderPersonaDistribution(dist) {
        if (!dist || !dist.length) return '';
        const grand = dist.reduce((a, d) => a + (d.total || 0), 0);
        if (!grand) return '';
        const rows = dist.map(d => {
            const meta = PERSONA_META[d.persona] || { label: d.persona, icon: 'person', color: '#7C5CFF' };
            const share = Math.round((d.total / grand) * 100);
            const win = Math.round((d.win_rate || 0) * 100);
            return `
            <div style="margin-bottom:18px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <span style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:#14152A;">
                        <span class="material-symbols-outlined" style="font-size:18px;color:${meta.color};">${meta.icon}</span>
                        ${esc(meta.label)}
                    </span>
                    <span style="font-size:13px;color:#6B6F86;">${share}% of buyers · <strong style="color:#15803d;">${win}% win</strong> · ${formatNum(d.total)} chats</span>
                </div>
                <div style="height:8px;background:rgba(0,0,0,0.05);border-radius:4px;overflow:hidden;">
                    <div style="height:100%;width:${share}%;background:linear-gradient(90deg,${meta.color},${meta.color}aa);border-radius:4px;transition:width .6s;"></div>
                </div>
            </div>`;
        }).join('');
        return `
        <div style="${T.glass}padding:28px;margin-bottom:24px;">
            <h4 style="${T.headline}font-size:18px;font-weight:600;margin:0 0 6px;">
                <span class="material-symbols-outlined" style="font-size:20px;vertical-align:middle;margin-right:6px;color:#7C5CFF;">diversity_3</span>
                Who shops on your store
            </h4>
            <p style="color:#6B6F86;font-size:13px;margin:0 0 20px;">Buyer-type mix Mark detected from ${formatNum(grand)} real conversations, with how often each type converts.</p>
            ${rows}
        </div>`;
    }

    function renderPlaybookHistory(history, activeVersion) {
        if (!history || history.length < 2) return '';
        const items = history.slice(0, 8).map(h => {
            const isActive = h.version === activeVersion;
            const when = h.generated_at ? new Date(h.generated_at * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
            return `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.04);">
                <span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;font-size:11px;font-weight:700;
                    background:${isActive ? 'rgba(21,128,61,0.12)' : 'rgba(0,0,0,0.05)'};color:${isActive ? '#15803d' : '#6B6F86'};">v${h.version}</span>
                <span style="flex:1;font-size:13px;color:#4B4F66;">${h.sample_size ? formatNum(h.sample_size) + ' conversations' : 'playbook update'}</span>
                <span style="font-size:12px;color:#6B6F86;">${when}${isActive ? ' · <strong style="color:#15803d;">active</strong>' : ''}</span>
            </div>`;
        }).join('');
        return `
        <div style="${T.glassLight}padding:24px;margin-top:24px;">
            <h4 style="${T.headline}font-size:16px;font-weight:600;margin:0 0 12px;">
                <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;margin-right:6px;color:#7C5CFF;">history</span>
                How Mark improved over time
            </h4>
            ${items}
        </div>`;
    }

    function renderPlaybook(data) {
        const pb = data.active;
        if (!pb) return renderLearningEmpty(data.signals_pending, data.min_signals_to_train);

        const personas = (pb.personas || []).map(renderPersonaCard).join('');
        const winning = (pb.winning_tactics || []).map(t =>
            `<li style="margin-bottom:8px;color:#15803d;font-size:14px;">${esc(t)}</li>`).join('');
        const losing = (pb.losing_patterns || []).map(t =>
            `<li style="margin-bottom:8px;color:#D83A52;font-size:14px;">${esc(t)}</li>`).join('');

        return `
        ${pb.summary ? `
        <div style="${T.glass}padding:28px;margin-bottom:24px;border-left:4px solid #7C5CFF;">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#6B6F86;margin-bottom:8px;">What Mark learned about your buyers</div>
            <p style="margin:0;font-size:15px;line-height:1.6;color:#14152A;">${esc(pb.summary)}</p>
        </div>` : ''}

        ${renderPersonaDistribution(data.persona_distribution)}

        ${personas ? `
        <h4 style="${T.headline}font-size:18px;font-weight:600;margin:0 0 16px;">
            <span class="material-symbols-outlined" style="font-size:20px;vertical-align:middle;margin-right:6px;color:#7C5CFF;">groups</span>
            Buyer Personas <span style="font-size:13px;color:#6B6F86;font-weight:400;">(detected on your store)</span>
        </h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:32px;">${personas}</div>` : ''}

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">
            ${winning ? `<div style="${T.glassLight}padding:24px;">
                <h4 style="${T.headline}font-size:16px;font-weight:600;margin:0 0 14px;color:#15803d;">
                    <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;margin-right:6px;">trending_up</span>What's working
                </h4>
                <ul style="margin:0;padding-left:20px;">${winning}</ul>
            </div>` : ''}
            ${losing ? `<div style="${T.glassLight}padding:24px;">
                <h4 style="${T.headline}font-size:16px;font-weight:600;margin:0 0 14px;color:#D83A52;">
                    <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;margin-right:6px;">trending_down</span>What loses sales
                </h4>
                <ul style="margin:0;padding-left:20px;">${losing}</ul>
            </div>` : ''}
        </div>

        ${renderPlaybookHistory(data.history, pb.version)}`;
    }

    async function loadPlaybook(s) {
        try {
            const data = await maieFetch(s, '/playbook');

            // Toggles
            const enEl = document.getElementById('learn-enabled');
            const apEl = document.getElementById('learn-autoapprove');
            if (enEl) enEl.checked = !!data.auto_learning_enabled;
            if (apEl) apEl.checked = !!data.learning_autoapprove;

            // Status cards
            const lastRun = data.learning_last_run
                ? new Date(data.learning_last_run * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                : 'Never';
            const version = data.active ? ('v' + data.active.version) : '--';
            const vals = [data.signals_total || 0, data.signals_pending || 0, version, lastRun];
            const cards = document.querySelectorAll('#learn-status > div');
            cards.forEach((card, i) => {
                const numEl = card.querySelector('div:last-child');
                if (numEl && vals[i] !== undefined) numEl.textContent = (typeof vals[i] === 'number') ? formatNum(vals[i]) : vals[i];
            });

            // Playbook body
            const body = document.getElementById('learn-playbook');
            if (body) body.innerHTML = renderPlaybook(data);
        } catch (e) {
            console.warn('Playbook load error:', e);
            const body = document.getElementById('learn-playbook');
            if (body) body.innerHTML = `<p style="color:#6B6F86;font-size:13px;font-style:italic;">
                <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">info</span>
                Learning data unavailable — backend may be starting up. Try again in a moment.</p>`;
        }
    }

    async function trainPlaybook() {
        const btn = document.getElementById('learn-train-btn');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">hourglass_top</span> Training…'; }
        try {
            const res = await maieFetch(currentStore, '/train', { method: 'POST' });
            if (res.trained) {
                toast('Playbook trained! Now on v' + res.version + ' (' + res.sample_size + ' conversations).', 'success');
                loadPlaybook(currentStore);
            } else {
                const reason = (res.reason || '').startsWith('not_enough_signals')
                    ? 'Not enough conversations yet — keep chatting and try again later.'
                    : ('Training skipped: ' + (res.reason || 'unknown'));
                toast(reason, 'info');
            }
        } catch (e) {
            toast('Training failed — backend may be waking up. Try again shortly.', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">model_training</span> Train Now'; }
        }
    }

    async function toggleLearning(field, value) {
        try {
            const body = {}; body[field] = !!value;
            await maieFetch(currentStore, '/learning-settings', { method: 'POST', body: JSON.stringify(body) });
            toast(field === 'auto_learning_enabled'
                ? (value ? 'Auto-learning enabled.' : 'Auto-learning paused.')
                : (value ? 'New playbooks will auto-apply.' : 'New playbooks need your approval.'), 'success');
        } catch (e) {
            toast('Could not save setting.', 'error');
        }
    }

    /* ================================================================
       TAB: SALES SKILLS
       ================================================================ */
    function renderSalesTab(s) {
        const behavior = s.sales_behavior || 'helpful';
        const noDiscounts = s.sales_no_discounts !== undefined ? s.sales_no_discounts : true;
        const noPricePromises = s.sales_no_price_promises !== undefined ? s.sales_no_price_promises : true;
        const noGuarantees = s.sales_no_guarantees !== undefined ? s.sales_no_guarantees : true;
        const objStyle = s.sales_objection_style || 'graceful';
        const leadCapture = s.sales_lead_capture || 'off';
        const ctaUrl = s.sales_cta_url || '';
        const ctaText = s.sales_cta_text || '';
        return `
        <div style="${T.glassLight}padding:40px;">
            <h3 style="${T.headline}font-size:24px;margin:0 0 8px;">Sales Intelligence</h3>
            <p style="color:#4B4F66;font-size:14px;margin:0 0 32px;">Control how Mark handles sales conversations. Smart, not pushy.</p>

            <form style="display:flex;flex-direction:column;gap:32px;" onsubmit="event.preventDefault();markAdmin.saveSalesSettings();">

                <!-- Sales Behavior Mode -->
                <div>
                    <label style="${T.label}">Sales Behavior Mode</label>
                    <select id="ss-behavior" style="${T.select}">
                        <option value="helpful" ${behavior==='helpful'?'selected':''}>Helpful (Assist only — never push sales)</option>
                        <option value="soft-sell" ${behavior==='soft-sell'?'selected':''}>Soft Sell (Gently suggest products when relevant)</option>
                        <option value="active" ${behavior==='active'?'selected':''}>Active (Proactively recommend products from RAG)</option>
                    </select>
                    <span style="font-size:12px;color:#6B6F86;margin-top:4px;display:block;">
                        <strong>Helpful:</strong> Only answers questions, never suggests buying.
                        <strong>Soft Sell:</strong> Mentions relevant products naturally.
                        <strong>Active:</strong> Actively recommends products when user shows interest.
                    </span>
                </div>

                <!-- Discount Policy -->
                <div style="padding:20px;border:1px solid rgba(186,26,26,0.2);border-radius:12px;background:rgba(255,218,214,0.06);">
                    <label style="${T.label}color:#D83A52;">Discount & Pricing Policy</label>
                    <div style="display:flex;flex-direction:column;gap:12px;margin-top:8px;">
                        <label style="display:flex;align-items:center;gap:10px;font-size:14px;color:#4B4F66;cursor:pointer;">
                            <input type="checkbox" id="ss-no-discounts" ${noDiscounts?'checked':''} style="width:18px;height:18px;accent-color:#7C5CFF;" />
                            <strong>Block Mark from offering discounts</strong> (Recommended)
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;font-size:14px;color:#4B4F66;cursor:pointer;">
                            <input type="checkbox" id="ss-no-price-promises" ${noPricePromises?'checked':''} style="width:18px;height:18px;accent-color:#7C5CFF;" />
                            <strong>Block Mark from promising specific prices</strong> without RAG data
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;font-size:14px;color:#4B4F66;cursor:pointer;">
                            <input type="checkbox" id="ss-no-guarantees" ${noGuarantees?'checked':''} style="width:18px;height:18px;accent-color:#7C5CFF;" />
                            <strong>Block Mark from making guarantees</strong> (free shipping, returns, etc.)
                        </label>
                    </div>
                </div>

                <!-- Objection Handling -->
                <div>
                    <label style="${T.label}">Objection Handling Style</label>
                    <select id="ss-objection-style" style="${T.select}">
                        <option value="graceful" ${objStyle==='graceful'?'selected':''}>Graceful Exit (Accept & move on — "No worries!")</option>
                        <option value="one-try" ${objStyle==='one-try'?'selected':''}>One Follow-up (Ask one question, then accept)</option>
                    </select>
                </div>

                <!-- Lead Capture -->
                <div>
                    <label style="${T.label}">Lead Capture</label>
                    <select id="ss-lead-capture" style="${T.select}">
                        <option value="off" ${leadCapture==='off'?'selected':''}>Off (Don't ask for contact info)</option>
                        <option value="natural" ${leadCapture==='natural'?'selected':''}>Natural (Ask for email only if user shows strong interest)</option>
                        <option value="proactive" ${leadCapture==='proactive'?'selected':''}>Proactive (Ask for email after 3+ exchanges)</option>
                    </select>
                    <div style="margin-top:8px;padding:12px 16px;background:rgba(79,97,105,0.06);border:1px solid rgba(79,97,105,0.15);border-radius:8px;display:flex;align-items:flex-start;gap:8px;">
                        <span class="material-symbols-outlined" style="font-size:16px;color:#6B6F86;flex-shrink:0;margin-top:1px;">info</span>
                        <span style="font-size:12px;color:#4B4F66;line-height:1.5;">Captured leads appear in your <strong>Conversations</strong> tab. Look for messages where visitors shared their email address. All chat messages are logged automatically.</span>
                    </div>
                </div>

                <!-- CTA URL -->
                <div>
                    <label style="${T.label}">Call-to-Action URL (Optional)</label>
                    <input id="ss-cta-url" type="url" value="${esc(ctaUrl)}" style="${T.input}" placeholder="e.g., /contact or /get-started" />
                    <span style="font-size:12px;color:#6B6F86;margin-top:4px;display:block;">If set, Mark will suggest this page when visitors show strong buying interest.</span>
                </div>

                <!-- CTA Text -->
                <div>
                    <label style="${T.label}">CTA Button Text (Optional)</label>
                    <input id="ss-cta-text" type="text" value="${esc(ctaText)}" style="${T.input}" placeholder="e.g., Get Started, Book a Call, Contact Us" />
                </div>

                <div style="padding-top:24px;border-top:1px solid rgba(194,199,202,0.3);display:flex;justify-content:flex-end;">
                    <button type="submit" style="${T.btnPrimary}">Save Sales Settings</button>
                </div>
            </form>
        </div>`;
    }

    async function saveSalesSettings() {
        const ctaUrl = $('#ss-cta-url').value.trim();
        // Validate CTA URL if provided
        if (ctaUrl && !ctaUrl.startsWith('/') && !ctaUrl.startsWith('http://') && !ctaUrl.startsWith('https://')) {
            toast('CTA URL must start with / or http:// or https://', 'error');
            return;
        }

        const data = {
            sales_behavior: $('#ss-behavior').value,
            sales_no_discounts: $('#ss-no-discounts').checked,
            sales_no_price_promises: $('#ss-no-price-promises').checked,
            sales_no_guarantees: $('#ss-no-guarantees').checked,
            sales_objection_style: $('#ss-objection-style').value,
            sales_lead_capture: $('#ss-lead-capture').value,
            sales_cta_url: ctaUrl,
            sales_cta_text: $('#ss-cta-text').value,
        };
        try {
            await api('PUT', 'stores/' + currentStore.store_id, data);
            currentStore = { ...currentStore, ...data };
            toast('Sales settings saved!', 'success');
        } catch (e) { toast(e.message, 'error'); }
    }

    /* ================================================================
       TAB: VOICE
       ================================================================ */
    function renderVoiceTab(s) {
        return `
        <div style="display:grid;grid-template-columns:1fr 320px;gap:40px;">
            <div style="${T.glassLight}padding:40px;">
                <h3 style="${T.headline}font-size:24px;margin:0 0 8px;">Voice Configuration</h3>
                <p style="color:#4B4F66;font-size:14px;margin:0 0 32px;">Powered by <span style="color:#7C5CFF;font-weight:600;">Edge TTS</span> -- free, no API key needed.</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
                    <div><label style="${T.label}">English Voice</label><select id="s-tts-voice" style="${T.select}">
                        <option value="en-GB-RyanNeural" ${!s.tts_voice||s.tts_voice==='en-US-GuyNeural'||s.tts_voice==='en-GB-RyanNeural'?'selected':''}>Ryan (Male, British) — default</option>
                        <option value="en-GB-SoniaNeural" ${s.tts_voice==='en-GB-SoniaNeural'?'selected':''}>Sonia (Female, British)</option>
                        <option value="en-US-GuyNeural" ${s.tts_voice==='en-US-GuyNeural'?'':''}>Guy (Male, US Warm)</option>
                        <option value="en-US-AriaNeural" ${s.tts_voice==='en-US-AriaNeural'?'selected':''}>Aria (Female, US Natural)</option>
                        <option value="en-US-JennyNeural" ${s.tts_voice==='en-US-JennyNeural'?'selected':''}>Jenny (Female, US Friendly)</option>
                        <option value="en-US-DavisNeural" ${s.tts_voice==='en-US-DavisNeural'?'selected':''}>Davis (Male, US Casual)</option>
                    </select></div>
                    <div><label style="${T.label}">Voice Speed</label><select id="s-tts-rate" style="${T.select}">
                        <option value="-30%" ${s.tts_rate==='-30%'?'selected':''}>Very Slow (-30%)</option>
                        <option value="-20%" ${s.tts_rate==='-20%'?'selected':''}>Slow (-20%)</option>
                        <option value="-10%" ${s.tts_rate==='-10%'?'selected':''}>Slightly Slow (-10%)</option>
                        <option value="+0%" ${!s.tts_rate||s.tts_rate==='+0%'?'selected':''}>Normal</option>
                        <option value="+10%" ${s.tts_rate==='+10%'?'selected':''}>Slightly Fast (+10%)</option>
                        <option value="+20%" ${s.tts_rate==='+20%'?'selected':''}>Fast (+20%)</option>
                        <option value="+35%" ${s.tts_rate==='+35%'?'selected':''}>Very Fast (+35%)</option>
                    </select><span style="font-size:12px;color:#6B6F86;margin-top:4px;display:block;">How fast Mark speaks. Preview below before saving.</span></div>
                    <div><label style="${T.label}">Pitch</label><select id="s-tts-pitch" style="${T.select}">
                        <option value="-10Hz" ${s.tts_pitch==='-10Hz'?'selected':''}>Lower</option>
                        <option value="+0Hz" ${!s.tts_pitch||s.tts_pitch==='+0Hz'?'selected':''}>Normal</option>
                        <option value="+10Hz" ${s.tts_pitch==='+10Hz'?'selected':''}>Higher</option>
                    </select></div>
                </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:16px;">
                <div style="${T.glassLight}padding:24px;display:flex;flex-direction:column;gap:12px;">
                    <button style="${T.btnPrimary}width:100%;justify-content:center;" onclick="markAdmin.saveVoice()">Save Voice Settings</button>
                    <button style="${T.btnSecondary}width:100%;justify-content:center;" onclick="markAdmin.testVoice()">
                        <span class="material-symbols-outlined" style="font-size:18px;">play_arrow</span> Test Voice
                    </button>
                </div>
                <div id="voice-preview" style="${T.glassLight}padding:24px;display:none;">
                    <span style="${T.label}">Voice Preview</span>
                    <div id="voice-preview-content" style="margin-top:8px;"></div>
                </div>
            </div>
        </div>`;
    }

    async function saveVoice() {
        const data = { tts_voice: $('#s-tts-voice').value, tts_rate: $('#s-tts-rate').value, tts_pitch: $('#s-tts-pitch').value };
        try {
            await api('PUT', 'stores/' + currentStore.store_id, data);
            currentStore = { ...currentStore, ...data };
            // Sync voice settings to backend so TTS uses the new voice immediately (token-authenticated)
            const remoteId = globalSettings.remote_store_id;
            const token = globalSettings.api_token;
            if (remoteId && token) {
                const backendUrl = globalSettings.backend_url || (markAI || {}).backendUrl || 'https://mark-udfz.onrender.com';
                fetch(backendUrl + '/api/sync-voice', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Store-ID': remoteId, 'X-Store-Token': token },
                    body: JSON.stringify({ tts_voice: data.tts_voice, tts_rate: data.tts_rate, tts_pitch: data.tts_pitch })
                }).catch(() => {});
            }
            toast('Voice settings saved!', 'success');
        }
        catch (e) { toast(e.message, 'error'); }
    }

    async function testVoice() {
        const text = 'Hey there! I am Mark, your friendly robot assistant.';
        const preview = $('#voice-preview'), previewContent = $('#voice-preview-content');
        if (preview && previewContent) {
            preview.style.display = 'block';
            previewContent.innerHTML = `<div style="display:flex;align-items:center;gap:12px;"><span class="material-symbols-outlined" style="animation:markRobotBob 0.8s ease-in-out infinite;font-size:26px;color:#7C5CFF;">graphic_eq</span><span style="font-size:14px;color:#4B4F66;">Generating voice...</span></div>`;
        }
        const settings = markAI || {};
        const backendUrl = settings.backendUrl || 'https://mark-udfz.onrender.com';
        const remoteId = globalSettings.remote_store_id || '';
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (remoteId) headers['X-Store-ID'] = remoteId;
            // Send currently selected voice (not saved yet) so user can preview before saving
            const selectedVoice = $('#s-tts-voice')?.value || '';
            const selectedRate = $('#s-tts-rate')?.value || '';
            const selectedPitch = $('#s-tts-pitch')?.value || '';
            const res = await fetch(backendUrl + '/api/tts', { method: 'POST', headers,
                body: JSON.stringify({ text, language: 'en', store_id: remoteId,
                    voice_override: selectedVoice, rate_override: selectedRate, pitch_override: selectedPitch }) });
            if (res.ok) {
                const blob = await res.blob(); const url = URL.createObjectURL(blob);
                const audio = new Audio(url); audio.onended = () => URL.revokeObjectURL(url); await audio.play();
                if (previewContent) previewContent.innerHTML = `<div style="display:flex;align-items:center;gap:12px;"><button style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#7C5CFF,#7C5CFF);color:#fff;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;" onclick="markAdmin.testVoice()"><span class="material-symbols-outlined" style="font-size:20px;">play_arrow</span></button><span style="font-size:14px;color:#4B4F66;">Playing (Edge TTS)</span></div>`;
                toast('Playing Edge TTS voice!', 'success'); return;
            }
        } catch (e) { /* fallback */ }
        if ('speechSynthesis' in window) {
            const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
            if (previewContent) previewContent.innerHTML = `<span style="font-size:14px;color:#4B4F66;">Playing (browser fallback)</span>`;
            toast('Backend offline -- browser voice preview.', 'info');
        } else { toast('Voice preview not available.', 'error'); }
    }

    /* ================================================================
       TAB: AI CONFIG
       ================================================================ */
    function renderAITab(s) {
        const tempVal = s.temperature !== undefined ? s.temperature : 0.72;
        return `
        <div style="${T.glass}padding:40px;">
            <h2 style="${T.headline}font-size:24px;margin:0 0 32px;">Model Parameters</h2>
            <div style="display:flex;flex-direction:column;gap:32px;">
                <div><label style="${T.label}">Groq API Key</label>
                    <div style="position:relative;"><input id="s-groq-key" type="password" value="${esc(s.groq_api_key||'')}" placeholder="gsk_... (leave empty to use global key)" style="${T.input}" />
                    <span class="material-symbols-outlined" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#6B6F86;cursor:pointer;font-size:20px;" onclick="const i=document.getElementById('s-groq-key');i.type=i.type==='password'?'text':'password';">visibility_off</span></div>
                    <p style="font-size:12px;color:#6B6F86;margin:6px 0 0;">Get your free key at <a href="https://console.groq.com" target="_blank" style="color:#7C5CFF;font-weight:600;text-decoration:none;">console.groq.com</a></p></div>
                <div><label style="${T.label}">LLM Model</label><select id="s-llm-model" style="${T.select}">
                    <option value="llama-3.3-70b-versatile" ${s.llm_model==='llama-3.3-70b-versatile'?'selected':''}>Llama 3.3 70B Versatile</option>
                    <option value="llama-3.1-8b-instant" ${s.llm_model==='llama-3.1-8b-instant'?'selected':''}>Llama 3.1 8B Instant</option>
                    <option value="gemma2-9b-it" ${s.llm_model==='gemma2-9b-it'?'selected':''}>Gemma 2 9B</option>
                    <option value="mixtral-8x7b-32768" ${s.llm_model==='mixtral-8x7b-32768'?'selected':''}>Mixtral 8x7B</option>
                </select></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
                    <div><label style="${T.label}">Max Tokens</label><input id="s-max-tokens" type="number" value="${s.max_tokens||150}" min="50" max="500" style="${T.input}" /></div>
                    <div><div style="display:flex;justify-content:space-between;margin-bottom:6px;"><label style="${T.label}margin-bottom:0;">Temperature</label><span id="temp-val" style="font-size:14px;font-weight:600;color:#7C5CFF;">${tempVal}</span></div>
                        <input type="range" id="s-temperature" min="0" max="1" step="0.01" value="${tempVal}" style="width:100%;height:4px;border-radius:2px;background:#c2c7ca;outline:none;-webkit-appearance:none;cursor:pointer;accent-color:#7C5CFF;" oninput="document.getElementById('temp-val').textContent=this.value" />
                        <p style="font-size:12px;color:#6B6F86;margin:6px 0 0;">Lower = focused, Higher = creative</p></div>
                </div>
                <div><label style="${T.label}">Custom System Prompt</label><textarea id="s-custom-prompt" rows="6" placeholder="You are an AI assistant..." style="${T.input}resize:vertical;min-height:120px;">${esc(s.custom_system_prompt||'')}</textarea><p style="font-size:12px;color:#6B6F86;margin:6px 0 0;">Advanced -- override Mark's entire personality.</p></div>
                <div style="padding-top:24px;border-top:1px solid rgba(194,199,202,0.3);display:flex;justify-content:flex-end;">
                    <button style="${T.btnPrimary}" onclick="markAdmin.saveAI()">Save AI Config</button>
                </div>
            </div>
        </div>`;
    }

    async function saveAI() {
        const maxTokens = parseInt($('#s-max-tokens').value);
        const temperature = parseFloat($('#s-temperature').value);

        // Validation
        if (isNaN(maxTokens) || maxTokens < 50 || maxTokens > 1000) {
            toast('Max tokens must be between 50 and 1000.', 'error'); return;
        }
        if (isNaN(temperature) || temperature < 0 || temperature > 2) {
            toast('Temperature must be between 0.0 and 2.0.', 'error'); return;
        }

        const data = {
            groq_api_key: $('#s-groq-key').value, llm_model: $('#s-llm-model').value,
            max_tokens: maxTokens, temperature: temperature,
            custom_system_prompt: $('#s-custom-prompt').value,
        };
        try { await api('PUT', 'stores/' + currentStore.store_id, data); currentStore = { ...currentStore, ...data }; toast('AI configuration saved!', 'success'); }
        catch (e) { toast(e.message, 'error'); }
    }

    /* ================================================================
       TAB: CONVERSATIONS
       ================================================================ */
    function renderConvoCard(c) {
        const when = c.created_at ? formatDate(c.created_at) : '';
        return `
        <div style="${T.glassLight}padding:16px 20px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px;flex-wrap:wrap;">
                <span style="display:flex;align-items:center;gap:8px;font-size:12px;color:#6B6F86;">
                    <span class="material-symbols-outlined" style="font-size:16px;color:#7C5CFF;">person</span>
                    Visitor ${esc((c.visitor_hash || '').substring(0, 8) || '—')}
                    <span style="${T.badgeActive}padding:1px 7px;font-size:10px;">${esc(c.language || 'en')}</span>
                </span>
                <span style="font-size:12px;color:#6B6F86;">${when}</span>
            </div>
            <div style="font-size:14px;line-height:1.5;color:#14152A;margin-bottom:6px;"><strong style="color:#7C5CFF;">Visitor:</strong> ${esc(c.last_user_msg || '—')}</div>
            <div style="font-size:14px;line-height:1.5;color:#4B4F66;"><strong style="color:#6B6F86;">Mark:</strong> ${esc(c.mark_response || '—')}</div>
        </div>`;
    }

    async function loadConversationsTab(storeId) {
        const container = $('#tab-content');
        container.innerHTML = robotLoader('Loading conversations...');
        try {
            // Read from the BACKEND log (where the live widget writes) via the
            // store token — the WP mirror is empty, which is why it showed 0.
            const settings = globalSettings || {};
            const backendUrl = settings.backend_url || (markAI || {}).backendUrl || 'https://mark-udfz.onrender.com';
            const token = settings.api_token || '';
            const remoteId = settings.remote_store_id || storeId;
            const resp = await fetch(backendUrl + '/api/stores/' + remoteId + '/conversations', {
                headers: { 'X-Store-Token': token }
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            const convos = data.recent || [];
            container.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px;margin-bottom:32px;">
                ${renderMiniStat('Total', data.total_conversations || 0, 'forum')}
                ${renderMiniStat('Today', data.today || 0, 'today')}
                ${renderMiniStat('This Week', data.this_week || 0, 'date_range')}
                ${renderMiniStat('Unique Visitors', data.unique_visitors || 0, 'person')}
            </div>
            <h3 style="${T.headline}font-size:20px;margin:0 0 16px;">Recent Conversations</h3>
            ${convos.length === 0
                ? `<div style="${T.glassLight}padding:40px;text-align:center;color:#6B6F86;font-size:14px;">No conversations yet — once visitors chat with Mark, each exchange appears here.</div>`
                : `<div style="display:flex;flex-direction:column;gap:12px;">${convos.map(renderConvoCard).join('')}</div>`}`;
        } catch (e) {
            container.innerHTML = `<div style="${T.glassLight}padding:40px;text-align:center;color:#6B6F86;font-size:14px;">Conversations unavailable — the backend may be waking up. Try again in a moment.</div>`;
        }
    }

    function copyCode(id) { const el = document.getElementById(id); if (!el) return; navigator.clipboard.writeText(el.textContent).then(() => toast('Copied!','success')).catch(() => { const ta = document.createElement('textarea'); ta.value = el.textContent; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); toast('Copied!','success'); }); }
    function copyText(text) { navigator.clipboard.writeText(text).then(() => toast('Copied!','success')).catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); toast('Copied!','success'); }); }

    /* ================================================================
       DELETE STORE
       ================================================================ */
    function confirmDelete() {
        const container = $('#mark-modal-container');
        container.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.3);backdrop-filter:blur(6px);z-index:99999;display:flex;align-items:center;justify-content:center;" onclick="markAdmin.closeModal(event)">
            <div style="background:#FFFFFF;border:1px solid rgba(239,68,68,0.3);border-radius:16px;padding:40px;width:90%;max-width:440px;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,0.5);" onclick="event.stopPropagation()">
                <span class="material-symbols-outlined" style="font-size:56px;color:#D83A52;margin-bottom:16px;">warning</span>
                <h2 style="${T.headline}font-size:24px;color:#D83A52;margin:0 0 8px;">Delete Store?</h2>
                <p style="color:#4B4F66;font-size:14px;margin:0 0 28px;line-height:1.6;">This will permanently delete <strong>${esc(currentStore.store_name)}</strong> and all conversations.</p>
                <div style="display:flex;gap:12px;justify-content:center;">
                    <button style="${T.btnSecondary}" onclick="markAdmin.closeModal()">Cancel</button>
                    <button style="${T.btnDanger}" onclick="markAdmin.deleteStore()"><span class="material-symbols-outlined" style="font-size:18px;">delete_forever</span> Delete</button>
                </div>
            </div>
        </div>`;
    }

    async function deleteStore() {
        try {
            await api('DELETE', 'stores/' + currentStore.store_id);
            toast('"' + currentStore.store_name + '" deleted.', 'success');
            currentStore = null;
            closeModal();
            // Reload dashboard data to check if any stores remain
            const data = await api('GET', 'dashboard');
            stores = data.stores || [];
            if (stores.length === 0) {
                // No stores left — show onboarding so the user can create a new one
                const content = $('#mark-page-content');
                if (content) content.innerHTML = renderOnboarding();
            } else {
                navigate('dashboard');
            }
        } catch (e) { toast(e.message, 'error'); }
    }

    /* ================================================================
       PAGE: CONVERSATIONS (Direct — single store)
       ================================================================ */
    async function loadConversationsPage() {
        const content = $('#mark-page-content');
        try {
            const data = await api('GET', 'dashboard');
            stores = data.stores || [];
            const store = getMainStore();

            if (!store) {
                content.innerHTML = `<div style="text-align:center;padding:60px;"><h3 style="${T.headline}font-size:20px;">No store found</h3><p style="color:#4B4F66;">Set up your store first.</p></div>`;
                return;
            }

            const storeData = await api('GET', 'stores/' + store.store_id);
            currentStore = storeData.store || storeData;

            content.innerHTML = `
            <div style="margin-bottom:32px;">
                <h1 style="${T.headline}font-size:48px;line-height:56px;letter-spacing:-0.02em;font-weight:300;margin:0 0 8px;">Conversations</h1>
                <p style="color:#4B4F66;font-size:18px;margin:0;">${esc(currentStore.store_name)} -- recent customer interactions.</p>
            </div>
            <div id="tab-content"></div>`;

            loadConversationsTab(currentStore.store_id);
        } catch (e) { content.innerHTML = `<p style="color:#6B6F86;text-align:center;padding:60px;">${esc(e.message)}</p>`; }
    }

    /* ================================================================
       PAGE: SETTINGS (Global)
       ================================================================ */
    async function loadSettingsPage() {
        const content = $('#mark-page-content');
        try {
            globalSettings = await api('GET', 'settings');
            const s = globalSettings;
            content.innerHTML = `
            <div style="margin-bottom:40px;">
                <h1 style="${T.headline}font-size:48px;line-height:56px;letter-spacing:-0.02em;font-weight:300;margin:0 0 8px;">Settings</h1>
                <p style="color:#4B4F66;font-size:18px;margin:0;">Global configuration for Mark AI.</p>
            </div>
            <div style="${T.glass}padding:32px;margin-bottom:24px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;"><span class="material-symbols-outlined" style="font-size:20px;color:#6B6F86;">key</span><h3 style="${T.headline}font-size:24px;margin:0;">API Keys</h3></div>
                <div style="max-width:600px;"><label style="${T.label}">Groq API Key (Global Default)</label>
                    <div style="position:relative;"><input id="g-groq-key" type="password" value="${esc(s.groq_api_key||'')}" placeholder="gsk_..." style="${T.input}" />
                    <span class="material-symbols-outlined" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#6B6F86;cursor:pointer;font-size:20px;" onclick="const i=document.getElementById('g-groq-key');i.type=i.type==='password'?'text':'password';">visibility_off</span></div>
                    <p style="font-size:12px;color:#6B6F86;margin:8px 0 0;">Get one free at <a href="https://console.groq.com" target="_blank" style="color:#7C5CFF;font-weight:600;text-decoration:none;">console.groq.com</a></p>
                </div>
            </div>
            <div style="${T.glass}padding:32px;margin-bottom:24px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;"><span class="material-symbols-outlined" style="font-size:20px;color:#6B6F86;">record_voice_over</span><h3 style="${T.headline}font-size:24px;margin:0;">Default Voice (Edge TTS)</h3></div>
                <div style="max-width:300px;"><label style="${T.label}">English Voice</label><select id="g-voice-en" style="${T.select}">
                    <option value="en-US-GuyNeural" ${s.default_voice==='en-US-GuyNeural'?'selected':''}>Guy (Male)</option>
                    <option value="en-US-AriaNeural" ${s.default_voice==='en-US-AriaNeural'?'selected':''}>Aria (Female)</option>
                    <option value="en-US-DavisNeural" ${s.default_voice==='en-US-DavisNeural'?'selected':''}>Davis (Male)</option>
                    <option value="en-US-JennyNeural" ${s.default_voice==='en-US-JennyNeural'?'selected':''}>Jenny (Female)</option>
                </select></div>
            </div>
            <div style="${T.glass}padding:32px;margin-bottom:24px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;"><span class="material-symbols-outlined" style="font-size:20px;color:#6B6F86;">widgets</span><h3 style="${T.headline}font-size:24px;margin:0;">Widget Settings</h3></div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:24px;max-width:800px;">
                    <div><label style="${T.label}">Widget Enabled</label><select id="g-widget-enabled" style="${T.select}"><option value="1" ${s.widget_enabled!==false&&s.widget_enabled!=='0'?'selected':''}>Yes</option><option value="0" ${s.widget_enabled===false||s.widget_enabled==='0'?'selected':''}>No</option></select></div>
                    <div><label style="${T.label}">Position</label><select id="g-widget-position" style="${T.select}"><option value="bottom-right" ${s.widget_position==='bottom-right'||!s.widget_position?'selected':''}>Bottom Right</option><option value="bottom-left" ${s.widget_position==='bottom-left'?'selected':''}>Bottom Left</option></select></div>
                    <div><label style="${T.label}">Auto Greet</label><select id="g-auto-greet" style="${T.select}"><option value="1" ${s.auto_greet!==false&&s.auto_greet!=='0'?'selected':''}>Yes</option><option value="0" ${s.auto_greet===false||s.auto_greet==='0'?'selected':''}>No</option></select></div>
                    <div><label style="${T.label}">Accent Color</label>
                        <div style="display:flex;align-items:center;gap:10px;">
                            <input type="color" id="g-accent-color" value="${esc(s.widget_accent_color || '#7C5CFF')}" style="width:44px;height:44px;border:2px solid #c2c7ca;border-radius:8px;cursor:pointer;padding:2px;background:none;"
                                oninput="document.getElementById('g-accent-hex').value=this.value;" />
                            <input type="text" id="g-accent-hex" value="${esc(s.widget_accent_color || '#7C5CFF')}" maxlength="7" style="${T.input}width:90px;padding:10px;font-family:monospace;font-size:13px;"
                                oninput="const c=document.getElementById('g-accent-color');if(/^#[0-9a-fA-F]{6}$/.test(this.value))c.value=this.value;" />
                        </div>
                        <p style="font-size:11px;color:#6B6F86;margin:4px 0 0;">Chat bubble & robot glow color</p>
                    </div>
                    <div><label style="${T.label}">Greeting Sound</label>
                        <input type="text" id="g-greeting-sound" value="${esc(s.greeting_sound_text || 'Ayie!')}" maxlength="30" style="${T.input}" placeholder="Ayie!" />
                        <p style="font-size:11px;color:#6B6F86;margin:4px 0 0;">What Mark says when clicked</p>
                    </div>
                    <div><label style="${T.label}">Name Celebration Text</label>
                        <input type="text" id="g-celebrate-text" value="${esc(s.name_celebrate_text || 'Welcome')}" maxlength="30" style="${T.input}" placeholder="Welcome" />
                        <p style="font-size:11px;color:#6B6F86;margin:4px 0 0;">Shown above the visitor's name on first introduction</p>
                    </div>
                    <div><label style="${T.label}">Auto-Hide Delay</label>
                        <input type="number" id="g-idle-timeout" value="${s.idle_timeout || 60}" min="15" max="600" style="${T.input}" />
                        <p style="font-size:11px;color:#6B6F86;margin:4px 0 0;">Seconds before Mark closes chat (15-600)</p>
                    </div>
                </div>
            </div>
            <div style="${T.glass}padding:32px;margin-bottom:32px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span class="material-symbols-outlined" style="font-size:20px;color:#6B6F86;">visibility</span><h3 style="${T.headline}font-size:24px;margin:0;">Where Mark Appears</h3></div>
                <p style="color:#4B4F66;font-size:14px;margin:0 0 20px;">Choose which pages Mark shows on. (Mark never appears in the WordPress or page-builder editor.)</p>
                <div style="max-width:380px;margin-bottom:20px;">
                    <label style="${T.label}">Show Mark on</label>
                    <select id="g-display-mode" onchange="markAdmin.toggleDisplayPages()" style="${T.select}">
                        <option value="all" ${(s.widget_display_mode||'all')==='all'?'selected':''}>All pages</option>
                        <option value="include" ${s.widget_display_mode==='include'?'selected':''}>Only selected pages</option>
                        <option value="exclude" ${s.widget_display_mode==='exclude'?'selected':''}>All pages except selected</option>
                    </select>
                </div>
                <div id="g-display-pages-wrap" style="display:${(s.widget_display_mode||'all')==='all'?'none':'block'};">
                    <label style="${T.label}">Select pages</label>
                    <div style="max-height:260px;overflow:auto;border:1px solid rgba(194,199,202,0.4);border-radius:10px;padding:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px;">
                        ${(s.available_pages||[]).length === 0
                            ? '<p style="color:#6B6F86;font-size:13px;padding:8px;">No pages found yet — publish pages on your site, then refresh.</p>'
                            : (s.available_pages||[]).map(p => `
                            <label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:5px 8px;border-radius:6px;cursor:pointer;" onmouseenter="this.style.background='rgba(124,92,255,0.06)'" onmouseleave="this.style.background='transparent'">
                                <input type="checkbox" class="g-display-page" value="${p.id}" ${(s.widget_display_pages||[]).includes(p.id)?'checked':''} style="accent-color:#7C5CFF;width:15px;height:15px;flex-shrink:0;">
                                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.title)} <span style="color:#6B6F86;font-size:11px;">(${esc(p.type)})</span></span>
                            </label>`).join('')}
                    </div>
                </div>
            </div>
            <div style="${T.glass}padding:32px;margin-bottom:32px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;"><span class="material-symbols-outlined" style="font-size:20px;color:#6B6F86;">cable</span><h3 style="${T.headline}font-size:24px;margin:0;">Connection Test</h3></div>
                <p style="color:#4B4F66;font-size:14px;margin:0 0 16px;">Verify your Groq API key is working.</p>
                <button style="${T.btnSecondary}" onclick="markAdmin.testConnection()" id="test-conn-btn"><span class="material-symbols-outlined" style="font-size:18px;">power</span> Test Groq Connection</button>
                <div id="conn-test-result" style="margin-top:12px;"></div>
            </div>
            <button style="${T.btnPrimary}padding:14px 32px;" onclick="markAdmin.saveGlobalSettings()">Save All Settings</button>`;
        } catch (e) {
            content.innerHTML = `<div style="text-align:center;padding:60px;color:#6B6F86;"><span class="material-symbols-outlined" style="font-size:48px;opacity:0.3;">error</span><p style="margin:16px 0;">${esc(e.message)}</p>
            <button style="${T.btnSecondary}" onclick="markAdmin.navigate('settings')"><span class="material-symbols-outlined" style="font-size:18px;">refresh</span> Retry</button></div>`;
        }
    }

    async function saveGlobalSettings() {
        const accentColor = ($('#g-accent-hex') || {}).value?.trim() || '#7C5CFF';
        const data = {
            groq_api_key: $('#g-groq-key').value.trim(),
            default_voice: $('#g-voice-en').value,
            widget_enabled: $('#g-widget-enabled').value,
            widget_position: $('#g-widget-position').value,
            auto_greet: $('#g-auto-greet').value,
            widget_accent_color: /^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : '#7C5CFF',
            greeting_sound_text: ($('#g-greeting-sound') || {}).value?.trim() || 'Ayie!',
            name_celebrate_text: ($('#g-celebrate-text') || {}).value?.trim() || 'Welcome',
            idle_timeout: Math.max(15, Math.min(600, parseInt(($('#g-idle-timeout') || {}).value) || 60)),
            widget_display_mode: ($('#g-display-mode') || {}).value || 'all',
            widget_display_pages: Array.from(document.querySelectorAll('.g-display-page:checked')).map(c => parseInt(c.value, 10)),
        };
        try {
            await api('POST', 'settings', data);
            globalSettings = { ...globalSettings, ...data };
            toast('Global settings saved!', 'success');
        } catch (e) { toast(e.message, 'error'); }
    }

    // Show/hide the page checklist based on the visibility mode.
    function toggleDisplayPages() {
        const mode = ($('#g-display-mode') || {}).value || 'all';
        const wrap = $('#g-display-pages-wrap');
        if (wrap) wrap.style.display = (mode === 'all') ? 'none' : 'block';
    }

    async function testConnection() {
        const btn = $('#test-conn-btn'), result = $('#conn-test-result');
        if (btn) btn.disabled = true;
        if (result) result.innerHTML = `<span style="color:#6B6F86;font-size:13px;display:flex;align-items:center;gap:8px;"><span class="material-symbols-outlined" style="display:inline-block;animation:markSpin 0.8s linear infinite;font-size:16px;color:#7C5CFF;">progress_activity</span> Testing connection...</span>`;
        try {
            const data = await api('POST', 'test-connection');
            if (data.connected) {
                result.innerHTML = `<div style="padding:12px 16px;background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.2);border-radius:8px;display:flex;align-items:center;gap:8px;">
                    <span class="material-symbols-outlined" style="font-size:18px;color:#16a34a;">check_circle</span>
                    <span style="color:#16a34a;font-size:13px;font-weight:600;">${esc(data.message)}</span>
                </div>`;
            } else {
                result.innerHTML = `<div style="padding:16px;background:rgba(186,26,26,0.05);border:1px solid rgba(186,26,26,0.15);border-radius:8px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                        <span class="material-symbols-outlined" style="font-size:18px;color:#D83A52;">error</span>
                        <span style="color:#D83A52;font-size:13px;font-weight:600;">${esc(data.error)}</span>
                    </div>
                    ${data.hint ? `<p style="font-size:12px;color:#4B4F66;margin:0;padding-left:26px;line-height:1.5;">
                        <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;color:#7C5CFF;">lightbulb</span>
                        <strong>Fix:</strong> ${esc(data.hint)}
                    </p>` : ''}
                </div>`;
            }
        } catch (e) {
            result.innerHTML = `<div style="padding:12px 16px;background:rgba(186,26,26,0.05);border:1px solid rgba(186,26,26,0.15);border-radius:8px;">
                <span style="color:#D83A52;font-size:13px;">${esc(e.message)}</span>
            </div>`;
        }
        if (btn) btn.disabled = false;
    }

    /* ================================================================
       MODAL HELPER
       ================================================================ */
    function closeModal(event) { if (event && event.target !== event.currentTarget) return; const c = $('#mark-modal-container'); if (c) c.innerHTML = ''; }

    /* ================================================================
       WELCOME DIALOG — Quick tips for first-time users
       ================================================================ */
    function startTour() {
        const container = $('#mark-modal-container');
        if (!container) return;
        container.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.4);backdrop-filter:blur(8px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;" onclick="markAdmin.closeModal(event)">
            <div style="background:#FFFFFF;border:1px solid rgba(124,92,255,0.18);border-radius:20px;width:90%;max-width:520px;padding:40px;box-shadow:0 24px 80px rgba(0,0,0,0.2);text-align:center;font-family:'Plus Jakarta Sans',sans-serif;" onclick="event.stopPropagation()">
                <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#7C5CFF,#7C5CFF);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">
                    <span class="material-symbols-outlined" style="color:white;font-size:32px;">rocket_launch</span>
                </div>
                <h2 style="${T.headline}font-size:24px;font-weight:600;margin:0 0 8px;">Welcome to Mark AI!</h2>
                <p style="color:#4B4F66;font-size:14px;margin:0 0 28px;line-height:1.6;">Here is a quick overview of your admin pages:</p>
                <div style="text-align:left;display:flex;flex-direction:column;gap:14px;margin-bottom:28px;">
                    <div style="display:flex;align-items:flex-start;gap:12px;">
                        <span class="material-symbols-outlined" style="font-size:22px;color:#7C5CFF;flex-shrink:0;margin-top:1px;">dashboard</span>
                        <div><strong style="font-size:14px;">Dashboard</strong><br/><span style="font-size:13px;color:#4B4F66;">Conversation trends, peak hours, and a quick store summary.</span></div>
                    </div>
                    <div style="display:flex;align-items:flex-start;gap:12px;">
                        <span class="material-symbols-outlined" style="font-size:22px;color:#7C5CFF;flex-shrink:0;margin-top:1px;">storefront</span>
                        <div><strong style="font-size:14px;">My Store</strong><br/><span style="font-size:13px;color:#4B4F66;">Robot name, personality, voice, sales skills, and AI config.</span></div>
                    </div>
                    <div style="display:flex;align-items:flex-start;gap:12px;">
                        <span class="material-symbols-outlined" style="font-size:22px;color:#7C5CFF;flex-shrink:0;margin-top:1px;">chat</span>
                        <div><strong style="font-size:14px;">Conversations</strong><br/><span style="font-size:13px;color:#4B4F66;">All chat logs between Mark and your visitors.</span></div>
                    </div>
                    <div style="display:flex;align-items:flex-start;gap:12px;">
                        <span class="material-symbols-outlined" style="font-size:22px;color:#7C5CFF;flex-shrink:0;margin-top:1px;">settings</span>
                        <div><strong style="font-size:14px;">Settings</strong><br/><span style="font-size:13px;color:#4B4F66;">API key, widget color, position, greeting sound, and connection test.</span></div>
                    </div>
                </div>
                <button style="${T.btnPrimary}padding:12px 32px;" onclick="markAdmin.endTour()">Got it!</button>
            </div>
        </div>`;
    }

    function endTour() {
        try { localStorage.setItem('mark_ai_tour_complete', '1'); } catch(_) {}
        closeModal();
    }

    /* ================================================================
       PUBLIC API
       ================================================================ */
    window.markAdmin = {
        navigate, openStore, switchTab,
        saveStoreSettings, saveSalesSettings, saveVoice, testVoice, saveAI,
        saveTraining, syncProducts,
        confirmDelete, deleteStore,
        copyCode, copyText, closeModal,
        saveGlobalSettings, testConnection, toggleDisplayPages,
        completeSetup, showPreview,
        startTour, endTour,
        updateSizePreview,
        trainPlaybook, toggleLearning,
    };

    /* ================================================================
       BOOT
       ================================================================ */
    function boot() { if ($('#mark-ai-app')) renderAppShell(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

})();
