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
       DESIGN TOKENS  — Celestial High-Key
       ================================================================ */
    const T = {
        pageBg: `background-color:#f9f9f9;position:relative;`,
        glass: `background:rgba(255,255,255,0.4);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(179,229,252,0.3);box-shadow:0 8px 32px 0 rgba(0,100,255,0.05);border-radius:12px;position:relative;overflow:hidden;`,
        glassLight: `background:rgba(255,255,255,0.55);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(179,229,252,0.25);box-shadow:0 4px 16px 0 rgba(0,100,255,0.03);border-radius:12px;`,
        input: `background-color:rgba(255,255,255,0.6);border:1px solid #c2c7ca;color:#1a1c1c;padding:12px;font-family:'Open Sans',sans-serif;font-size:14px;width:100%;outline:none;border-radius:8px;transition:border-color 0.3s ease;`,
        select: `background-color:rgba(255,255,255,0.6);border:1px solid #c2c7ca;color:#1a1c1c;padding:12px;font-family:'Open Sans',sans-serif;font-size:14px;width:100%;outline:none;border-radius:8px;appearance:none;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2373787a' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;`,
        btnPrimary: `background:linear-gradient(135deg,#fc9b6c,#954921);color:#ffffff;border:none;border-radius:8px;padding:12px 24px;font-family:'Open Sans',sans-serif;font-weight:600;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all 0.3s;box-shadow:0 4px 15px rgba(149,73,33,0.25);letter-spacing:0.02em;`,
        btnSecondary: `background:rgba(79,97,105,0.08);color:#4f6169;border:1px solid rgba(79,97,105,0.2);border-radius:8px;padding:10px 20px;font-family:'Open Sans',sans-serif;font-weight:600;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all 0.2s;`,
        btnDanger: `background:rgba(186,26,26,0.08);color:#ba1a1a;border:1px solid rgba(186,26,26,0.2);border-radius:8px;padding:10px 20px;font-family:'Open Sans',sans-serif;font-weight:600;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all 0.2s;`,
        label: `display:block;font-family:'Open Sans',sans-serif;font-size:14px;font-weight:600;color:#42484a;margin-bottom:6px;letter-spacing:0.05em;line-height:1;`,
        statValue: `font-family:'Open Sans',sans-serif;font-size:48px;font-weight:300;line-height:1.1;letter-spacing:-0.02em;color:#1a1c1c;`,
        headline: `font-family:'Open Sans',sans-serif;font-weight:400;color:#1a1c1c;`,
        muted: `color:#42484a;font-size:13px;`,
        cardHoverShadow: '0 12px 40px rgba(0,100,255,0.1)',
        cardHoverBorder: 'rgba(179,229,252,0.6)',
        badgeActive: `display:inline-flex;align-items:center;gap:6px;padding:4px 12px;font-size:12px;font-weight:600;border-radius:9999px;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.3);color:#16a34a;font-family:'Open Sans',sans-serif;`,
        badgeInactive: `display:inline-flex;align-items:center;gap:6px;padding:4px 12px;font-size:12px;font-weight:600;border-radius:9999px;background:rgba(100,116,139,0.08);border:1px solid rgba(100,116,139,0.2);color:#64748b;font-family:'Open Sans',sans-serif;`,
        tabBtn: `padding:12px 24px;font-family:'Open Sans',sans-serif;font-size:16px;font-weight:400;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;transition:all 0.2s;white-space:nowrap;color:#73787a;`,
        tabBtnActive: `padding:12px 24px;font-family:'Open Sans',sans-serif;font-size:16px;font-weight:600;background:none;border:none;border-bottom:2px solid #4f6169;cursor:pointer;transition:all 0.2s;white-space:nowrap;color:#4f6169;`,
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
            error:   { bg: 'rgba(186,26,26,0.1)', border: 'rgba(186,26,26,0.25)', text: '#ba1a1a', icon: 'error' },
            info:    { bg: 'rgba(79,97,105,0.1)', border: 'rgba(79,97,105,0.25)', text: '#4f6169', icon: 'info' },
        };
        const c = colors[type] || colors.info;

        const el = document.createElement('div');
        el.className = 'mark-ai-toast';
        el.style.cssText = `position:fixed;top:40px;right:20px;z-index:999999;min-width:320px;padding:16px 20px;border-radius:12px;font-family:'Open Sans',sans-serif;font-size:14px;backdrop-filter:blur(16px);border:1px solid ${c.border};background:${c.bg};color:${c.text};transform:translateX(120%);transition:transform 0.4s cubic-bezier(0.4,0,0.2,1);display:flex;align-items:center;gap:10px;`;
        el.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px;">${c.icon}</span><span>${esc(message)}</span>`;
        document.body.appendChild(el);
        requestAnimationFrame(() => { el.style.transform = 'translateX(0)'; });
        setTimeout(() => { el.style.transform = 'translateX(120%)'; setTimeout(() => el.remove(), 400); }, 3500);
    }

    /* ================================================================
       SKELETON + KEYFRAMES
       ================================================================ */
    function skeleton(height = '200px') {
        return `<div style="height:${height};border-radius:12px;background:linear-gradient(90deg,#eeeeee 25%,#e2e2e2 50%,#eeeeee 75%);background-size:200% 100%;animation:markShimmer 1.5s infinite;"></div>`;
    }

    /** Cute robot head loader — replaces boring spinners */
    function robotLoader(text = 'Loading...', size = 32) {
        return `<div style="display:flex;align-items:center;gap:12px;color:#4f6169;padding:40px;">
            <div style="animation:markRobotBob 1s ease-in-out infinite;">
                <svg width="${size}" height="${size}" viewBox="0 0 20 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <line x1="10" y1="0.5" x2="10" y2="3" stroke="#954921" stroke-width="1" stroke-linecap="round"/>
                    <circle cx="10" cy="0.5" r="0.8" fill="#fc9b6c"/>
                    <rect x="3" y="3" width="14" height="10" rx="3" fill="#954921"/>
                    <circle cx="7" cy="7.5" r="2" fill="white"/>
                    <circle cx="13" cy="7.5" r="2" fill="white"/>
                    <circle cx="7" cy="7.5" r="0.9" fill="#1a1a1a"/>
                    <circle cx="13" cy="7.5" r="0.9" fill="#1a1a1a"/>
                    <path d="M7.5 10.5 Q10 12.5 12.5 10.5" stroke="#fc9b6c" stroke-width="0.7" fill="none" stroke-linecap="round"/>
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
            .mark-ai-app-root input:focus,.mark-ai-app-root textarea:focus,.mark-ai-app-root select:focus {
                border-color:#4f6169 !important;box-shadow:0 0 0 2px rgba(79,97,105,0.15) !important;outline:none !important;
            }
            .mark-ai-app-root select option { background:#ffffff;color:#1a1c1c; }
            #mark-ai-app .mark-ai-app-root { margin:0 !important; }
            .mark-orb-mars { position:absolute;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(252,155,108,0.15) 0%,transparent 70%);filter:blur(40px);top:-150px;right:-100px;pointer-events:none;z-index:0; }
            .mark-orb-saturn { position:absolute;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(231,196,51,0.1) 0%,transparent 70%);filter:blur(40px);bottom:-200px;left:-150px;pointer-events:none;z-index:0; }
        `;
        document.head.appendChild(style);
    }

    /* ================================================================
       RENDER: APP SHELL
       ================================================================ */
    function renderAppShell() {
        injectKeyframes();
        const app = $('#mark-ai-app');
        if (!app) return;

        const pageMap = { 'mark-ai': 'dashboard', 'mark-ai-stores': 'store', 'mark-ai-conversations': 'conversations', 'mark-ai-settings': 'settings' };
        currentPage = pageMap[PAGE] || 'dashboard';

        app.innerHTML = `
        <div class="mark-ai-app-root" style="${T.pageBg}min-height:500px;padding:0;font-family:'Open Sans',sans-serif;color:#1a1c1c;-webkit-font-smoothing:antialiased;border-radius:8px;overflow:hidden;">
            <div class="mark-orb-mars"></div>
            <div class="mark-orb-saturn"></div>
            <div style="padding:32px 32px;max-width:1200px;position:relative;z-index:1;" id="mark-page-content">
                ${skeleton('200px')}<div style="margin-top:16px;">${skeleton('300px')}</div>
            </div>
            <div id="mark-modal-container"></div>
        </div>`;

        navigate(currentPage);
    }

    /* ================================================================
       SPA NAVIGATION
       ================================================================ */
    function navigate(page) {
        currentPage = page;
        switch (page) {
            case 'store':         loadStorePage(); break;
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
        <div style="${T.glass}padding:32px;min-height:160px;display:flex;flex-direction:column;justify-content:space-between;transition:all 0.3s ease;"
             onmouseenter="this.style.boxShadow='${T.cardHoverShadow}';this.style.transform='translateY(-2px)'"
             onmouseleave="this.style.boxShadow='0 8px 32px 0 rgba(0,100,255,0.05)';this.style.transform='translateY(0)'">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
                <span style="${T.label}margin-bottom:0;text-transform:uppercase;letter-spacing:0.08em;font-size:12px;">${esc(label)}</span>
                <span class="material-symbols-outlined" style="color:#4f6169;font-size:24px;">${icon}</span>
            </div>
            <div style="${T.statValue}">${formatNum(value)}</div>
        </div>`;
    }

    function renderMiniStat(label, value, icon) {
        return `
        <div style="${T.glassLight}padding:20px;display:flex;flex-direction:column;justify-content:space-between;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
                <span style="${T.label}margin-bottom:0;text-transform:uppercase;letter-spacing:0.08em;font-size:12px;">${esc(label)}</span>
                <span class="material-symbols-outlined" style="color:#4f6169;font-size:16px;">${icon}</span>
            </div>
            <div style="font-family:'Open Sans',sans-serif;font-size:32px;font-weight:300;color:#1a1c1c;">${formatNum(value)}</div>
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
                    borderColor: '#954921',
                    backgroundColor: 'rgba(252,155,108,0.15)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#954921',
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
                        titleFont: { family: "'Open Sans', sans-serif", size: 12 },
                        bodyFont: { family: "'Open Sans', sans-serif", size: 13 },
                        padding: 12,
                        cornerRadius: 8,
                    },
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(194,199,202,0.15)' },
                        ticks: { font: { family: "'Open Sans', sans-serif", size: 11 }, color: '#73787a' },
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(194,199,202,0.15)' },
                        ticks: { font: { family: "'Open Sans', sans-serif", size: 11 }, color: '#73787a', stepSize: 1 },
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
                        return `rgba(149,73,33,${0.15 + intensity * 0.65})`;
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
                        titleFont: { family: "'Open Sans', sans-serif", size: 12 },
                        bodyFont: { family: "'Open Sans', sans-serif", size: 13 },
                        padding: 12,
                        cornerRadius: 8,
                    },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { family: "'Open Sans', sans-serif", size: 10 }, color: '#73787a', maxRotation: 0 },
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(194,199,202,0.15)' },
                        ticks: { font: { family: "'Open Sans', sans-serif", size: 11 }, color: '#73787a', stepSize: 1 },
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
            <div style="background:#ffffff;border-radius:20px;width:90%;max-width:900px;max-height:90vh;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.2);" onclick="event.stopPropagation()">
                <!-- Header -->
                <div style="padding:24px 32px;border-bottom:1px solid rgba(194,199,202,0.3);display:flex;align-items:center;justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <span class="material-symbols-outlined" style="font-size:24px;color:#954921;">visibility</span>
                        <h2 style="${T.headline}font-size:20px;font-weight:600;margin:0;">Widget Preview</h2>
                    </div>
                    <button style="background:none;border:none;cursor:pointer;padding:8px;" onclick="markAdmin.closeModal()">
                        <span class="material-symbols-outlined" style="font-size:24px;color:#73787a;">close</span>
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
                            <div style="flex:1;background:#fff;border-radius:6px;padding:4px 12px;font-size:12px;color:#73787a;font-family:monospace;">${esc(store?.website_url || 'yourstore.com')}</div>
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
                            <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#fc9b6c,#954921);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(149,73,33,0.4);cursor:pointer;animation:markPulse 3s ease-in-out infinite;">
                                <span class="material-symbols-outlined" style="font-size:32px;color:#fff;">smart_toy</span>
                            </div>
                        </div>
                        <!-- Chat bubble simulation -->
                        <div style="position:absolute;bottom:92px;right:16px;width:280px;background:#fff;border-radius:16px 16px 4px 16px;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,0.12);font-family:'Open Sans',sans-serif;font-size:14px;color:#1a1c1c;line-height:1.5;">
                            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                                <div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#fc9b6c,#954921);display:flex;align-items:center;justify-content:center;">
                                    <span class="material-symbols-outlined" style="font-size:14px;color:#fff;">smart_toy</span>
                                </div>
                                <strong style="font-size:13px;color:#954921;">${esc(name)}</strong>
                            </div>
                            ${esc(greeting)}
                        </div>
                    </div>
                    <!-- Info Panel -->
                    <div style="width:240px;display:flex;flex-direction:column;gap:16px;">
                        <div style="${T.glassLight}padding:20px;">
                            <h4 style="${T.headline}font-size:14px;font-weight:600;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.08em;">Current Config</h4>
                            <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;color:#42484a;">
                                <div><strong>Name:</strong> ${esc(name)}</div>
                                <div><strong>Style:</strong> ${esc(personality)}</div>
                                <div><strong>Position:</strong> ${esc(globalSettings.widget_position || 'bottom-right')}</div>
                                <div><strong>Auto Greet:</strong> ${globalSettings.auto_greet !== false && globalSettings.auto_greet !== '0' ? 'Yes' : 'No'}</div>
                            </div>
                        </div>
                        <div style="padding:16px;background:rgba(252,155,108,0.08);border-radius:12px;border:1px solid rgba(252,155,108,0.2);">
                            <p style="font-size:12px;color:#954921;margin:0;line-height:1.6;">
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
            <!-- Welcome Header with Robot GIF -->
            <div style="margin-bottom:48px;">
                <div style="width:180px;height:180px;border-radius:50%;overflow:hidden;margin:0 auto 24px;box-shadow:0 8px 40px rgba(149,73,33,0.35);border:4px solid rgba(252,155,108,0.3);">
                    <img src="${markAI.pluginUrl}assets/mark-welcome.gif" alt="Mark Robot" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<div style=\\'width:100%;height:100%;background:linear-gradient(135deg,#fc9b6c,#954921);display:flex;align-items:center;justify-content:center;\\'><svg width=80 height=80 viewBox=\\'0 0 20 20\\' fill=\\'none\\'><line x1=10 y1=1 x2=10 y2=3.5 stroke=white stroke-width=1.2 stroke-linecap=round/><circle cx=10 cy=1 r=1 fill=white/><rect x=3.5 y=3.5 width=13 height=9 rx=3 fill=white opacity=0.9/><circle cx=7.2 cy=8 r=1.8 fill=#954921/><circle cx=12.8 cy=8 r=1.8 fill=#954921/><path d=\\'M7.5 10.5 Q10 12.5 12.5 10.5\\' stroke=#954921 stroke-width=0.8 fill=none stroke-linecap=round/></svg></div>';" />
                </div>
                <h1 style="${T.headline}font-size:36px;font-weight:300;letter-spacing:-0.02em;margin:0 0 12px;">Welcome to Mark AI</h1>
                <p style="color:#42484a;font-size:18px;line-height:1.6;margin:0;">
                    Meet your AI robot assistant! Let's set it up in under 2 minutes.
                </p>
            </div>

            <!-- Step: API Key -->
            <div style="${T.glass}padding:40px;text-align:left;margin-bottom:24px;">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
                    <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#fc9b6c,#954921);display:flex;align-items:center;justify-content:center;">
                        <span style="color:#fff;font-weight:600;font-size:14px;">1</span>
                    </div>
                    <h3 style="${T.headline}font-size:20px;font-weight:600;margin:0;">Connect your AI</h3>
                </div>
                <p style="color:#42484a;font-size:14px;margin:0 0 20px;line-height:1.6;">
                    Mark uses <strong>Groq</strong> for blazing-fast AI responses. It's free — just grab an API key:
                </p>
                <ol style="color:#42484a;font-size:14px;line-height:2;margin:0 0 20px;padding-left:20px;">
                    <li>Go to <a href="https://console.groq.com" target="_blank" style="color:#954921;font-weight:600;text-decoration:none;">console.groq.com</a></li>
                    <li>Sign up (free) and create an API key</li>
                    <li>Paste it below</li>
                </ol>
                <div>
                    <label style="${T.label}">Groq API Key</label>
                    <div style="position:relative;">
                        <input id="onboard-key" type="password" placeholder="gsk_..." style="${T.input}" />
                        <span class="material-symbols-outlined" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#73787a;cursor:pointer;font-size:20px;"
                              onclick="const i=document.getElementById('onboard-key');i.type=i.type==='password'?'text':'password';">visibility_off</span>
                    </div>
                </div>
            </div>

            <!-- Step: Customize -->
            <div style="${T.glass}padding:40px;text-align:left;margin-bottom:32px;">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
                    <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#fc9b6c,#954921);display:flex;align-items:center;justify-content:center;">
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
                    onmouseenter="this.style.boxShadow='0 6px 20px rgba(149,73,33,0.4)';this.style.transform='translateY(-2px)'"
                    onmouseleave="this.style.boxShadow='0 4px 15px rgba(149,73,33,0.25)';this.style.transform='translateY(0)'">
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

            // Reload dashboard
            navigate('dashboard');
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
                    <h1 style="${T.headline}font-size:48px;line-height:56px;letter-spacing:-0.02em;font-weight:300;margin:0 0 8px;">Overview</h1>
                    <p style="font-family:'Open Sans',sans-serif;font-size:18px;color:#42484a;line-height:1.6;margin:0;">Monitor your Mark AI performance.</p>
                </div>
                ${store ? `<button style="${T.btnSecondary}" onclick="markAdmin.showPreview()">
                    <span class="material-symbols-outlined" style="font-size:18px;">visibility</span> Preview Widget
                </button>` : ''}
            </div>

            <!-- Stats Grid -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;margin-bottom:40px;">
                ${renderStatCard('Total Conversations', dashboardStats.total_conversations, 'forum')}
                ${renderStatCard("Today's Chats", dashboardStats.today_conversations, 'chat')}
                ${renderStatCard('Active Stores', dashboardStats.active_stores, 'bolt')}
                ${renderStatCard('Total Stores', dashboardStats.total_stores, 'store')}
            </div>

            <!-- Charts Row -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:40px;" id="mark-charts-row">
                <div style="${T.glass}padding:24px;">
                    <h3 style="${T.headline}font-size:16px;font-weight:600;margin:0 0 16px;">
                        <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;margin-right:6px;color:#954921;">trending_up</span>
                        Conversation Trend (14 days)
                    </h3>
                    <div style="height:220px;position:relative;">
                        <canvas id="mark-chart-trend"></canvas>
                    </div>
                </div>
                <div style="${T.glass}padding:24px;">
                    <h3 style="${T.headline}font-size:16px;font-weight:600;margin:0 0 16px;">
                        <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;margin-right:6px;color:#954921;">schedule</span>
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
                        <p style="color:#42484a;font-size:14px;margin:0;">
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
                <span class="material-symbols-outlined" style="font-size:48px;color:#4f6169;opacity:0.5;margin-bottom:12px;">storefront</span>
                <h3 style="${T.headline}font-size:20px;margin:0 0 8px;">No store configured</h3>
                <p style="color:#42484a;font-size:14px;margin:0;">Go to <strong>My Store</strong> in the sidebar to set up your store.</p>
            </div>`}
            `;

            // Load charts async (non-blocking)
            loadDashboardCharts();
        } catch (e) {
            content.innerHTML = `
            <div style="text-align:center;padding:80px 20px;">
                <span class="material-symbols-outlined" style="font-size:64px;color:rgba(186,26,26,0.3);">error</span>
                <h3 style="${T.headline}font-size:20px;margin:16px 0 8px;">Failed to load dashboard</h3>
                <p style="color:#42484a;font-size:14px;margin:0 0 20px;">${esc(e.message)}</p>
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
                    <h3 style="${T.headline}font-size:20px;">No store found</h3>
                    <p style="color:#42484a;">Deactivate and reactivate the plugin to auto-create your store.</p>
                </div>`;
                return;
            }

            const storeData = await api('GET', 'stores/' + store.store_id);
            currentStore = storeData.store || storeData;
            activeTab = 'settings';
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

        content.innerHTML = `
        <!-- Store Header -->
        <div style="margin-bottom:40px;">
            <h2 style="${T.headline}font-size:48px;line-height:56px;letter-spacing:-0.02em;font-weight:300;margin:0 0 4px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                ${esc(s.store_name)}
                ${renderBadge(s.is_active)}
            </h2>
            <a style="font-size:16px;color:#42484a;text-decoration:none;display:inline-flex;align-items:center;gap:4px;"
               href="${esc(s.website_url)}" target="_blank"
               onmouseenter="this.style.color='#4f6169'" onmouseleave="this.style.color='#42484a'">
                ${esc(s.website_url)}
                <span class="material-symbols-outlined" style="font-size:16px;">open_in_new</span>
            </a>
        </div>

        <!-- Analytics Mini Cards -->
        <div id="store-analytics" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:24px;margin-bottom:64px;">
            ${renderMiniStat('Total Chats', '--', 'forum')}
            ${renderMiniStat('Today', '--', 'today')}
            ${renderMiniStat('This Week', '--', 'date_range')}
            ${renderMiniStat('Unique Visitors', '--', 'person')}
        </div>

        <!-- Tab Navigation -->
        <div style="border-bottom:1px solid rgba(194,199,202,0.3);margin-bottom:40px;display:flex;gap:0;overflow-x:auto;" id="store-tabs">
            ${['settings','voice','ai','conversations','embed'].map(tab => {
                const labels = { settings:'Settings', voice:'Voice', ai:'AI Config', conversations:'Conversations', embed:'Embed Code' };
                const isActive = tab === activeTab;
                return `<button data-tab="${tab}" style="${isActive ? T.tabBtnActive : T.tabBtn}"
                    onclick="markAdmin.switchTab('${tab}')"
                    onmouseenter="if(!this.dataset.active)this.style.color='#4f6169'"
                    onmouseleave="if(!this.dataset.active)this.style.color='#73787a'"
                    ${isActive ? 'data-active="1"' : ''}>${labels[tab]}</button>`;
            }).join('')}
        </div>

        <div id="tab-content"></div>

        <!-- Danger Zone -->
        <div style="margin-top:64px;padding:24px;border:1px solid rgba(186,26,26,0.2);border-radius:12px;background:rgba(255,218,214,0.1);">
            <h3 style="${T.headline}font-size:20px;color:#ba1a1a;margin:0 0 8px;">Danger Zone</h3>
            <p style="color:#42484a;font-size:14px;margin:0 0 16px;">Permanently delete this store and all its data.</p>
            <button style="${T.btnDanger}" onclick="markAdmin.confirmDelete()">
                <span class="material-symbols-outlined" style="font-size:18px;">delete_forever</span> Delete Store
            </button>
        </div>`;

        loadStoreAnalytics(s.store_id);
        switchTab(activeTab);
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
        $$('#store-tabs button').forEach(btn => {
            const isActive = btn.dataset.tab === tab;
            btn.style.cssText = isActive ? T.tabBtnActive : T.tabBtn;
            if (isActive) btn.dataset.active = '1'; else delete btn.dataset.active;
        });

        const container = $('#tab-content');
        if (!container) return;
        const s = currentStore;
        switch (tab) {
            case 'settings':      container.innerHTML = renderSettingsTab(s); break;
            case 'voice':         container.innerHTML = renderVoiceTab(s); break;
            case 'ai':            container.innerHTML = renderAITab(s); break;
            case 'conversations': loadConversationsTab(s.store_id); break;
            case 'embed':         loadEmbedTab(s.store_id); break;
        }
    }

    /* ================================================================
       TAB: SETTINGS
       ================================================================ */
    function renderSettingsTab(s) {
        return `
        <div style="${T.glassLight}padding:40px;">
            <form style="display:flex;flex-direction:column;gap:40px;" onsubmit="event.preventDefault();markAdmin.saveStoreSettings();">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
                    <div><label style="${T.label}">Store Name</label><input id="s-store-name" type="text" value="${esc(s.store_name)}" style="${T.input}" /></div>
                    <div><label style="${T.label}">Website URL</label><input id="s-website-url" type="url" value="${esc(s.website_url)}" style="${T.input}" /></div>
                    <div><label style="${T.label}">Assistant Name</label><input id="s-assistant-name" type="text" value="${esc(s.assistant_name || 'Mark')}" style="${T.input}" /><span style="font-size:13px;color:#73787a;margin-top:4px;">What should the AI call itself?</span></div>
                    <div><label style="${T.label}">Personality</label><select id="s-personality" style="${T.select}"><option value="professional" ${s.personality==='professional'?'selected':''}>Professional & Precise</option><option value="friendly" ${s.personality==='friendly'?'selected':''}>Friendly & Approachable</option><option value="playful" ${s.personality==='playful'?'selected':''}>Playful & Witty</option></select></div>
                    <div><label style="${T.label}">Primary Language</label><select id="s-primary-lang" style="${T.select}"><option value="en" selected>English</option></select></div>
                    <div><label style="${T.label}">Idle Timeout (Seconds)</label><input id="s-idle-timeout" type="number" value="${s.idle_timeout||300}" style="${T.input}" /></div>
                    <div><label style="${T.label}">Max Crawl Pages</label><input id="s-max-crawl" type="number" value="${s.max_crawl_pages||120}" style="${T.input}" /></div>
                    <div><label style="${T.label}">Status</label><select id="s-is-active" style="${T.select}"><option value="1" ${s.is_active?'selected':''}>Active (Deployed)</option><option value="0" ${!s.is_active?'selected':''}>Inactive (Maintenance)</option></select></div>
                </div>
                <div style="padding-top:24px;border-top:1px solid rgba(194,199,202,0.3);display:flex;justify-content:flex-end;">
                    <button type="submit" style="${T.btnPrimary}">Save Settings</button>
                </div>
            </form>
        </div>`;
    }

    async function saveStoreSettings() {
        const data = {
            store_name: $('#s-store-name').value, website_url: $('#s-website-url').value,
            assistant_name: $('#s-assistant-name').value, personality: $('#s-personality').value,
            primary_language: $('#s-primary-lang').value, is_active: $('#s-is-active').value === '1',
            max_crawl_pages: parseInt($('#s-max-crawl').value) || 120, idle_timeout: parseInt($('#s-idle-timeout').value) || 300,
        };
        try {
            await api('PUT', 'stores/' + currentStore.store_id, data);
            currentStore = { ...currentStore, ...data };
            toast('Settings saved!', 'success');
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
                <p style="color:#42484a;font-size:14px;margin:0 0 32px;">Powered by <span style="color:#954921;font-weight:600;">Edge TTS</span> -- free, no API key needed.</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
                    <div><label style="${T.label}">English Voice</label><select id="s-tts-voice" style="${T.select}">
                        <option value="en-US-GuyNeural" ${s.tts_voice==='en-US-GuyNeural'?'selected':''}>Guy (Male, Warm)</option>
                        <option value="en-US-AriaNeural" ${s.tts_voice==='en-US-AriaNeural'?'selected':''}>Aria (Female, Natural)</option>
                        <option value="en-US-JennyNeural" ${s.tts_voice==='en-US-JennyNeural'?'selected':''}>Jenny (Female, Friendly)</option>
                        <option value="en-US-DavisNeural" ${s.tts_voice==='en-US-DavisNeural'?'selected':''}>Davis (Male, Casual)</option>
                        <option value="en-GB-RyanNeural" ${s.tts_voice==='en-GB-RyanNeural'?'selected':''}>Ryan (Male, British)</option>
                        <option value="en-GB-SoniaNeural" ${s.tts_voice==='en-GB-SoniaNeural'?'selected':''}>Sonia (Female, British)</option>
                    </select></div>
                    <div><label style="${T.label}">Speech Rate</label><select id="s-tts-rate" style="${T.select}">
                        <option value="-20%" ${s.tts_rate==='-20%'?'selected':''}>Slow (-20%)</option><option value="-10%" ${s.tts_rate==='-10%'?'selected':''}>Slightly Slow</option>
                        <option value="+0%" ${!s.tts_rate||s.tts_rate==='+0%'?'selected':''}>Normal</option><option value="+10%" ${s.tts_rate==='+10%'?'selected':''}>Slightly Fast</option>
                        <option value="+20%" ${s.tts_rate==='+20%'?'selected':''}>Fast (+20%)</option>
                    </select></div>
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
        try { await api('PUT', 'stores/' + currentStore.store_id, data); currentStore = { ...currentStore, ...data }; toast('Voice settings saved!', 'success'); }
        catch (e) { toast(e.message, 'error'); }
    }

    async function testVoice() {
        const text = 'Hey there! I am Mark, your friendly robot assistant.';
        const preview = $('#voice-preview'), previewContent = $('#voice-preview-content');
        if (preview && previewContent) {
            preview.style.display = 'block';
            previewContent.innerHTML = `<div style="display:flex;align-items:center;gap:12px;"><div style="animation:markRobotBob 0.8s ease-in-out infinite;font-size:28px;">🤖</div><span style="font-size:14px;color:#42484a;">Generating voice...</span></div>`;
        }
        const settings = markAI || {};
        const backendUrl = currentStore?.backend_url || settings.backendUrl || 'https://mark-ix64.onrender.com';
        try {
            const res = await fetch(backendUrl + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, language: 'en', store_id: currentStore?.store_id || '' }) });
            if (res.ok) {
                const blob = await res.blob(); const url = URL.createObjectURL(blob);
                const audio = new Audio(url); audio.onended = () => URL.revokeObjectURL(url); await audio.play();
                if (previewContent) previewContent.innerHTML = `<div style="display:flex;align-items:center;gap:12px;"><button style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#fc9b6c,#954921);color:#fff;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;" onclick="markAdmin.testVoice()"><span class="material-symbols-outlined" style="font-size:20px;">play_arrow</span></button><span style="font-size:14px;color:#42484a;">Playing (Edge TTS)</span></div>`;
                toast('Playing Edge TTS voice!', 'success'); return;
            }
        } catch (e) { /* fallback */ }
        if ('speechSynthesis' in window) {
            const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
            if (previewContent) previewContent.innerHTML = `<span style="font-size:14px;color:#42484a;">Playing (browser fallback)</span>`;
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
                    <span class="material-symbols-outlined" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#73787a;cursor:pointer;font-size:20px;" onclick="const i=document.getElementById('s-groq-key');i.type=i.type==='password'?'text':'password';">visibility_off</span></div>
                    <p style="font-size:12px;color:#73787a;margin:6px 0 0;">Get your free key at <a href="https://console.groq.com" target="_blank" style="color:#954921;font-weight:600;text-decoration:none;">console.groq.com</a></p></div>
                <div><label style="${T.label}">LLM Model</label><select id="s-llm-model" style="${T.select}">
                    <option value="llama-3.3-70b-versatile" ${s.llm_model==='llama-3.3-70b-versatile'?'selected':''}>Llama 3.3 70B Versatile</option>
                    <option value="llama-3.1-8b-instant" ${s.llm_model==='llama-3.1-8b-instant'?'selected':''}>Llama 3.1 8B Instant</option>
                    <option value="gemma2-9b-it" ${s.llm_model==='gemma2-9b-it'?'selected':''}>Gemma 2 9B</option>
                    <option value="mixtral-8x7b-32768" ${s.llm_model==='mixtral-8x7b-32768'?'selected':''}>Mixtral 8x7B</option>
                </select></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
                    <div><label style="${T.label}">Max Tokens</label><input id="s-max-tokens" type="number" value="${s.max_tokens||150}" min="50" max="500" style="${T.input}" /></div>
                    <div><div style="display:flex;justify-content:space-between;margin-bottom:6px;"><label style="${T.label}margin-bottom:0;">Temperature</label><span id="temp-val" style="font-size:14px;font-weight:600;color:#954921;">${tempVal}</span></div>
                        <input type="range" id="s-temperature" min="0" max="1" step="0.01" value="${tempVal}" style="width:100%;height:4px;border-radius:2px;background:#c2c7ca;outline:none;-webkit-appearance:none;cursor:pointer;accent-color:#954921;" oninput="document.getElementById('temp-val').textContent=this.value" />
                        <p style="font-size:12px;color:#73787a;margin:6px 0 0;">Lower = focused, Higher = creative</p></div>
                </div>
                <div><label style="${T.label}">Custom System Prompt</label><textarea id="s-custom-prompt" rows="6" placeholder="You are an AI assistant..." style="${T.input}resize:vertical;min-height:120px;">${esc(s.custom_system_prompt||'')}</textarea><p style="font-size:12px;color:#73787a;margin:6px 0 0;">Advanced -- override Mark's entire personality.</p></div>
                <div style="padding-top:24px;border-top:1px solid rgba(194,199,202,0.3);display:flex;justify-content:flex-end;">
                    <button style="${T.btnPrimary}" onclick="markAdmin.saveAI()">Save AI Config</button>
                </div>
            </div>
        </div>`;
    }

    async function saveAI() {
        const data = {
            groq_api_key: $('#s-groq-key').value, llm_model: $('#s-llm-model').value,
            max_tokens: parseInt($('#s-max-tokens').value) || 150, temperature: parseFloat($('#s-temperature').value) || 0.72,
            custom_system_prompt: $('#s-custom-prompt').value,
        };
        try { await api('PUT', 'stores/' + currentStore.store_id, data); currentStore = { ...currentStore, ...data }; toast('AI configuration saved!', 'success'); }
        catch (e) { toast(e.message, 'error'); }
    }

    /* ================================================================
       TAB: CONVERSATIONS
       ================================================================ */
    async function loadConversationsTab(storeId) {
        const container = $('#tab-content');
        container.innerHTML = robotLoader('Loading conversations...');
        try {
            const [analyticsData, convosData] = await Promise.all([api('GET', 'stores/' + storeId + '/analytics'), api('GET', 'stores/' + storeId + '/conversations')]);
            const convos = convosData.conversations || [];
            container.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px;margin-bottom:32px;">
                ${renderMiniStat('Total', analyticsData.total_conversations, 'forum')}
                ${renderMiniStat('Today', analyticsData.today, 'today')}
                ${renderMiniStat('This Week', analyticsData.this_week, 'date_range')}
                ${renderMiniStat('Unique Visitors', analyticsData.unique_visitors, 'person')}
            </div>
            <div style="${T.glass}padding:24px;overflow-x:auto;">
                <h3 style="${T.headline}font-size:20px;margin:0 0 20px;">Recent Conversations</h3>
                ${convos.length === 0 ? '<p style="color:#73787a;font-size:14px;">No conversations yet.</p>'
                : `<table style="width:100%;border-collapse:separate;border-spacing:0;">
                    <thead><tr>${['Visitor','Language','User Message',"Mark's Response",'Time'].map(h =>
                        `<th style="text-align:left;padding:12px 16px;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#42484a;border-bottom:1px solid rgba(194,199,202,0.4);font-weight:600;">${h}</th>`).join('')}</tr></thead>
                    <tbody>${convos.map(c => `<tr style="transition:background 0.2s;" onmouseenter="this.style.background='rgba(225,245,254,0.3)'" onmouseleave="this.style.background='transparent'">
                        <td style="padding:14px 16px;border-bottom:1px solid rgba(194,199,202,0.2);font-family:monospace;font-size:12px;color:#73787a;">${esc((c.visitor_hash||'').substring(0,8))}</td>
                        <td style="padding:14px 16px;border-bottom:1px solid rgba(194,199,202,0.2);"><span style="${T.badgeActive}padding:2px 8px;font-size:10px;">${esc(c.language||'en')}</span></td>
                        <td style="padding:14px 16px;border-bottom:1px solid rgba(194,199,202,0.2);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;">${esc(c.last_user_msg)}</td>
                        <td style="padding:14px 16px;border-bottom:1px solid rgba(194,199,202,0.2);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:#42484a;">${esc(c.mark_response)}</td>
                        <td style="padding:14px 16px;border-bottom:1px solid rgba(194,199,202,0.2);font-size:12px;color:#73787a;white-space:nowrap;">${formatDate(c.created_at)}</td>
                    </tr>`).join('')}</tbody></table>`}
            </div>`;
        } catch (e) { container.innerHTML = `<p style="color:#73787a;text-align:center;padding:40px;">${esc(e.message)}</p>`; }
    }

    /* ================================================================
       TAB: EMBED CODE
       ================================================================ */
    async function loadEmbedTab(storeId) {
        const container = $('#tab-content');
        container.innerHTML = robotLoader('Loading embed code...');
        try {
            const data = await api('GET', 'stores/' + storeId + '/embed');
            container.innerHTML = `
            <div style="max-width:900px;">
                <!-- WordPress auto-inject notice -->
                <div style="padding:20px 24px;background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.25);border-radius:12px;margin-bottom:32px;display:flex;align-items:flex-start;gap:12px;">
                    <span class="material-symbols-outlined" style="font-size:22px;color:#16a34a;flex-shrink:0;margin-top:1px;">check_circle</span>
                    <div>
                        <strong style="font-size:14px;color:#16a34a;">WordPress: Auto-Enabled</strong>
                        <p style="font-size:13px;color:#42484a;margin:4px 0 0;line-height:1.5;">
                            The Mark AI widget is <strong>automatically loaded</strong> on your WordPress site. No manual embed needed!
                            Just make sure "Widget Enabled" is set to <strong>Yes</strong> in <a href="#" onclick="event.preventDefault();markAdmin.navigate('settings')" style="color:#954921;font-weight:600;">Settings</a>.
                        </p>
                    </div>
                </div>
                <div style="margin-bottom:48px;">
                    <h3 style="${T.headline}font-size:24px;margin:0 0 8px;">External Site Embed</h3>
                    <p style="color:#73787a;font-size:14px;margin:0 0 20px;">Want Mark on a <strong>non-WordPress</strong> site? Paste this code before the closing &lt;/body&gt; tag.</p>
                    <div style="position:relative;">
                        <div style="position:absolute;top:12px;right:12px;z-index:2;">
                            <button style="background:rgba(255,255,255,0.8);color:#4f6169;border:1px solid rgba(179,229,252,0.3);border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px;" onclick="markAdmin.copyCode('embed-script-code')">
                                <span class="material-symbols-outlined" style="font-size:14px;">content_copy</span> Copy
                            </button>
                        </div>
                        <pre id="embed-script-code" style="background:#2f3131;border-radius:12px;padding:24px;color:#b6cad2;font-family:monospace;font-size:14px;line-height:1.6;overflow-x:auto;white-space:pre;margin:0;">${esc(data.embed_script)}</pre>
                    </div>
                </div>
                <div style="${T.glass}padding:24px;">
                    <h3 style="${T.headline}font-size:24px;margin:0 0 8px;">Store ID</h3>
                    <p style="color:#73787a;font-size:14px;margin:0 0 20px;">Use this ID for API calls or custom integrations.</p>
                    <div style="display:flex;align-items:center;gap:16px;">
                        <input type="text" readonly value="${esc(storeId)}" style="background:#2f3131;border:none;color:#b6cad2;font-family:monospace;font-size:16px;padding:12px;flex:1;max-width:400px;outline:none;border-radius:8px;" />
                        <button style="${T.btnSecondary}" onclick="markAdmin.copyText('${esc(storeId)}')"><span class="material-symbols-outlined" style="font-size:18px;">content_copy</span> Copy ID</button>
                    </div>
                </div>
            </div>`;
        } catch (e) { container.innerHTML = `<p style="color:#73787a;text-align:center;padding:40px;">${esc(e.message)}</p>`; }
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
            <div style="background:#ffffff;border:1px solid rgba(186,26,26,0.2);border-radius:16px;padding:40px;width:90%;max-width:440px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.12);" onclick="event.stopPropagation()">
                <span class="material-symbols-outlined" style="font-size:56px;color:#ba1a1a;margin-bottom:16px;">warning</span>
                <h2 style="${T.headline}font-size:24px;color:#ba1a1a;margin:0 0 8px;">Delete Store?</h2>
                <p style="color:#42484a;font-size:14px;margin:0 0 28px;line-height:1.6;">This will permanently delete <strong>${esc(currentStore.store_name)}</strong> and all conversations.</p>
                <div style="display:flex;gap:12px;justify-content:center;">
                    <button style="${T.btnSecondary}" onclick="markAdmin.closeModal()">Cancel</button>
                    <button style="${T.btnDanger}" onclick="markAdmin.deleteStore()"><span class="material-symbols-outlined" style="font-size:18px;">delete_forever</span> Delete</button>
                </div>
            </div>
        </div>`;
    }

    async function deleteStore() {
        try { await api('DELETE', 'stores/' + currentStore.store_id); toast('"' + currentStore.store_name + '" deleted.','success'); currentStore = null; closeModal(); navigate('dashboard'); }
        catch (e) { toast(e.message, 'error'); }
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
                content.innerHTML = `<div style="text-align:center;padding:60px;"><h3 style="${T.headline}font-size:20px;">No store found</h3><p style="color:#42484a;">Set up your store first.</p></div>`;
                return;
            }

            const storeData = await api('GET', 'stores/' + store.store_id);
            currentStore = storeData.store || storeData;

            content.innerHTML = `
            <div style="margin-bottom:32px;">
                <h1 style="${T.headline}font-size:48px;line-height:56px;letter-spacing:-0.02em;font-weight:300;margin:0 0 8px;">Conversations</h1>
                <p style="color:#42484a;font-size:18px;margin:0;">${esc(currentStore.store_name)} -- recent customer interactions.</p>
            </div>
            <div id="tab-content"></div>`;

            loadConversationsTab(currentStore.store_id);
        } catch (e) { content.innerHTML = `<p style="color:#73787a;text-align:center;padding:60px;">${esc(e.message)}</p>`; }
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
                <p style="color:#42484a;font-size:18px;margin:0;">Global configuration for Mark AI.</p>
            </div>
            <div style="${T.glass}padding:32px;margin-bottom:24px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;"><span class="material-symbols-outlined" style="font-size:20px;color:#4f6169;">key</span><h3 style="${T.headline}font-size:24px;margin:0;">API Keys</h3></div>
                <div style="max-width:600px;"><label style="${T.label}">Groq API Key (Global Default)</label>
                    <div style="position:relative;"><input id="g-groq-key" type="password" value="${esc(s.groq_api_key||'')}" placeholder="gsk_..." style="${T.input}" />
                    <span class="material-symbols-outlined" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#73787a;cursor:pointer;font-size:20px;" onclick="const i=document.getElementById('g-groq-key');i.type=i.type==='password'?'text':'password';">visibility_off</span></div>
                    <p style="font-size:12px;color:#73787a;margin:8px 0 0;">Get one free at <a href="https://console.groq.com" target="_blank" style="color:#954921;font-weight:600;text-decoration:none;">console.groq.com</a></p>
                </div>
            </div>
            <div style="${T.glass}padding:32px;margin-bottom:24px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;"><span class="material-symbols-outlined" style="font-size:20px;color:#4f6169;">record_voice_over</span><h3 style="${T.headline}font-size:24px;margin:0;">Default Voice (Edge TTS)</h3></div>
                <div style="max-width:300px;"><label style="${T.label}">English Voice</label><select id="g-voice-en" style="${T.select}">
                    <option value="en-US-GuyNeural" ${s.default_voice==='en-US-GuyNeural'?'selected':''}>Guy (Male)</option>
                    <option value="en-US-AriaNeural" ${s.default_voice==='en-US-AriaNeural'?'selected':''}>Aria (Female)</option>
                    <option value="en-US-DavisNeural" ${s.default_voice==='en-US-DavisNeural'?'selected':''}>Davis (Male)</option>
                    <option value="en-US-JennyNeural" ${s.default_voice==='en-US-JennyNeural'?'selected':''}>Jenny (Female)</option>
                </select></div>
            </div>
            <div style="${T.glass}padding:32px;margin-bottom:24px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;"><span class="material-symbols-outlined" style="font-size:20px;color:#4f6169;">widgets</span><h3 style="${T.headline}font-size:24px;margin:0;">Widget Settings</h3></div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:24px;max-width:800px;">
                    <div><label style="${T.label}">Widget Enabled</label><select id="g-widget-enabled" style="${T.select}"><option value="1" ${s.widget_enabled!==false&&s.widget_enabled!=='0'?'selected':''}>Yes</option><option value="0" ${s.widget_enabled===false||s.widget_enabled==='0'?'selected':''}>No</option></select></div>
                    <div><label style="${T.label}">Position</label><select id="g-widget-position" style="${T.select}"><option value="bottom-right" ${s.widget_position==='bottom-right'||!s.widget_position?'selected':''}>Bottom Right</option><option value="bottom-left" ${s.widget_position==='bottom-left'?'selected':''}>Bottom Left</option></select></div>
                    <div><label style="${T.label}">Auto Greet</label><select id="g-auto-greet" style="${T.select}"><option value="1" ${s.auto_greet!==false&&s.auto_greet!=='0'?'selected':''}>Yes</option><option value="0" ${s.auto_greet===false||s.auto_greet==='0'?'selected':''}>No</option></select></div>
                    <div><label style="${T.label}">Accent Color</label>
                        <div style="display:flex;align-items:center;gap:10px;">
                            <input type="color" id="g-accent-color" value="${esc(s.widget_accent_color || '#954921')}" style="width:44px;height:44px;border:2px solid #c2c7ca;border-radius:8px;cursor:pointer;padding:2px;background:none;" />
                            <input type="text" id="g-accent-hex" value="${esc(s.widget_accent_color || '#954921')}" maxlength="7" style="${T.input}width:90px;padding:10px;font-family:monospace;font-size:13px;"
                                oninput="const c=document.getElementById('g-accent-color');if(/^#[0-9a-fA-F]{6}$/.test(this.value))c.value=this.value;" />
                        </div>
                        <p style="font-size:11px;color:#73787a;margin:4px 0 0;">Chat bubble & robot glow color</p>
                    </div>
                </div>
            </div>
            <div style="${T.glass}padding:32px;margin-bottom:32px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;"><span class="material-symbols-outlined" style="font-size:20px;color:#4f6169;">cable</span><h3 style="${T.headline}font-size:24px;margin:0;">Connection Test</h3></div>
                <p style="color:#42484a;font-size:14px;margin:0 0 16px;">Verify your Groq API key is working.</p>
                <button style="${T.btnSecondary}" onclick="markAdmin.testConnection()" id="test-conn-btn"><span class="material-symbols-outlined" style="font-size:18px;">power</span> Test Groq Connection</button>
                <div id="conn-test-result" style="margin-top:12px;"></div>
            </div>
            <button style="${T.btnPrimary}padding:14px 32px;" onclick="markAdmin.saveGlobalSettings()">Save All Settings</button>`;
        } catch (e) {
            content.innerHTML = `<div style="text-align:center;padding:60px;color:#73787a;"><span class="material-symbols-outlined" style="font-size:48px;opacity:0.3;">error</span><p style="margin:16px 0;">${esc(e.message)}</p>
            <button style="${T.btnSecondary}" onclick="markAdmin.navigate('settings')"><span class="material-symbols-outlined" style="font-size:18px;">refresh</span> Retry</button></div>`;
        }
    }

    async function saveGlobalSettings() {
        const accentColor = ($('#g-accent-hex') || {}).value?.trim() || '#954921';
        const data = {
            groq_api_key: $('#g-groq-key').value.trim(),
            default_voice: $('#g-voice-en').value,
            widget_enabled: $('#g-widget-enabled').value,
            widget_position: $('#g-widget-position').value,
            auto_greet: $('#g-auto-greet').value,
            widget_accent_color: /^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : '#954921',
        };
        try { await api('POST', 'settings', data); toast('Global settings saved!', 'success'); } catch (e) { toast(e.message, 'error'); }
    }

    async function testConnection() {
        const btn = $('#test-conn-btn'), result = $('#conn-test-result');
        if (btn) btn.disabled = true;
        if (result) result.innerHTML = `<span style="color:#4f6169;font-size:13px;display:flex;align-items:center;gap:8px;"><span style="display:inline-block;animation:markRobotBob 0.8s ease-in-out infinite;font-size:16px;">🤖</span> Testing connection...</span>`;
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
                        <span class="material-symbols-outlined" style="font-size:18px;color:#ba1a1a;">error</span>
                        <span style="color:#ba1a1a;font-size:13px;font-weight:600;">${esc(data.error)}</span>
                    </div>
                    ${data.hint ? `<p style="font-size:12px;color:#42484a;margin:0;padding-left:26px;line-height:1.5;">
                        <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;color:#954921;">lightbulb</span>
                        <strong>Fix:</strong> ${esc(data.hint)}
                    </p>` : ''}
                </div>`;
            }
        } catch (e) {
            result.innerHTML = `<div style="padding:12px 16px;background:rgba(186,26,26,0.05);border:1px solid rgba(186,26,26,0.15);border-radius:8px;">
                <span style="color:#ba1a1a;font-size:13px;">${esc(e.message)}</span>
            </div>`;
        }
        if (btn) btn.disabled = false;
    }

    /* ================================================================
       MODAL HELPER
       ================================================================ */
    function closeModal(event) { if (event && event.target !== event.currentTarget) return; const c = $('#mark-modal-container'); if (c) c.innerHTML = ''; }

    /* ================================================================
       PUBLIC API
       ================================================================ */
    window.markAdmin = {
        navigate, openStore, switchTab,
        saveStoreSettings, saveVoice, testVoice, saveAI,
        confirmDelete, deleteStore,
        copyCode, copyText, closeModal,
        saveGlobalSettings, testConnection,
        completeSetup, showPreview,
    };

    /* ================================================================
       BOOT
       ================================================================ */
    function boot() { if ($('#mark-ai-app')) renderAppShell(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

})();
