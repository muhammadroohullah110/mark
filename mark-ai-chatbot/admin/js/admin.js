/**
 * Mark AI -- Admin Dashboard SPA
 * Renders inside #mark-ai-app container
 * Arctic Sovereign / Boreal Futurism Design System
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
    let storeSearch    = '';
    let currentPage    = 'dashboard';

    /* ================================================================
       DESIGN TOKENS  (inline style fragments)
       ================================================================ */
    const T = {
        // Background
        pageBg: `background-color:#020617;background-image:radial-gradient(circle at 15% 50%,rgba(0,119,255,0.03),transparent 25%),radial-gradient(circle at 85% 30%,rgba(165,243,252,0.02),transparent 25%);background-attachment:fixed;`,

        // Ice-glass panel
        glass: `background:rgba(165,243,252,0.03);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);border:1px solid rgba(0,119,255,0.3);box-shadow:inset 1px 1px 0px 0px rgba(255,255,255,0.1);border-radius:12px;position:relative;overflow:hidden;`,

        // Ice-glass panel (lighter, for sub-panels)
        glassLight: `background:rgba(25,28,30,0.4);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(174,198,255,0.2);box-shadow:inset 1px 1px 0px rgba(255,255,255,0.05);border-radius:12px;`,

        // Ice input (bottom-border only)
        input: `background-color:rgba(50,53,55,0.5);border:none;border-bottom:1px solid rgba(144,144,151,0.5);color:#e0e3e5;padding:12px;font-family:'Inter',sans-serif;font-size:14px;width:100%;outline:none;border-radius:2px 2px 0 0;transition:border-color 0.3s ease;`,

        // Select (bottom-border)
        select: `background-color:rgba(50,53,55,0.5);border:none;border-bottom:1px solid rgba(144,144,151,0.5);color:#e0e3e5;padding:12px;font-family:'Inter',sans-serif;font-size:14px;width:100%;outline:none;border-radius:2px 2px 0 0;appearance:none;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23909097' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;`,

        // Gradient text purple
        gradientTextPurple: `background:linear-gradient(135deg,#a855f7,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;`,

        // Gradient button
        btnGradient: `background:linear-gradient(to right,#4f8eff,#85d3dc);color:#00275e;border:none;border-radius:8px;padding:12px 24px;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all 0.3s;box-shadow:0 0 15px rgba(79,142,255,0.2);letter-spacing:0.02em;`,

        // Secondary button (ghost)
        btnSecondary: `background:rgba(174,198,255,0.08);color:#aec6ff;border:1px solid rgba(174,198,255,0.15);border-radius:8px;padding:10px 20px;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all 0.2s;`,

        // Danger button
        btnDanger: `background:rgba(255,180,171,0.1);color:#ffb4ab;border:1px solid rgba(255,180,171,0.2);border-radius:8px;padding:10px 20px;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all 0.2s;`,

        // Label (uppercase tracking-widest)
        label: `display:block;font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:700;color:#85d3dc;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.1em;line-height:1;`,

        // Stat value (48px)
        statValue: `font-family:'Space Grotesk',sans-serif;font-size:48px;font-weight:700;line-height:1.1;letter-spacing:-0.02em;`,

        // Headline
        headline: `font-family:'Space Grotesk',sans-serif;font-weight:600;color:#e0e3e5;`,

        // Muted text
        muted: `color:#909097;font-size:13px;`,

        // Card hover glow (applied via JS)
        cardHoverShadow: '0 0 20px rgba(0,119,255,0.15)',
        cardHoverBorder: 'rgba(165,243,252,0.4)',

        // Active badge
        badgeActive: `display:inline-flex;align-items:center;gap:6px;padding:4px 12px;font-size:10px;font-weight:700;border-radius:9999px;background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.2);color:#34d399;text-transform:uppercase;letter-spacing:0.08em;font-family:'Space Grotesk',sans-serif;`,

        // Inactive badge
        badgeInactive: `display:inline-flex;align-items:center;gap:6px;padding:4px 12px;font-size:10px;font-weight:700;border-radius:9999px;background:rgba(100,116,139,0.1);border:1px solid rgba(100,116,139,0.2);color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;font-family:'Space Grotesk',sans-serif;`,

        // Tab button
        tabBtn: `padding:12px 24px;font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:500;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;transition:all 0.2s;white-space:nowrap;color:#909097;`,

        tabBtnActive: `padding:12px 24px;font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:600;background:none;border:none;border-bottom:2px solid #aec6ff;cursor:pointer;transition:all 0.2s;white-space:nowrap;color:#aec6ff;`,
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
            success: { bg: 'rgba(52,211,153,0.15)', border: 'rgba(52,211,153,0.3)', text: '#34d399', icon: 'check_circle' },
            error:   { bg: 'rgba(255,180,171,0.15)', border: 'rgba(255,180,171,0.3)', text: '#ffb4ab', icon: 'error' },
            info:    { bg: 'rgba(34,211,238,0.15)', border: 'rgba(34,211,238,0.3)', text: '#22d3ee', icon: 'info' },
        };
        const c = colors[type] || colors.info;

        const el = document.createElement('div');
        el.className = 'mark-ai-toast';
        el.style.cssText = `position:fixed;top:40px;right:20px;z-index:999999;min-width:320px;padding:16px 20px;border-radius:12px;font-family:'Inter',sans-serif;font-size:14px;backdrop-filter:blur(16px);border:1px solid ${c.border};background:${c.bg};color:${c.text};transform:translateX(120%);transition:transform 0.4s cubic-bezier(0.4,0,0.2,1);display:flex;align-items:center;gap:10px;`;
        el.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px;">${c.icon}</span><span>${esc(message)}</span>`;
        document.body.appendChild(el);

        requestAnimationFrame(() => { el.style.transform = 'translateX(0)'; });
        setTimeout(() => {
            el.style.transform = 'translateX(120%)';
            setTimeout(() => el.remove(), 400);
        }, 3500);
    }

    /* ================================================================
       SKELETON LOADING
       ================================================================ */
    function skeleton(height = '200px') {
        return `<div style="height:${height};border-radius:12px;background:linear-gradient(90deg,#272a2c 25%,#323537 50%,#272a2c 75%);background-size:200% 100%;animation:markShimmer 1.5s infinite;"></div>`;
    }

    /* ================================================================
       INJECT GLOBAL KEYFRAMES + SIDEBAR CSS (once)
       ================================================================ */
    function injectKeyframes() {
        if (document.getElementById('mark-ai-keyframes')) return;
        const style = document.createElement('style');
        style.id = 'mark-ai-keyframes';
        style.textContent = `
            @keyframes markShimmer {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
            }
            @keyframes markPulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.4; }
            }
            @keyframes markSpin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            /* Focus style for ice-inputs */
            .mark-ai-app-root input:focus, .mark-ai-app-root textarea:focus, .mark-ai-app-root select:focus {
                border-bottom-color: #aec6ff !important;
                box-shadow: 0 1px 0 0 #aec6ff !important;
                outline: none !important;
            }
            .mark-ai-app-root select option {
                background: #1d2022;
                color: #e0e3e5;
            }
            /* WP Admin overrides */
            #mark-ai-app .mark-ai-app-root {
                margin: 0 !important;
            }
        `;
        document.head.appendChild(style);
    }

    /* ================================================================
       RENDER: APP SHELL (Content Area)
       ================================================================ */
    function renderAppShell() {
        injectKeyframes();

        const app = $('#mark-ai-app');
        if (!app) return;

        // Map WP page slug to internal page name
        const pageMap = {
            'mark-ai': 'dashboard',
            'mark-ai-stores': 'dashboard',
            'mark-ai-conversations': 'conversations',
            'mark-ai-settings': 'settings',
        };
        currentPage = pageMap[PAGE] || 'dashboard';

        app.innerHTML = `
        <div class="mark-ai-app-root" style="${T.pageBg}min-height:500px;padding:0;font-family:'Inter',sans-serif;color:#e0e3e5;-webkit-font-smoothing:antialiased;border-radius:8px;overflow:hidden;">
            <!-- Page Content -->
            <div style="padding:32px 32px;max-width:1200px;" id="mark-page-content">
                ${skeleton('200px')}
                <div style="margin-top:16px;">${skeleton('300px')}</div>
            </div>

            <!-- Modal Container -->
            <div id="mark-modal-container"></div>
        </div>
        `;

        // Load initial page
        navigate(currentPage);
    }

    /* ================================================================
       SPA NAVIGATION
       ================================================================ */
    function navigate(page) {
        currentPage = page;
        currentStore = null;

        // Route to the correct page loader
        switch (page) {
            case 'conversations': loadConversationsPage(); break;
            case 'settings':      loadSettingsPage(); break;
            default:              loadDashboardPage(); break;
        }
    }

    /* ================================================================
       RENDER: STAT CARD (Dashboard-style, 48px gradient number)
       ================================================================ */
    function renderStatCard(label, value, icon) {
        return `
        <div style="${T.glass}padding:24px;min-height:140px;display:flex;flex-direction:column;justify-content:space-between;transition:all 0.3s ease;"
             onmouseenter="this.style.boxShadow='${T.cardHoverShadow}';this.style.borderColor='${T.cardHoverBorder}'"
             onmouseleave="this.style.boxShadow='inset 1px 1px 0px 0px rgba(255,255,255,0.1)';this.style.borderColor='rgba(0,119,255,0.3)'">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;position:relative;z-index:1;">
                <span style="${T.label}margin-bottom:0;">${esc(label)}</span>
                <span class="material-symbols-outlined" style="color:rgba(34,211,238,0.5);font-size:24px;">${icon}</span>
            </div>
            <div style="${T.statValue}${T.gradientTextPurple}position:relative;z-index:1;">
                ${formatNum(value)}
            </div>
            <div style="position:absolute;bottom:0;right:0;width:96px;height:96px;background:rgba(168,85,247,0.05);filter:blur(40px);border-radius:50%;"></div>
        </div>`;
    }

    /* ================================================================
       RENDER: MINI STAT CARD (Store detail analytics)
       ================================================================ */
    function renderMiniStat(label, value, icon) {
        return `
        <div style="${T.glassLight}padding:20px;display:flex;flex-direction:column;justify-content:space-between;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
                <span style="${T.label}margin-bottom:0;">${esc(label)}</span>
                <span class="material-symbols-outlined" style="color:rgba(133,211,220,0.5);font-size:16px;">${icon}</span>
            </div>
            <div style="font-family:'Space Grotesk',sans-serif;font-size:32px;font-weight:600;letter-spacing:-0.01em;color:#e0e3e5;">
                ${formatNum(value)}
            </div>
        </div>`;
    }

    /* ================================================================
       RENDER: BADGE
       ================================================================ */
    function renderBadge(isActive) {
        if (isActive) {
            return `<span style="${T.badgeActive}"><span style="width:6px;height:6px;border-radius:50%;background:#34d399;animation:markPulse 2s ease-in-out infinite;"></span>Active</span>`;
        }
        return `<span style="${T.badgeInactive}"><span style="width:6px;height:6px;border-radius:50%;background:#94a3b8;"></span>Inactive</span>`;
    }

    /* ================================================================
       RENDER: STORE CARD
       ================================================================ */
    function renderStoreCard(store) {
        const opacity = store.is_active ? '1' : '0.7';
        return `
        <div style="${T.glass}padding:24px;cursor:pointer;transition:all 0.3s ease;opacity:${opacity};min-height:200px;display:flex;flex-direction:column;justify-content:space-between;"
             onclick="markAdmin.openStore('${store.store_id}')"
             onmouseenter="this.style.boxShadow='${T.cardHoverShadow}';this.style.borderColor='${T.cardHoverBorder}';this.style.opacity='1';"
             onmouseleave="this.style.boxShadow='inset 1px 1px 0px 0px rgba(255,255,255,0.1)';this.style.borderColor='rgba(0,119,255,0.3)';this.style.opacity='${opacity}';">
            <div style="position:relative;z-index:1;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
                    <h3 style="${T.headline}font-size:24px;margin:0;transition:color 0.2s;">${esc(store.store_name)}</h3>
                    ${renderBadge(store.is_active)}
                </div>
                <a style="font-size:14px;color:rgba(96,165,250,0.8);text-decoration:none;display:inline-block;font-family:'Inter',sans-serif;" onclick="event.stopPropagation()">${esc(store.website_url)}</a>
            </div>
            <div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.05);display:flex;align-items:center;gap:12px;position:relative;z-index:1;">
                <div style="width:32px;height:32px;border-radius:50%;background:rgba(30,58,138,0.3);display:flex;align-items:center;justify-content:center;border:1px solid rgba(59,130,246,0.2);">
                    <span class="material-symbols-outlined" style="font-size:16px;color:#22d3ee;">smart_toy</span>
                </div>
                <div>
                    <p style="font-family:'Space Grotesk',sans-serif;font-size:10px;color:#c6c6cd;text-transform:uppercase;letter-spacing:0.1em;margin:0;">Assistant</p>
                    <p style="font-size:14px;color:#e0e3e5;margin:2px 0 0;">
                        ${esc(store.assistant_name || 'Mark')}
                    </p>
                </div>
            </div>
        </div>`;
    }

    /* ================================================================
       RENDER: EMPTY STATE
       ================================================================ */
    function renderEmptyState() {
        return `
        <div style="grid-column:1/-1;${T.glass}padding:48px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border-style:dashed;">
            <div style="width:64px;height:64px;border-radius:50%;background:rgba(30,58,138,0.2);display:flex;align-items:center;justify-content:center;margin-bottom:16px;">
                <span class="material-symbols-outlined" style="font-size:32px;color:rgba(34,211,238,0.5);">storefront</span>
            </div>
            <h3 style="${T.headline}font-size:24px;margin:0 0 8px;">No stores yet</h3>
            <p style="color:#c6c6cd;font-size:16px;max-width:400px;margin:0 0 24px;line-height:1.6;">
                Connect your first storefront to Mark AI to start analyzing conversations and improving conversions.
            </p>
            <button style="${T.btnGradient}" onclick="markAdmin.showAddStore()">
                <span class="material-symbols-outlined" style="font-size:18px;">add</span> Add Store
            </button>
        </div>`;
    }

    /* ================================================================
       PAGE: DASHBOARD
       ================================================================ */
    async function loadDashboardPage() {
        const content = $('#mark-page-content');
        try {
            dashboardStats = await api('GET', 'dashboard');
            stores = dashboardStats.stores || [];

            content.innerHTML = `
            <!-- Header -->
            <div style="margin-bottom:40px;">
                <h1 style="${T.headline}font-size:48px;line-height:1.1;letter-spacing:-0.02em;margin:0 0 8px;">Overview</h1>
                <p style="font-family:'Inter',sans-serif;font-size:18px;color:#c6c6cd;line-height:1.6;margin:0;">Welcome back, Administrator. Here's your global telemetry.</p>
            </div>

            <!-- Stats Grid -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:24px;margin-bottom:80px;">
                ${renderStatCard('Total Stores', dashboardStats.total_stores, 'storefront')}
                ${renderStatCard('Total Conversations', dashboardStats.total_conversations, 'forum')}
                ${renderStatCard("Today's Chats", dashboardStats.today_conversations, 'today')}
                ${renderStatCard('Active Stores', dashboardStats.active_stores, 'bolt')}
            </div>

            <!-- Store Network Header -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;flex-wrap:wrap;gap:16px;">
                <h2 style="${T.headline}font-size:32px;letter-spacing:-0.01em;margin:0;">Store Network</h2>
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="position:relative;">
                        <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:rgba(198,198,205,0.5);font-size:18px;">search</span>
                        <input id="store-search-input" type="text" placeholder="Search stores..."
                               style="${T.input}padding-left:40px;width:240px;border-radius:8px;background:rgba(16,20,21,0.5);border:1px solid rgba(59,130,246,0.2);border-bottom:1px solid rgba(59,130,246,0.2);"
                               oninput="markAdmin.filterStores(this.value)" />
                    </div>
                    <button style="${T.btnGradient}" onclick="markAdmin.showAddStore()">
                        <span class="material-symbols-outlined" style="font-size:18px;">add</span> Add Store
                    </button>
                </div>
            </div>

            <!-- Store Cards Grid -->
            <div id="stores-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px;">
                ${stores.length === 0 ? renderEmptyState() : stores.map(renderStoreCard).join('')}
            </div>
            `;
        } catch (e) {
            content.innerHTML = `
            <div style="text-align:center;padding:80px 20px;">
                <span class="material-symbols-outlined" style="font-size:64px;color:rgba(255,180,171,0.3);margin-bottom:16px;">error</span>
                <h3 style="${T.headline}font-size:20px;margin:16px 0 8px;">Failed to load dashboard</h3>
                <p style="color:#c6c6cd;font-size:14px;margin:0 0 20px;">${esc(e.message)}</p>
                <button style="${T.btnSecondary}" onclick="markAdmin.navigate('dashboard')">
                    <span class="material-symbols-outlined" style="font-size:18px;">refresh</span> Retry
                </button>
            </div>`;
        }
    }

    function filterStores(query) {
        storeSearch = query.toLowerCase();
        const grid = $('#stores-grid');
        if (!grid) return;

        const filtered = stores.filter(s =>
            s.store_name.toLowerCase().includes(storeSearch) ||
            s.website_url.toLowerCase().includes(storeSearch) ||
            (s.assistant_name || '').toLowerCase().includes(storeSearch)
        );

        grid.innerHTML = filtered.length === 0
            ? `<div style="grid-column:1/-1;text-align:center;padding:40px;color:#909097;">
                <span class="material-symbols-outlined" style="font-size:48px;opacity:0.3;">search_off</span>
                <p style="margin:12px 0 0;">No stores match "${esc(query)}"</p>
               </div>`
            : filtered.map(renderStoreCard).join('');
    }

    /* ================================================================
       MODAL: ADD STORE
       ================================================================ */
    function showAddStore() {
        const container = $('#mark-modal-container');
        container.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;"
             onclick="markAdmin.closeModal(event)">
            <div style="background:#1d2022;border:1px solid rgba(79,142,255,0.3);border-top:1px solid rgba(255,255,255,0.1);border-left:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:40px;width:90%;max-width:600px;max-height:85vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,0.5),0 0 15px rgba(79,142,255,0.15);transform:scale(1);transition:transform 0.3s;"
                 onclick="event.stopPropagation()">

                <!-- Header -->
                <div style="margin-bottom:32px;">
                    <h2 style="${T.headline}font-size:32px;letter-spacing:-0.01em;margin:0 0 4px;">Add New Store</h2>
                    <p style="color:#c6c6cd;font-size:16px;margin:0;">Connect Mark to a new ecommerce website.</p>
                </div>

                <!-- Form -->
                <div style="display:flex;flex-direction:column;gap:24px;">
                    <div>
                        <label style="${T.label}">Store Name</label>
                        <input id="new-store-name" type="text" placeholder="My Awesome Store"
                               style="${T.input}" />
                        <span style="font-size:13px;color:rgba(198,198,205,0.7);margin-top:4px;display:block;">The internal display name for this connection.</span>
                    </div>
                    <div>
                        <label style="${T.label}display:flex;align-items:center;gap:6px;">
                            Website URL
                            <span style="width:6px;height:6px;border-radius:50%;background:#85d3dc;"></span>
                        </label>
                        <input id="new-store-url" type="url" placeholder="https://mystore.com"
                               style="${T.input}" />
                        <span style="font-size:13px;color:rgba(198,198,205,0.7);margin-top:4px;display:block;">The primary domain of the ecommerce front-end.</span>
                    </div>
                    <div>
                        <label style="${T.label}">Assistant Name</label>
                        <input id="new-store-assistant" type="text" value="Mark"
                               style="${T.input}" />
                        <span style="font-size:13px;color:rgba(198,198,205,0.7);margin-top:4px;display:block;">How the AI will introduce itself to customers.</span>
                    </div>

                    <!-- Actions -->
                    <div style="display:flex;flex-direction:row;align-items:center;justify-content:flex-end;gap:12px;margin-top:16px;padding-top:20px;border-top:1px solid rgba(29,32,34,0.8);">
                        <button style="${T.btnSecondary}" onclick="markAdmin.closeModal()">Cancel</button>
                        <button style="${T.btnGradient}" onclick="markAdmin.createStore()">
                            Create Store
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
    }

    async function createStore() {
        const name = ($('#new-store-name') || {}).value?.trim();
        const url  = ($('#new-store-url')  || {}).value?.trim();
        const assistant = ($('#new-store-assistant') || {}).value?.trim() || 'Mark';

        if (!name || !url) {
            toast('Store name and website URL are required.', 'error');
            return;
        }

        try {
            await api('POST', 'stores', {
                store_name: name,
                website_url: url,
                assistant_name: assistant,
            });
            toast('Store "' + name + '" created successfully!', 'success');
            closeModal();
            navigate('dashboard');
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    /* ================================================================
       PAGE: STORE DETAIL
       ================================================================ */
    async function openStore(storeId) {
        const content = $('#mark-page-content');
        content.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;color:#aec6ff;padding:60px;">
            <span class="material-symbols-outlined" style="animation:markSpin 1s linear infinite;font-size:24px;">progress_activity</span>
            <span style="font-family:'Space Grotesk',sans-serif;font-size:16px;">Loading store...</span>
        </div>`;

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
            <div style="display:flex;flex-direction:row;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;">
                <div>
                    <h2 style="${T.headline}font-size:48px;line-height:1.1;letter-spacing:-0.02em;color:#aec6ff;margin:0 0 4px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                        ${esc(s.store_name)}
                        ${renderBadge(s.is_active)}
                    </h2>
                    <a style="font-size:16px;color:#c6c6cd;text-decoration:none;display:inline-flex;align-items:center;gap:4px;transition:color 0.2s;"
                       href="${esc(s.website_url)}" target="_blank"
                       onmouseenter="this.style.color='#aec6ff'" onmouseleave="this.style.color='#c6c6cd'">
                        ${esc(s.website_url)}
                        <span class="material-symbols-outlined" style="font-size:16px;">open_in_new</span>
                    </a>
                </div>
            </div>
        </div>

        <!-- Analytics Mini Cards -->
        <div id="store-analytics" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:24px;margin-bottom:80px;">
            ${renderMiniStat('Total Chats', '--', 'forum')}
            ${renderMiniStat('Today', '--', 'today')}
            ${renderMiniStat('This Week', '--', 'date_range')}
            ${renderMiniStat('Unique Visitors', '--', 'person')}
        </div>

        <!-- Tab Navigation -->
        <div style="border-bottom:1px solid rgba(69,70,77,0.3);margin-bottom:40px;display:flex;gap:0;overflow-x:auto;" id="store-tabs">
            ${['settings','voice','ai','conversations','embed'].map(tab => {
                const labels = { settings: 'Settings', voice: 'Voice', ai: 'AI Config', conversations: 'Conversations', embed: 'Embed Code' };
                const isActive = tab === activeTab;
                return `<button data-tab="${tab}" style="${isActive ? T.tabBtnActive : T.tabBtn}"
                    onclick="markAdmin.switchTab('${tab}')"
                    onmouseenter="if(!this.dataset.active)this.style.color='#aec6ff'"
                    onmouseleave="if(!this.dataset.active)this.style.color='#909097'"
                    ${isActive ? 'data-active="1"' : ''}>${labels[tab]}</button>`;
            }).join('')}
        </div>

        <!-- Tab Content -->
        <div id="tab-content"></div>

        <!-- Danger Zone -->
        <div style="margin-top:80px;padding:24px;border:1px solid rgba(255,180,171,0.2);border-radius:12px;">
            <h3 style="${T.headline}font-size:20px;color:#ffb4ab;margin:0 0 8px;">Danger Zone</h3>
            <p style="color:#c6c6cd;font-size:14px;margin:0 0 16px;">Permanently delete this store and all its data. This action cannot be undone.</p>
            <button style="${T.btnDanger}" onclick="markAdmin.confirmDelete()">
                <span class="material-symbols-outlined" style="font-size:18px;">delete_forever</span> Delete Store
            </button>
        </div>
        `;

        // Load analytics
        loadStoreAnalytics(s.store_id);

        // Load active tab
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
                    ${renderMiniStat('Unique Visitors', data.unique_visitors, 'person')}
                `;
            }
        } catch (e) {
            // Silently fail -- analytics are supplementary
        }
    }

    /* ================================================================
       TAB SWITCHING
       ================================================================ */
    function switchTab(tab) {
        activeTab = tab;

        // Update tab button styles
        const buttons = $$('#store-tabs button');
        buttons.forEach(btn => {
            const isActive = btn.dataset.tab === tab;
            btn.style.cssText = isActive ? T.tabBtnActive : T.tabBtn;
            if (isActive) {
                btn.dataset.active = '1';
            } else {
                delete btn.dataset.active;
            }
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
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px 24px;">
                    <!-- Store Name -->
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="${T.label}">Store Name</label>
                        <input id="s-store-name" type="text" value="${esc(s.store_name)}" style="${T.input}" />
                    </div>
                    <!-- Website URL -->
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="${T.label}">Website URL</label>
                        <input id="s-website-url" type="url" value="${esc(s.website_url)}" style="${T.input}" />
                    </div>
                    <!-- Assistant Name -->
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="${T.label}">Assistant Name</label>
                        <input id="s-assistant-name" type="text" value="${esc(s.assistant_name || 'Mark')}" style="${T.input}" />
                        <span style="font-size:13px;color:#909097;margin-top:4px;">What should the AI call itself?</span>
                    </div>
                    <!-- Personality -->
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="${T.label}">Personality</label>
                        <select id="s-personality" style="${T.select}">
                            <option value="professional" ${s.personality === 'professional' ? 'selected' : ''}>Professional & Precise</option>
                            <option value="friendly" ${s.personality === 'friendly' ? 'selected' : ''}>Friendly & Approachable</option>
                            <option value="playful" ${s.personality === 'playful' ? 'selected' : ''}>Playful & Witty</option>
                        </select>
                    </div>
                    <!-- Primary Language -->
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="${T.label}">Primary Language</label>
                        <select id="s-primary-lang" style="${T.select}">
                            <option value="en" ${s.primary_language === 'en' ? 'selected' : ''}>English</option>
                            <option value="ur" ${s.primary_language === 'ur' ? 'selected' : ''}>Urdu (Roman)</option>
                            <option value="hi" ${s.primary_language === 'hi' ? 'selected' : ''}>Hindi (Roman)</option>
                            <option value="ar" ${s.primary_language === 'ar' ? 'selected' : ''}>Arabic</option>
                        </select>
                    </div>
                    <!-- Idle Timeout -->
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="${T.label}">Idle Timeout (Seconds)</label>
                        <input id="s-idle-timeout" type="number" value="${s.idle_timeout || 300}" style="${T.input}" />
                    </div>
                    <!-- Max Crawl Pages -->
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="${T.label}">Max Crawl Pages</label>
                        <input id="s-max-crawl" type="number" value="${s.max_crawl_pages || 120}" style="${T.input}" />
                    </div>
                    <!-- Status -->
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="${T.label}">Status</label>
                        <select id="s-is-active" style="${T.select}">
                            <option value="1" ${s.is_active ? 'selected' : ''}>Active (Deployed)</option>
                            <option value="0" ${!s.is_active ? 'selected' : ''}>Inactive (Maintenance)</option>
                        </select>
                    </div>
                </div>

                <!-- Save -->
                <div style="padding-top:24px;border-top:1px solid rgba(69,70,77,0.3);display:flex;justify-content:flex-end;">
                    <button type="submit" style="${T.btnGradient}"
                            onmouseenter="this.style.boxShadow='0 0 25px rgba(79,142,255,0.4)';this.style.transform='translateY(-2px)'"
                            onmouseleave="this.style.boxShadow='0 0 15px rgba(79,142,255,0.2)';this.style.transform='translateY(0)'">
                        Save Settings
                    </button>
                </div>
            </form>
        </div>`;
    }

    async function saveStoreSettings() {
        const data = {
            store_name:      $('#s-store-name').value,
            website_url:     $('#s-website-url').value,
            assistant_name:  $('#s-assistant-name').value,
            personality:     $('#s-personality').value,
            primary_language: $('#s-primary-lang').value,
            is_active:       $('#s-is-active').value === '1',
            max_crawl_pages: parseInt($('#s-max-crawl').value) || 120,
            idle_timeout:    parseInt($('#s-idle-timeout').value) || 300,
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
            <!-- Left: Voice form -->
            <div style="${T.glassLight}padding:40px;">
                <h3 style="${T.headline}font-size:24px;margin:0 0 24px;">Voice Configuration</h3>
                <p style="color:#c6c6cd;font-size:14px;margin:0 0 32px;">
                    Powered by <span style="color:#aec6ff;">Edge TTS</span> -- free, no API key needed. High-quality multilingual voices.
                </p>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="${T.label}">English Voice</label>
                        <select id="s-tts-voice" style="${T.select}">
                            <option value="en-US-GuyNeural" ${s.tts_voice === 'en-US-GuyNeural' ? 'selected' : ''}>Guy (Male, Warm)</option>
                            <option value="en-US-AriaNeural" ${s.tts_voice === 'en-US-AriaNeural' ? 'selected' : ''}>Aria (Female, Natural)</option>
                            <option value="en-US-JennyNeural" ${s.tts_voice === 'en-US-JennyNeural' ? 'selected' : ''}>Jenny (Female, Friendly)</option>
                            <option value="en-US-DavisNeural" ${s.tts_voice === 'en-US-DavisNeural' ? 'selected' : ''}>Davis (Male, Casual)</option>
                            <option value="en-GB-RyanNeural" ${s.tts_voice === 'en-GB-RyanNeural' ? 'selected' : ''}>Ryan (Male, British)</option>
                            <option value="en-GB-SoniaNeural" ${s.tts_voice === 'en-GB-SoniaNeural' ? 'selected' : ''}>Sonia (Female, British)</option>
                        </select>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="${T.label}">Urdu Voice</label>
                        <select id="s-tts-voice-urdu" style="${T.select}">
                            <option value="ur-PK-AsadNeural" ${s.tts_voice_urdu === 'ur-PK-AsadNeural' ? 'selected' : ''}>Asad (Male, Urdu)</option>
                            <option value="ur-PK-UzmaNeural" ${s.tts_voice_urdu === 'ur-PK-UzmaNeural' ? 'selected' : ''}>Uzma (Female, Urdu)</option>
                        </select>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="${T.label}">Speech Rate</label>
                        <select id="s-tts-rate" style="${T.select}">
                            <option value="-20%" ${s.tts_rate === '-20%' ? 'selected' : ''}>Slow (-20%)</option>
                            <option value="-10%" ${s.tts_rate === '-10%' ? 'selected' : ''}>Slightly Slow (-10%)</option>
                            <option value="+0%" ${!s.tts_rate || s.tts_rate === '+0%' ? 'selected' : ''}>Normal</option>
                            <option value="+10%" ${s.tts_rate === '+10%' ? 'selected' : ''}>Slightly Fast (+10%)</option>
                            <option value="+20%" ${s.tts_rate === '+20%' ? 'selected' : ''}>Fast (+20%)</option>
                        </select>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="${T.label}">Pitch</label>
                        <select id="s-tts-pitch" style="${T.select}">
                            <option value="-10Hz" ${s.tts_pitch === '-10Hz' ? 'selected' : ''}>Lower (-10Hz)</option>
                            <option value="+0Hz" ${!s.tts_pitch || s.tts_pitch === '+0Hz' ? 'selected' : ''}>Normal</option>
                            <option value="+10Hz" ${s.tts_pitch === '+10Hz' ? 'selected' : ''}>Higher (+10Hz)</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Right: Actions -->
            <div style="display:flex;flex-direction:column;gap:16px;">
                <div style="${T.glassLight}padding:24px;display:flex;flex-direction:column;gap:12px;">
                    <button style="${T.btnGradient}width:100%;justify-content:center;" onclick="markAdmin.saveVoice()"
                            onmouseenter="this.style.boxShadow='0 0 25px rgba(79,142,255,0.5)'"
                            onmouseleave="this.style.boxShadow='0 0 15px rgba(79,142,255,0.2)'">
                        Save Voice Settings
                    </button>
                    <button style="${T.btnSecondary}width:100%;justify-content:center;" onclick="markAdmin.testVoice('en')">
                        <span class="material-symbols-outlined" style="font-size:18px;">play_arrow</span> Test English
                    </button>
                    <button style="${T.btnSecondary}width:100%;justify-content:center;" onclick="markAdmin.testVoice('ur')">
                        <span class="material-symbols-outlined" style="font-size:18px;">play_arrow</span> Test Urdu
                    </button>
                </div>

                <!-- Audio Preview -->
                <div id="voice-preview" style="${T.glassLight}padding:24px;display:none;">
                    <span style="${T.label}">Voice Preview</span>
                    <div id="voice-preview-content" style="margin-top:8px;"></div>
                </div>
            </div>
        </div>`;
    }

    async function saveVoice() {
        const data = {
            tts_voice:      $('#s-tts-voice').value,
            tts_voice_urdu: $('#s-tts-voice-urdu').value,
            tts_rate:       $('#s-tts-rate').value,
            tts_pitch:      $('#s-tts-pitch').value,
        };
        try {
            await api('PUT', 'stores/' + currentStore.store_id, data);
            currentStore = { ...currentStore, ...data };
            toast('Voice settings saved!', 'success');
        } catch (e) { toast(e.message, 'error'); }
    }

    function testVoice(lang) {
        const text = lang === 'ur'
            ? 'Assalam o alaikum! Main Mark hoon, aap ka shopping buddy.'
            : 'Hey there! I am Mark, your personal shopping companion.';

        // Use browser SpeechSynthesis for instant preview
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = lang === 'ur' ? 'ur-PK' : 'en-US';
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utterance);

            // Show preview
            const preview = $('#voice-preview');
            const previewContent = $('#voice-preview-content');
            if (preview && previewContent) {
                preview.style.display = 'block';
                previewContent.innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;">
                    <button style="width:40px;height:40px;border-radius:50%;background:#4f8eff;color:#00275e;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 0 10px rgba(79,142,255,0.4);"
                            onclick="markAdmin.testVoice('${lang}')">
                        <span class="material-symbols-outlined" style="font-size:20px;">play_arrow</span>
                    </button>
                    <span style="font-size:14px;color:#c6c6cd;">${lang === 'ur' ? 'Urdu' : 'English'} sample playing...</span>
                </div>`;
            }
            toast('Playing voice sample!', 'success');
        } else {
            toast('Browser does not support speech synthesis.', 'error');
        }
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
                <!-- Groq API Key -->
                <div>
                    <label style="${T.label}">Groq API Key</label>
                    <div style="position:relative;">
                        <input id="s-groq-key" type="password" value="${esc(s.groq_api_key || '')}"
                               placeholder="gsk_... (leave empty to use global key)"
                               style="${T.input}" />
                        <span class="material-symbols-outlined" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#909097;cursor:pointer;font-size:20px;"
                              onclick="const i=document.getElementById('s-groq-key');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'visibility_off':'visibility'">visibility_off</span>
                    </div>
                    <p style="font-size:12px;color:#909097;margin:6px 0 0;">
                        Get your free key at <a href="https://console.groq.com" target="_blank" style="color:#aec6ff;text-decoration:none;">console.groq.com</a>
                    </p>
                </div>

                <!-- LLM Model -->
                <div>
                    <label style="${T.label}">LLM Model</label>
                    <select id="s-llm-model" style="${T.select}">
                        <option value="llama-3.3-70b-versatile" ${s.llm_model === 'llama-3.3-70b-versatile' ? 'selected' : ''}>Llama 3.3 70B Versatile</option>
                        <option value="llama-3.1-8b-instant" ${s.llm_model === 'llama-3.1-8b-instant' ? 'selected' : ''}>Llama 3.1 8B Instant</option>
                        <option value="gemma2-9b-it" ${s.llm_model === 'gemma2-9b-it' ? 'selected' : ''}>Gemma 2 9B</option>
                        <option value="mixtral-8x7b-32768" ${s.llm_model === 'mixtral-8x7b-32768' ? 'selected' : ''}>Mixtral 8x7B</option>
                    </select>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
                    <!-- Max Tokens -->
                    <div>
                        <label style="${T.label}">Max Tokens</label>
                        <input id="s-max-tokens" type="number" value="${s.max_tokens || 150}" min="50" max="500" style="${T.input}" />
                    </div>
                    <!-- Temperature -->
                    <div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                            <label style="${T.label}margin-bottom:0;">Temperature</label>
                            <span id="temp-val" style="font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:700;color:#85d3dc;">${tempVal}</span>
                        </div>
                        <input type="range" id="s-temperature" min="0" max="1" step="0.01" value="${tempVal}"
                               style="width:100%;height:4px;border-radius:2px;background:#45464d;outline:none;-webkit-appearance:none;cursor:pointer;accent-color:#4f8eff;"
                               oninput="document.getElementById('temp-val').textContent=this.value" />
                        <p style="font-size:12px;color:#909097;margin:6px 0 0;">Lower = more focused, Higher = more creative</p>
                    </div>
                </div>

                <!-- System Prompt -->
                <div>
                    <label style="${T.label}">Custom System Prompt</label>
                    <textarea id="s-custom-prompt" rows="6" placeholder="You are an AI assistant..."
                              style="${T.input}resize:vertical;min-height:120px;">${esc(s.custom_system_prompt || '')}</textarea>
                    <p style="font-size:12px;color:#909097;margin:6px 0 0;">Advanced -- override Mark's entire personality.</p>
                </div>

                <!-- Save -->
                <div style="padding-top:24px;border-top:1px solid rgba(0,119,255,0.15);display:flex;justify-content:flex-end;">
                    <button style="${T.btnGradient}" onclick="markAdmin.saveAI()"
                            onmouseenter="this.style.boxShadow='0 0 25px rgba(79,142,255,0.4)'"
                            onmouseleave="this.style.boxShadow='0 0 15px rgba(79,142,255,0.2)'">
                        Save AI Config
                    </button>
                </div>
            </div>
        </div>`;
    }

    async function saveAI() {
        const data = {
            groq_api_key:         $('#s-groq-key').value,
            llm_model:            $('#s-llm-model').value,
            max_tokens:           parseInt($('#s-max-tokens').value) || 150,
            temperature:          parseFloat($('#s-temperature').value) || 0.72,
            custom_system_prompt: $('#s-custom-prompt').value,
        };
        try {
            await api('PUT', 'stores/' + currentStore.store_id, data);
            currentStore = { ...currentStore, ...data };
            toast('AI configuration saved!', 'success');
        } catch (e) { toast(e.message, 'error'); }
    }

    /* ================================================================
       TAB: CONVERSATIONS
       ================================================================ */
    async function loadConversationsTab(storeId) {
        const container = $('#tab-content');
        container.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;color:#aec6ff;padding:40px;">
            <span class="material-symbols-outlined" style="animation:markSpin 1s linear infinite;font-size:24px;">progress_activity</span>
            <span style="font-size:14px;">Loading conversations...</span>
        </div>`;

        try {
            const [analyticsData, convosData] = await Promise.all([
                api('GET', 'stores/' + storeId + '/analytics'),
                api('GET', 'stores/' + storeId + '/conversations'),
            ]);

            const convos = convosData.conversations || [];

            container.innerHTML = `
            <!-- Stats -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px;margin-bottom:32px;">
                ${renderMiniStat('Total', analyticsData.total_conversations, 'forum')}
                ${renderMiniStat('Today', analyticsData.today, 'today')}
                ${renderMiniStat('This Week', analyticsData.this_week, 'date_range')}
                ${renderMiniStat('Unique Visitors', analyticsData.unique_visitors, 'person')}
            </div>

            <!-- Table -->
            <div style="${T.glass}padding:24px;overflow-x:auto;">
                <h3 style="${T.headline}font-size:20px;margin:0 0 20px;">Recent Conversations</h3>
                ${convos.length === 0
                    ? '<p style="color:#909097;font-size:14px;">No conversations yet.</p>'
                    : `<table style="width:100%;border-collapse:separate;border-spacing:0;">
                        <thead>
                            <tr>
                                ${['Visitor','Language','User Message',"Mark's Response",'Time'].map(h =>
                                    `<th style="text-align:left;padding:12px 16px;font-family:'Space Grotesk',sans-serif;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:#c6c6cd;border-bottom:1px solid rgba(69,70,77,0.5);font-weight:700;">${h}</th>`
                                ).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${convos.map(c => `
                            <tr style="transition:background 0.2s;" onmouseenter="this.style.background='rgba(174,198,255,0.03)'" onmouseleave="this.style.background='transparent'">
                                <td style="padding:14px 16px;border-bottom:1px solid rgba(69,70,77,0.2);font-family:monospace;font-size:12px;color:#909097;">${esc((c.visitor_hash || '').substring(0, 8))}</td>
                                <td style="padding:14px 16px;border-bottom:1px solid rgba(69,70,77,0.2);">
                                    <span style="${T.badgeActive}padding:2px 8px;font-size:10px;">${esc(c.language || 'en')}</span>
                                </td>
                                <td style="padding:14px 16px;border-bottom:1px solid rgba(69,70,77,0.2);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;">${esc(c.last_user_msg)}</td>
                                <td style="padding:14px 16px;border-bottom:1px solid rgba(69,70,77,0.2);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:#c6c6cd;">${esc(c.mark_response)}</td>
                                <td style="padding:14px 16px;border-bottom:1px solid rgba(69,70,77,0.2);font-size:12px;color:#909097;white-space:nowrap;">${formatDate(c.created_at)}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>`
                }
            </div>`;
        } catch (e) {
            container.innerHTML = `<div style="text-align:center;padding:40px;color:#909097;">
                <p>Failed to load conversations: ${esc(e.message)}</p>
            </div>`;
        }
    }

    /* ================================================================
       TAB: EMBED CODE
       ================================================================ */
    async function loadEmbedTab(storeId) {
        const container = $('#tab-content');
        container.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;color:#aec6ff;padding:40px;">
            <span class="material-symbols-outlined" style="animation:markSpin 1s linear infinite;font-size:24px;">progress_activity</span>
            <span style="font-size:14px;">Loading embed code...</span>
        </div>`;

        try {
            const data = await api('GET', 'stores/' + storeId + '/embed');

            container.innerHTML = `
            <div style="max-width:900px;">
                <!-- Script Embed -->
                <div style="margin-bottom:48px;">
                    <h3 style="${T.headline}font-size:24px;margin:0 0 8px;">Script Embed</h3>
                    <p style="color:#909097;font-size:14px;margin:0 0 20px;">
                        Paste this code before the closing &lt;/body&gt; tag on every page you want the widget to appear.
                    </p>
                    <div style="position:relative;">
                        <div style="position:absolute;top:12px;right:12px;z-index:2;">
                            <button style="background:rgba(2,6,23,0.8);color:#22d3ee;border:1px solid rgba(0,119,255,0.3);border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px;backdrop-filter:blur(8px);transition:all 0.2s;font-family:'Inter',sans-serif;"
                                    onclick="markAdmin.copyCode('embed-script-code')"
                                    onmouseenter="this.style.background='rgba(30,58,138,0.5)'"
                                    onmouseleave="this.style.background='rgba(2,6,23,0.8)'">
                                <span class="material-symbols-outlined" style="font-size:14px;">content_copy</span> Copy
                            </button>
                        </div>
                        <pre id="embed-script-code" style="background:#020617;border-bottom:1px solid rgba(0,119,255,0.5);box-shadow:inset 0 2px 10px rgba(0,0,0,0.5);padding:24px;border-radius:12px;color:#22d3ee;font-family:monospace;font-size:14px;line-height:1.6;overflow-x:auto;white-space:pre;margin:0;">${esc(data.embed_script)}</pre>
                    </div>
                </div>

                <!-- Store ID -->
                <div style="${T.glass}padding:24px;">
                    <h3 style="${T.headline}font-size:24px;margin:0 0 8px;">Store ID</h3>
                    <p style="color:#909097;font-size:14px;margin:0 0 20px;">Use this ID to identify your store in manual API calls or custom integrations.</p>
                    <div style="display:flex;align-items:center;gap:16px;">
                        <input type="text" readonly value="${esc(storeId)}"
                               style="background:#020617;border:none;border-bottom:1px solid rgba(0,119,255,0.5);color:#22d3ee;font-family:monospace;font-size:16px;padding:12px;flex:1;max-width:400px;outline:none;border-radius:2px 2px 0 0;" />
                        <button style="background:linear-gradient(to right,rgba(30,58,138,0.2),rgba(34,211,238,0.2));color:#22d3ee;border:1px solid rgba(0,119,255,0.5);border-radius:8px;padding:12px 20px;cursor:pointer;display:flex;align-items:center;gap:8px;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14px;transition:all 0.2s;"
                                onclick="markAdmin.copyText('${esc(storeId)}')"
                                onmouseenter="this.style.background='linear-gradient(to right,rgba(30,58,138,0.4),rgba(34,211,238,0.4))'"
                                onmouseleave="this.style.background='linear-gradient(to right,rgba(30,58,138,0.2),rgba(34,211,238,0.2))'">
                            <span class="material-symbols-outlined" style="font-size:18px;">content_copy</span> Copy ID
                        </button>
                    </div>
                </div>
            </div>`;
        } catch (e) {
            container.innerHTML = `<div style="text-align:center;padding:40px;color:#909097;">
                <p>Failed to load embed code: ${esc(e.message)}</p>
            </div>`;
        }
    }

    function copyCode(elementId) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const text = el.textContent;
        navigator.clipboard.writeText(text).then(() => {
            toast('Copied to clipboard!', 'success');
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            toast('Copied to clipboard!', 'success');
        });
    }

    function copyText(text) {
        navigator.clipboard.writeText(text).then(() => {
            toast('Copied to clipboard!', 'success');
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            toast('Copied to clipboard!', 'success');
        });
    }

    /* ================================================================
       DELETE STORE
       ================================================================ */
    function confirmDelete() {
        const container = $('#mark-modal-container');
        container.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;"
             onclick="markAdmin.closeModal(event)">
            <div style="background:#1d2022;border:1px solid rgba(255,180,171,0.2);border-radius:16px;padding:40px;width:90%;max-width:440px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.5);"
                 onclick="event.stopPropagation()">
                <span class="material-symbols-outlined" style="font-size:56px;color:#ffb4ab;margin-bottom:16px;">warning</span>
                <h2 style="${T.headline}font-size:24px;color:#ffb4ab;margin:0 0 8px;">Delete Store?</h2>
                <p style="color:#c6c6cd;font-size:14px;margin:0 0 28px;line-height:1.6;">
                    This will permanently delete <strong style="color:#e0e3e5;">${esc(currentStore.store_name)}</strong> and all its conversations. This action cannot be undone.
                </p>
                <div style="display:flex;gap:12px;justify-content:center;">
                    <button style="${T.btnSecondary}" onclick="markAdmin.closeModal()">Cancel</button>
                    <button style="${T.btnDanger}" onclick="markAdmin.deleteStore()">
                        <span class="material-symbols-outlined" style="font-size:18px;">delete_forever</span> Delete
                    </button>
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
            navigate('dashboard');
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    /* ================================================================
       PAGE: CONVERSATIONS (Global)
       ================================================================ */
    async function loadConversationsPage() {
        const content = $('#mark-page-content');
        try {
            const data = await api('GET', 'dashboard');
            const allStores = data.stores || [];

            if (allStores.length === 0) {
                content.innerHTML = `
                <div style="margin-bottom:32px;">
                    <h1 style="${T.headline}font-size:48px;line-height:1.1;letter-spacing:-0.02em;margin:0 0 8px;">Conversations</h1>
                    <p style="color:#c6c6cd;font-size:18px;margin:0;">View and manage all customer conversations.</p>
                </div>
                ${renderEmptyState()}`;
                return;
            }

            content.innerHTML = `
            <div style="margin-bottom:32px;">
                <h1 style="${T.headline}font-size:48px;line-height:1.1;letter-spacing:-0.02em;margin:0 0 8px;">Conversations</h1>
                <p style="color:#c6c6cd;font-size:18px;margin:0;">Select a store to view its conversations.</p>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">
                ${allStores.map(s => `
                <div style="${T.glass}padding:24px;cursor:pointer;transition:all 0.3s;"
                     onclick="markAdmin.openStoreConversations('${s.store_id}')"
                     onmouseenter="this.style.boxShadow='${T.cardHoverShadow}';this.style.borderColor='${T.cardHoverBorder}'"
                     onmouseleave="this.style.boxShadow='inset 1px 1px 0px 0px rgba(255,255,255,0.1)';this.style.borderColor='rgba(0,119,255,0.3)'">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <span class="material-symbols-outlined" style="color:#22d3ee;font-size:24px;">forum</span>
                        <div>
                            <h3 style="${T.headline}font-size:18px;margin:0;">${esc(s.store_name)}</h3>
                            <p style="font-size:12px;color:#909097;margin:4px 0 0;">Click to view conversations</p>
                        </div>
                    </div>
                </div>`).join('')}
            </div>`;
        } catch (e) {
            content.innerHTML = `<div style="text-align:center;padding:60px;color:#909097;">
                <p>${esc(e.message)}</p>
            </div>`;
        }
    }

    async function openStoreConversations(storeId) {
        try {
            const data = await api('GET', 'stores/' + storeId);
            currentStore = data.store || data;
            activeTab = 'conversations';

            renderStoreDetail();
        } catch (e) {
            toast(e.message, 'error');
        }
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
            <!-- Header -->
            <div style="margin-bottom:40px;">
                <h1 style="${T.headline}font-size:48px;line-height:1.1;letter-spacing:-0.02em;margin:0 0 8px;">Settings</h1>
                <p style="color:#c6c6cd;font-size:18px;margin:0;">Global configuration for all Mark AI stores.</p>
            </div>

            <!-- Groq API Key -->
            <div style="${T.glass}padding:32px;margin-bottom:24px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;">
                    <span class="material-symbols-outlined" style="font-size:20px;color:#aec6ff;">key</span>
                    <h3 style="${T.headline}font-size:24px;margin:0;">API Keys</h3>
                </div>
                <div style="max-width:600px;">
                    <label style="${T.label}">Groq API Key (Global Default)</label>
                    <div style="position:relative;">
                        <input id="g-groq-key" type="password" value="${esc(s.groq_api_key || '')}"
                               placeholder="gsk_..." style="${T.input}" />
                        <span class="material-symbols-outlined" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#909097;cursor:pointer;font-size:20px;"
                              onclick="const i=document.getElementById('g-groq-key');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'visibility_off':'visibility'">visibility_off</span>
                    </div>
                    <p style="font-size:12px;color:#909097;margin:8px 0 0;">
                        Used by all stores that don't have their own key. Get one free at
                        <a href="https://console.groq.com" target="_blank" style="color:#aec6ff;text-decoration:none;">console.groq.com</a>
                    </p>
                </div>
            </div>

            <!-- Default Voice -->
            <div style="${T.glass}padding:32px;margin-bottom:24px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;">
                    <span class="material-symbols-outlined" style="font-size:20px;color:#aec6ff;">record_voice_over</span>
                    <h3 style="${T.headline}font-size:24px;margin:0;">Default Voice (Edge TTS)</h3>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;max-width:600px;">
                    <div>
                        <label style="${T.label}">English Voice</label>
                        <select id="g-voice-en" style="${T.select}">
                            <option value="en-US-GuyNeural" ${s.default_voice === 'en-US-GuyNeural' ? 'selected' : ''}>Guy (Male)</option>
                            <option value="en-US-AriaNeural" ${s.default_voice === 'en-US-AriaNeural' ? 'selected' : ''}>Aria (Female)</option>
                            <option value="en-US-DavisNeural" ${s.default_voice === 'en-US-DavisNeural' ? 'selected' : ''}>Davis (Male)</option>
                            <option value="en-US-JennyNeural" ${s.default_voice === 'en-US-JennyNeural' ? 'selected' : ''}>Jenny (Female)</option>
                        </select>
                    </div>
                    <div>
                        <label style="${T.label}">Urdu Voice</label>
                        <select id="g-voice-ur" style="${T.select}">
                            <option value="ur-PK-AsadNeural" ${s.default_voice_ur === 'ur-PK-AsadNeural' ? 'selected' : ''}>Asad (Male)</option>
                            <option value="ur-PK-UzmaNeural" ${s.default_voice_ur === 'ur-PK-UzmaNeural' ? 'selected' : ''}>Uzma (Female)</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Widget Settings -->
            <div style="${T.glass}padding:32px;margin-bottom:32px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;">
                    <span class="material-symbols-outlined" style="font-size:20px;color:#aec6ff;">widgets</span>
                    <h3 style="${T.headline}font-size:24px;margin:0;">Widget Settings</h3>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;max-width:600px;">
                    <div>
                        <label style="${T.label}">Widget Enabled</label>
                        <select id="g-widget-enabled" style="${T.select}">
                            <option value="1" ${s.widget_enabled !== false && s.widget_enabled !== '0' ? 'selected' : ''}>Yes</option>
                            <option value="0" ${s.widget_enabled === false || s.widget_enabled === '0' ? 'selected' : ''}>No</option>
                        </select>
                    </div>
                    <div>
                        <label style="${T.label}">Position</label>
                        <select id="g-widget-position" style="${T.select}">
                            <option value="bottom-right" ${s.widget_position === 'bottom-right' || !s.widget_position ? 'selected' : ''}>Bottom Right</option>
                            <option value="bottom-left" ${s.widget_position === 'bottom-left' ? 'selected' : ''}>Bottom Left</option>
                        </select>
                    </div>
                    <div>
                        <label style="${T.label}">Auto Greet</label>
                        <select id="g-auto-greet" style="${T.select}">
                            <option value="1" ${s.auto_greet !== false && s.auto_greet !== '0' ? 'selected' : ''}>Yes</option>
                            <option value="0" ${s.auto_greet === false || s.auto_greet === '0' ? 'selected' : ''}>No</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Test Connection -->
            <div style="${T.glass}padding:32px;margin-bottom:32px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;">
                    <span class="material-symbols-outlined" style="font-size:20px;color:#aec6ff;">cable</span>
                    <h3 style="${T.headline}font-size:24px;margin:0;">Connection Test</h3>
                </div>
                <p style="color:#c6c6cd;font-size:14px;margin:0 0 16px;">Verify your Groq API key is working correctly.</p>
                <button style="${T.btnSecondary}" onclick="markAdmin.testConnection()" id="test-conn-btn">
                    <span class="material-symbols-outlined" style="font-size:18px;">power</span> Test Groq Connection
                </button>
                <div id="conn-test-result" style="margin-top:12px;"></div>
            </div>

            <!-- Save -->
            <button style="${T.btnGradient}padding:14px 32px;" onclick="markAdmin.saveGlobalSettings()"
                    onmouseenter="this.style.boxShadow='0 0 25px rgba(79,142,255,0.4)';this.style.transform='translateY(-2px)'"
                    onmouseleave="this.style.boxShadow='0 0 15px rgba(79,142,255,0.2)';this.style.transform='translateY(0)'">
                Save All Settings
            </button>
            `;
        } catch (e) {
            content.innerHTML = `<div style="text-align:center;padding:60px;color:#909097;">
                <span class="material-symbols-outlined" style="font-size:48px;opacity:0.3;">error</span>
                <p style="margin:16px 0;">Failed to load settings: ${esc(e.message)}</p>
                <button style="${T.btnSecondary}" onclick="markAdmin.navigate('settings')">
                    <span class="material-symbols-outlined" style="font-size:18px;">refresh</span> Retry
                </button>
            </div>`;
        }
    }

    async function saveGlobalSettings() {
        const data = {
            groq_api_key:    $('#g-groq-key').value.trim(),
            default_voice:   $('#g-voice-en').value,
            default_voice_ur: $('#g-voice-ur').value,
            widget_enabled:  $('#g-widget-enabled').value,
            widget_position: $('#g-widget-position').value,
            auto_greet:      $('#g-auto-greet').value,
        };
        try {
            await api('POST', 'settings', data);
            toast('Global settings saved!', 'success');
        } catch (e) { toast(e.message, 'error'); }
    }

    async function testConnection() {
        const btn = $('#test-conn-btn');
        const result = $('#conn-test-result');
        if (btn) btn.disabled = true;
        if (result) result.innerHTML = `<span style="color:#aec6ff;font-size:13px;display:flex;align-items:center;gap:8px;"><span class="material-symbols-outlined" style="animation:markSpin 1s linear infinite;font-size:16px;">progress_activity</span> Testing...</span>`;

        try {
            const data = await api('POST', 'test-connection');
            if (data.connected) {
                result.innerHTML = `<span style="color:#34d399;font-size:13px;display:flex;align-items:center;gap:8px;"><span class="material-symbols-outlined" style="font-size:16px;">check_circle</span> ${esc(data.message)}</span>`;
            } else {
                result.innerHTML = `<span style="color:#ffb4ab;font-size:13px;display:flex;align-items:center;gap:8px;"><span class="material-symbols-outlined" style="font-size:16px;">error</span> ${esc(data.error)}</span>`;
            }
        } catch (e) {
            result.innerHTML = `<span style="color:#ffb4ab;font-size:13px;">${esc(e.message)}</span>`;
        }
        if (btn) btn.disabled = false;
    }

    /* ================================================================
       MODAL HELPER
       ================================================================ */
    function closeModal(event) {
        if (event && event.target !== event.currentTarget) return;
        const container = $('#mark-modal-container');
        if (container) container.innerHTML = '';
    }

    /* ================================================================
       PUBLIC API (exposed to onclick handlers)
       ================================================================ */
    window.markAdmin = {
        navigate,
        filterStores,
        showAddStore,
        createStore,
        openStore,
        openStoreConversations,
        switchTab,
        saveStoreSettings,
        saveVoice,
        testVoice,
        saveAI,
        confirmDelete,
        deleteStore,
        copyCode,
        copyText,
        closeModal,
        saveGlobalSettings,
        testConnection,
    };

    /* ================================================================
       BOOT
       ================================================================ */
    function boot() {
        if ($('#mark-ai-app')) renderAppShell();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
