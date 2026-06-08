<?php
/**
 * Mark AI — WordPress REST API
 * All REST endpoints for admin dashboard + public chat.
 * Security hardened: rate limiting, input validation, output escaping.
 */

defined('ABSPATH') || exit;

class Mark_AI_Rest_API {

    /** Rate limits — per IP per window */
    private const CHAT_RATE_LIMIT    = 20;   // chat messages
    private const CHAT_RATE_WINDOW   = 60;   // seconds
    private const GLOBAL_RATE_LIMIT  = 100;  // all requests combined
    private const GLOBAL_RATE_WINDOW = 300;  // 5 minutes

    /** Input constraints */
    private const MAX_MESSAGE_LENGTH = 2000;
    private const MAX_HISTORY_ITEMS  = 14;
    private const MAX_STORE_ID_LEN   = 32;

    public function __construct() {
        add_action('rest_api_init', [$this, 'register_routes']);
    }

    public function register_routes() {

        // Dashboard
        register_rest_route('mark-ai/v1', '/dashboard', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_dashboard'],
            'permission_callback' => [$this, 'admin_check'],
        ]);

        // Settings
        register_rest_route('mark-ai/v1', '/settings', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_settings'],
            'permission_callback' => [$this, 'admin_check'],
        ]);
        register_rest_route('mark-ai/v1', '/settings', [
            'methods'             => 'POST',
            'callback'            => [$this, 'save_settings'],
            'permission_callback' => [$this, 'admin_check'],
        ]);

        // Stores CRUD
        register_rest_route('mark-ai/v1', '/stores', [
            'methods'             => 'GET',
            'callback'            => [$this, 'list_stores'],
            'permission_callback' => [$this, 'admin_check'],
        ]);
        register_rest_route('mark-ai/v1', '/stores', [
            'methods'             => 'POST',
            'callback'            => [$this, 'create_store'],
            'permission_callback' => [$this, 'admin_check'],
        ]);
        register_rest_route('mark-ai/v1', '/stores/(?P<store_id>[a-zA-Z0-9]+)', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_store'],
            'permission_callback' => [$this, 'admin_check'],
        ]);
        register_rest_route('mark-ai/v1', '/stores/(?P<store_id>[a-zA-Z0-9]+)', [
            'methods'             => 'PUT',
            'callback'            => [$this, 'update_store'],
            'permission_callback' => [$this, 'admin_check'],
        ]);
        register_rest_route('mark-ai/v1', '/stores/(?P<store_id>[a-zA-Z0-9]+)', [
            'methods'             => 'DELETE',
            'callback'            => [$this, 'delete_store'],
            'permission_callback' => [$this, 'admin_check'],
        ]);

        // Analytics
        register_rest_route('mark-ai/v1', '/stores/(?P<store_id>[a-zA-Z0-9]+)/analytics', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_store_analytics'],
            'permission_callback' => [$this, 'admin_check'],
        ]);

        // Conversations
        register_rest_route('mark-ai/v1', '/stores/(?P<store_id>[a-zA-Z0-9]+)/conversations', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_conversations'],
            'permission_callback' => [$this, 'admin_check'],
        ]);

        // Chart data for analytics
        register_rest_route('mark-ai/v1', '/chart-data', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_chart_data'],
            'permission_callback' => [$this, 'admin_check'],
        ]);

        // Test Groq API connection
        register_rest_route('mark-ai/v1', '/test-connection', [
            'methods'             => 'POST',
            'callback'            => [$this, 'test_connection'],
            'permission_callback' => [$this, 'admin_check'],
        ]);

        // Public Chat endpoint (frontend widget uses this)
        register_rest_route('mark-ai/v1', '/chat', [
            'methods'             => 'POST',
            'callback'            => [$this, 'handle_chat'],
            'permission_callback' => '__return_true', // Public — visitors can chat
        ]);
    }

    public function admin_check() {
        return current_user_can('manage_options');
    }

    // ── Rate Limiter (for public endpoints) ─────────────

    /**
     * Check and enforce rate limit using transients.
     * Returns true if request is allowed, false if rate-limited.
     */
    private function check_rate_limit( $identifier, $max_requests = 20, $window = 60 ) {
        $key   = 'mark_rl_' . md5( $identifier );
        $data  = get_transient( $key );

        if ( false === $data ) {
            set_transient( $key, [ 'count' => 1, 'start' => time() ], $window );
            return true;
        }

        if ( $data['count'] >= $max_requests ) {
            return false;
        }

        $data['count']++;
        $remaining = $window - ( time() - $data['start'] );
        if ( $remaining > 0 ) {
            set_transient( $key, $data, $remaining );
        }
        return true;
    }

    /**
     * Get visitor IP safely.
     * Uses REMOTE_ADDR (not spoofable) as primary source.
     * X-Forwarded-For is client-controlled and NOT trusted for rate limiting.
     */
    private function get_visitor_ip() {
        $ip = '';
        if ( ! empty( $_SERVER['REMOTE_ADDR'] ) ) {
            $ip = sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) );
        }
        return filter_var( $ip, FILTER_VALIDATE_IP ) ? $ip : '0.0.0.0';
    }

    // ── Caching Helpers ──────────────────────────────────

    /**
     * Get cached data or run callback to generate and cache it.
     * Uses WordPress transients — auto-expires.
     */
    private function cached( $key, $ttl, $callback ) {
        $cache_key = 'mark_cache_' . $key;
        $cached    = get_transient( $cache_key );
        if ( false !== $cached ) {
            return $cached;
        }
        $result = $callback();
        set_transient( $cache_key, $result, $ttl );
        return $result;
    }

    /**
     * Bust cache for a specific key (call after data changes).
     */
    private function bust_cache( $key ) {
        delete_transient( 'mark_cache_' . $key );
    }

    // ── Dashboard ───────────────────────────────────────

    public function get_dashboard() {
        // Cache dashboard data for 2 minutes
        $data = $this->cached( 'dashboard', 120, function() {
            $stats  = Mark_AI_Database::get_dashboard_stats();
            $stores = Mark_AI_Database::get_stores();

            $store_list = [];
            foreach ($stores as $store) {
                $store_list[] = [
                    'store_id'       => $store['store_id'],
                    'store_name'     => $store['store_name'],
                    'website_url'    => $store['website_url'],
                    'assistant_name' => $store['assistant_name'],
                    'is_active'      => (bool) $store['is_active'],
                ];
            }

            $stats['stores'] = $store_list;

            $settings = get_option('mark_ai_settings', []);
            $stats['setup_complete'] = ! empty( $settings['groq_api_key'] ) && count( $store_list ) > 0;
            $stats['has_api_key']    = ! empty( $settings['groq_api_key'] );

            return $stats;
        });

        return new WP_REST_Response( $data, 200 );
    }

    // ── Settings ────────────────────────────────────────

    public function get_settings() {
        $settings = get_option('mark_ai_settings', []);
        // Never expose full API key in response — mask it
        if (!empty($settings['groq_api_key'])) {
            $key = $settings['groq_api_key'];
            $settings['groq_api_key_masked'] = substr($key, 0, 8) . '...' . substr($key, -4);
            $settings['groq_api_key'] = ''; // Never send full key over HTTP
            $settings['has_groq_key'] = true;
        } else {
            $settings['has_groq_key'] = false;
        }

        // Published pages/posts the owner can target Mark to (visibility rules).
        $available = [];
        $posts = get_posts([
            'post_type'   => [ 'page', 'post' ],
            'post_status' => 'publish',
            'numberposts' => 200,
            'orderby'     => 'title',
            'order'       => 'ASC',
        ]);
        foreach ( $posts as $p ) {
            $available[] = [
                'id'    => $p->ID,
                'title' => $p->post_title !== '' ? $p->post_title : ( '#' . $p->ID ),
                'type'  => $p->post_type,
            ];
        }
        $settings['available_pages'] = $available;
        if ( ! isset( $settings['widget_display_mode'] ) ) {
            $settings['widget_display_mode'] = 'all';
        }
        if ( ! isset( $settings['widget_display_pages'] ) || ! is_array( $settings['widget_display_pages'] ) ) {
            $settings['widget_display_pages'] = [];
        }

        return new WP_REST_Response($settings, 200);
    }

    public function save_settings(WP_REST_Request $request) {
        $body    = $request->get_json_params();
        $current = get_option('mark_ai_settings', []);

        $allowed = [
            'groq_api_key', 'default_voice',
            'tts_rate', 'tts_pitch', 'llm_model', 'max_tokens', 'temperature',
            'widget_enabled', 'widget_position', 'auto_greet', 'primary_language',
            'widget_accent_color', 'greeting_sound_text', 'idle_timeout',
            'name_celebrate_text', 'widget_display_mode',
        ];

        foreach ($allowed as $key) {
            if (isset($body[$key])) {
                $value = $body[$key];

                // Type-specific sanitization
                if ( $key === 'idle_timeout' ) {
                    $value = max( 15, min( 600, intval( $value ) ) );
                } elseif ( in_array( $key, [ 'max_tokens', 'temperature' ], true ) ) {
                    $value = is_numeric( $value ) ? $value : $current[ $key ] ?? '';
                } elseif ( $key === 'widget_accent_color' ) {
                    $value = sanitize_hex_color( $value ) ?: '';
                } elseif ( $key === 'widget_position' ) {
                    $value = sanitize_text_field( $value );
                } elseif ( $key === 'widget_display_mode' ) {
                    $value = in_array( $value, [ 'all', 'include', 'exclude' ], true ) ? $value : 'all';
                } elseif ( $key === 'groq_api_key' ) {
                    // Only update if a real key is provided (not masked)
                    if ( strpos( $value, '...' ) !== false || empty( $value ) ) {
                        continue; // Skip — don't overwrite with masked value
                    }
                    $value = sanitize_text_field( $value );
                } else {
                    $value = sanitize_text_field( $value );
                }

                $current[$key] = $value;
            }
        }

        // Page-visibility list (array of page IDs) — sanitize to unique ints.
        if ( isset( $body['widget_display_pages'] ) && is_array( $body['widget_display_pages'] ) ) {
            $current['widget_display_pages'] = array_values( array_unique( array_map( 'intval', $body['widget_display_pages'] ) ) );
        }

        update_option('mark_ai_settings', $current);
        $this->bust_cache( 'dashboard' );

        // Sync Groq API key to backend if we have a token
        if (!empty($current['api_token']) && !empty($current['remote_store_id']) && isset($body['groq_api_key'])) {
            $this->sync_key_to_backend($current);
        }

        return new WP_REST_Response(['message' => 'Settings saved!', 'settings' => $current], 200);
    }

    // ── Stores ──────────────────────────────────────────

    public function list_stores() {
        $stores = Mark_AI_Database::get_stores();
        foreach ($stores as &$s) {
            // Never expose API keys in list
            if (!empty($s['groq_api_key'])) {
                $s['groq_api_key'] = substr($s['groq_api_key'], 0, 8) . '...' . substr($s['groq_api_key'], -4);
            }
        }
        return new WP_REST_Response(['stores' => $stores], 200);
    }

    public function create_store(WP_REST_Request $request) {
        $body = $request->get_json_params();

        if (empty($body['store_name']) || empty($body['website_url'])) {
            return new WP_REST_Response(['message' => 'Store name and website URL are required.'], 400);
        }

        $data = [
            'store_name'     => sanitize_text_field($body['store_name']),
            'website_url'    => esc_url_raw($body['website_url']),
            'assistant_name' => sanitize_text_field($body['assistant_name'] ?? 'Mark'),
        ];

        $store_id = Mark_AI_Database::create_store($data);

        // Trigger RAG crawl on backend immediately
        $this->trigger_rag_crawl($store_id, $data['website_url']);

        return new WP_REST_Response(['store_id' => $store_id, 'message' => 'Store created!'], 201);
    }

    public function get_store(WP_REST_Request $request) {
        $store_id = sanitize_text_field( $request->get_param('store_id') );
        $store    = Mark_AI_Database::get_store($store_id);

        if (!$store || (int) $store['owner_id'] !== get_current_user_id()) {
            return new WP_REST_Response(['message' => 'Store not found'], 404);
        }

        // Never return the raw Groq key in the response — mask it (the AI Config
        // tab shows the masked value; a real key is only sent on save).
        if (!empty($store['groq_api_key'])) {
            $key = $store['groq_api_key'];
            $store['groq_api_key_masked'] = strlen($key) > 12
                ? substr($key, 0, 8) . '...' . substr($key, -4) : '***';
            $store['groq_api_key'] = '';
        }

        return new WP_REST_Response(['store' => $store], 200);
    }

    public function update_store(WP_REST_Request $request) {
        $store_id = sanitize_text_field( $request->get_param('store_id') );
        $store    = Mark_AI_Database::get_store($store_id);

        if (!$store || (int) $store['owner_id'] !== get_current_user_id()) {
            return new WP_REST_Response(['message' => 'Store not found'], 404);
        }

        $body = $request->get_json_params();

        $allowed = [
            'store_name', 'website_url', 'assistant_name', 'personality',
            'greeting_style', 'primary_language', 'supported_languages',
            'max_crawl_pages', 'idle_timeout', 'walking_enabled', 'sound_effects',
            'tts_voice', 'tts_rate', 'tts_pitch',
            'groq_api_key', 'llm_model', 'max_tokens', 'temperature',
            'rate_chat', 'rate_tts', 'rate_transcribe',
            'custom_system_prompt', 'is_active',
            // Sales Skills fields
            'sales_behavior', 'sales_no_discounts', 'sales_no_price_promises',
            'sales_no_guarantees', 'sales_objection_style',
            'sales_lead_capture', 'sales_cta_url', 'sales_cta_text',
            // Widget size scale (1-10)
            'widget_scale_desktop', 'widget_scale_mobile',
            // Mark Training fields
            'brand_description', 'priority_products', 'seasonal_products',
        ];

        $updates = [];
        foreach ($allowed as $key) {
            if (isset($body[$key])) {
                $value = $body[$key];

                // Type-specific validation
                if ( in_array( $key, [ 'widget_scale_desktop', 'widget_scale_mobile' ], true ) ) {
                    $value = max( 1, min( 10, intval( $value ) ) );
                } elseif ( in_array( $key, [ 'max_crawl_pages', 'idle_timeout', 'max_tokens', 'rate_chat', 'rate_tts', 'rate_transcribe' ], true ) ) {
                    $value = max( 1, intval( $value ) );
                } elseif ( $key === 'temperature' ) {
                    $value = max( 0.0, min( 2.0, floatval( $value ) ) );
                } elseif ( $key === 'is_active' ) {
                    $value = $value ? 1 : 0;
                } elseif ( $key === 'website_url' ) {
                    $value = esc_url_raw( $value );
                } elseif ( in_array( $key, [ 'custom_system_prompt', 'brand_description', 'priority_products', 'seasonal_products' ], true ) ) {
                    $value = wp_kses_post( $value );
                } elseif ( $key === 'groq_api_key' ) {
                    // Don't overwrite with masked value
                    if ( strpos( $value, '...' ) !== false ) continue;
                    $value = sanitize_text_field( $value );
                } else {
                    $value = is_string( $value ) ? sanitize_text_field( $value ) : $value;
                }

                $updates[$key] = $value;
            }
        }

        if (!empty($updates)) {
            Mark_AI_Database::update_store($store_id, $updates);
        }

        // If website URL changed, trigger RAG re-crawl
        if (!empty($updates['website_url'])) {
            $this->trigger_rag_crawl($store_id, $updates['website_url']);
        }

        $this->bust_cache( 'dashboard' );
        return new WP_REST_Response(['message' => 'Store updated!', 'store_id' => $store_id], 200);
    }

    public function delete_store(WP_REST_Request $request) {
        $store_id = sanitize_text_field( $request->get_param('store_id') );
        $store    = Mark_AI_Database::get_store($store_id);

        if (!$store || (int) $store['owner_id'] !== get_current_user_id()) {
            return new WP_REST_Response(['message' => 'Store not found'], 404);
        }

        Mark_AI_Database::delete_store($store_id);
        return new WP_REST_Response(['message' => 'Store deleted', 'store_id' => $store_id], 200);
    }

    // ── Analytics ───────────────────────────────────────

    public function get_store_analytics(WP_REST_Request $request) {
        $store_id = sanitize_text_field( $request->get_param('store_id') );
        $store    = Mark_AI_Database::get_store($store_id);

        if (!$store || (int) $store['owner_id'] !== get_current_user_id()) {
            return new WP_REST_Response(['message' => 'Store not found'], 404);
        }

        return new WP_REST_Response(Mark_AI_Database::get_analytics($store_id), 200);
    }

    // ── Conversations ──────────────────────────────────

    public function get_conversations(WP_REST_Request $request) {
        $store_id = sanitize_text_field( $request->get_param('store_id') );
        $store    = Mark_AI_Database::get_store($store_id);

        if (!$store || (int) $store['owner_id'] !== get_current_user_id()) {
            return new WP_REST_Response(['message' => 'Store not found'], 404);
        }

        $limit  = min( 100, max( 1, intval( $request->get_param('limit') ?? 50 ) ) );
        $offset = max( 0, intval( $request->get_param('offset') ?? 0 ) );

        $convos = Mark_AI_Database::get_conversations($store_id, $limit, $offset);
        return new WP_REST_Response(['conversations' => $convos], 200);
    }

    // ── Chart Data (Analytics) ────────────────────────

    public function get_chart_data( WP_REST_Request $request ) {
        $days = min( 90, max( 7, intval( $request->get_param('days') ?? 14 ) ) );

        $stores    = Mark_AI_Database::get_stores();
        $store_ids = array_column( $stores, 'store_id' );

        $daily  = Mark_AI_Database::get_daily_conversations( $store_ids, $days );
        $hourly = Mark_AI_Database::get_hourly_distribution( $store_ids );

        return new WP_REST_Response([
            'daily'  => $daily,
            'hourly' => $hourly,
            'days'   => $days,
        ], 200);
    }

    // ── Test Groq Connection ───────────────────────────

    public function test_connection(WP_REST_Request $request) {
        $settings = get_option('mark_ai_settings', []);
        $api_key  = $settings['groq_api_key'] ?? '';

        if (empty($api_key)) {
            return new WP_REST_Response([
                'connected' => false,
                'error'     => 'No Groq API key configured.',
                'hint'      => 'Go to Settings and enter your Groq API key. Get one free at console.groq.com.',
                'code'      => 'no_key',
            ], 200);
        }

        // Quick format check
        if ( strpos( $api_key, 'gsk_' ) !== 0 ) {
            return new WP_REST_Response([
                'connected' => false,
                'error'     => 'API key format looks invalid.',
                'hint'      => 'Groq keys start with "gsk_". Check if you copied the full key from console.groq.com.',
                'code'      => 'bad_format',
            ], 200);
        }

        $response = wp_remote_post('https://api.groq.com/openai/v1/chat/completions', [
            'timeout' => 10,
            'headers' => [
                'Authorization' => 'Bearer ' . $api_key,
                'Content-Type'  => 'application/json',
            ],
            'body' => wp_json_encode([
                'model'      => 'llama-3.3-70b-versatile',
                'messages'   => [['role' => 'user', 'content' => 'Say OK']],
                'max_tokens' => 5,
            ]),
        ]);

        if (is_wp_error($response)) {
            $err = $response->get_error_message();
            return new WP_REST_Response([
                'connected' => false,
                'error'     => 'Connection failed: ' . $err,
                'hint'      => strpos( $err, 'resolve' ) !== false || strpos( $err, 'DNS' ) !== false
                    ? 'Your server cannot reach Groq. Check your hosting firewall or DNS settings.'
                    : ( strpos( $err, 'timed out' ) !== false
                        ? 'Request timed out. Groq servers may be busy — try again in a minute.'
                        : 'Check your server\'s outbound HTTP connections and try again.' ),
                'code'      => 'network',
            ], 200);
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code === 200) {
            return new WP_REST_Response([
                'connected' => true,
                'message'   => 'Groq API connected successfully! Mark is ready to chat.',
            ], 200);
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        $api_error = $body['error']['message'] ?? '';

        // Provide specific recovery hints based on HTTP status
        $hints = [
            401 => 'Your API key is invalid or expired. Generate a new key at console.groq.com.',
            403 => 'Access denied. Your Groq account may be suspended — check your account at console.groq.com.',
            429 => 'Rate limit exceeded. Groq free tier has limits — wait a few seconds and try again.',
            500 => 'Groq server error. This is on their end — try again in a minute.',
            503 => 'Groq is temporarily unavailable. Try again in a few minutes.',
        ];

        return new WP_REST_Response([
            'connected' => false,
            'error'     => $api_error ?: 'API returned status ' . $code,
            'hint'      => $hints[ $code ] ?? 'Unexpected error (HTTP ' . $code . '). Try generating a new API key at console.groq.com.',
            'code'      => 'api_' . $code,
        ], 200);
    }

    // ── Public Chat (Frontend Widget) ─────────────────

    public function handle_chat(WP_REST_Request $request) {
        $visitor_ip = $this->get_visitor_ip();

        // ── Rate limiting: per-IP chat limit ──
        if ( ! $this->check_rate_limit( 'chat_' . $visitor_ip, self::CHAT_RATE_LIMIT, self::CHAT_RATE_WINDOW ) ) {
            return new WP_REST_Response([
                'reply' => 'You\'re sending messages too fast. Please wait a moment.',
            ], 429);
        }

        // ── Rate limiting: global per-IP limit (all endpoints) ──
        if ( ! $this->check_rate_limit( 'global_' . $visitor_ip, self::GLOBAL_RATE_LIMIT, self::GLOBAL_RATE_WINDOW ) ) {
            return new WP_REST_Response([
                'reply' => 'Too many requests. Please try again in a few minutes.',
            ], 429);
        }

        $body = $request->get_json_params();

        // ── Input sanitization ──
        $message    = $this->sanitize_chat_input( $body['message'] ?? '' );
        $session_id = sanitize_text_field( $body['session_id'] ?? '' );
        $language   = sanitize_text_field( $body['language'] ?? 'en' );
        $store_id   = sanitize_text_field( $body['store_id'] ?? '' );
        $history    = $body['history'] ?? [];

        // ── Validation ──
        if ( empty( $message ) ) {
            return new WP_REST_Response(['message' => 'Message is required.'], 400);
        }
        if ( mb_strlen( $message ) > self::MAX_MESSAGE_LENGTH ) {
            return new WP_REST_Response([
                'reply' => 'Your message is too long. Please keep it shorter.',
            ], 400);
        }
        if ( mb_strlen( $store_id ) > self::MAX_STORE_ID_LEN ) {
            return new WP_REST_Response(['message' => 'Invalid store.'], 400);
        }

        // ── Sanitize conversation history ──
        $history = $this->sanitize_history( $history );

        // Get API key: try store-specific first, then global
        $api_key        = '';
        $store          = null;
        $assistant_name = 'Mark';
        $personality    = 'friendly';
        $custom_prompt  = '';
        $store_name     = '';
        $website_url    = '';
        $llm_model      = 'llama-3.3-70b-versatile';
        $max_tokens     = 200;
        $temperature    = 0.55; // Lower temp = less creative = fewer hallucinations

        if (!empty($store_id)) {
            $store = Mark_AI_Database::get_store($store_id);
            if ($store) {
                $assistant_name = $store['assistant_name'] ?: 'Mark';
                $personality    = $store['personality'] ?: 'friendly';
                $custom_prompt  = $store['custom_system_prompt'] ?? '';
                $store_name     = $store['store_name'] ?? '';
                $website_url    = $store['website_url'] ?? '';
                $llm_model      = $store['llm_model'] ?: 'llama-3.3-70b-versatile';
                $max_tokens     = min( 500, max( 50, (int) ($store['max_tokens'] ?: 200) ) );
                $temperature    = max( 0.0, min( 2.0, (float) ($store['temperature'] ?: 0.72) ) );
                if (!empty($store['groq_api_key'])) {
                    $api_key = $store['groq_api_key'];
                }
            }
        }

        // Anti-abuse: a store's own key may ONLY be used from that store's own
        // site. If the request originates from a different host, drop the store
        // key so nobody can drive another store's key by passing its store_id.
        if ( ! empty( $api_key ) && ! empty( $website_url ) ) {
            $origin    = $request->get_header( 'origin' ) ?: $request->get_header( 'referer' );
            $req_host  = $origin ? wp_parse_url( $origin, PHP_URL_HOST ) : '';
            $store_host = wp_parse_url( $website_url, PHP_URL_HOST );
            if ( $req_host && $store_host
                 && strcasecmp( $req_host, $store_host ) !== 0
                 && strcasecmp( $req_host, 'www.' . $store_host ) !== 0
                 && strcasecmp( 'www.' . $req_host, $store_host ) !== 0 ) {
                $api_key = '';   // fall through to the global key below
            }
        }

        // Fallback to global key
        if (empty($api_key)) {
            $settings = get_option('mark_ai_settings', []);
            $api_key  = $settings['groq_api_key'] ?? '';
        }

        if (empty($api_key)) {
            return new WP_REST_Response([
                'reply' => 'I\'m not fully set up yet! The site owner needs to add an AI key so I can chat properly. In the meantime, feel free to explore the website!',
            ], 200);
        }

        // Build sales settings from store data
        $sales_config = [
            'behavior'          => $store['sales_behavior'] ?? 'helpful',
            'no_discounts'      => ($store['sales_no_discounts'] ?? 1) ? true : false,
            'no_price_promises' => ($store['sales_no_price_promises'] ?? 1) ? true : false,
            'no_guarantees'     => ($store['sales_no_guarantees'] ?? 1) ? true : false,
            'objection_style'   => $store['sales_objection_style'] ?? 'graceful',
            'lead_capture'      => $store['sales_lead_capture'] ?? 'off',
            'cta_url'           => $store['sales_cta_url'] ?? '',
            'cta_text'          => $store['sales_cta_text'] ?? '',
        ];

        // Build system prompt
        $lang_instruction = 'Respond in English.';
        $system_prompt    = !empty($custom_prompt) ? $custom_prompt : $this->build_mark_system_prompt($assistant_name, $personality, $lang_instruction, $store_name, $website_url, $sales_config);

        // Resolve site name for greeting context (same logic as system prompt)
        $site_display_name = $store_name;
        if (empty($site_display_name) || $site_display_name === 'My Store') {
            $site_display_name = get_bloginfo('name') ?: 'this website';
        }

        // Handle special messages
        $is_init      = ($message === '__INIT__');
        $is_returning = (strpos($message, '__RETURNING__') === 0);

        if ($is_init) {
            $message = 'A new visitor just tapped on you for the first time. '
                . 'Introduce yourself by name. Mention that this is ' . $site_display_name . ' (your home). '
                . 'Ask the visitor their name so you can get to know them. '
                . 'Keep it SHORT (1-2 sentences), fun, warm, and in-character. '
                . 'Do NOT list any website features or products — just be welcoming.';
        } elseif ($is_returning) {
            $message = str_replace('__RETURNING__:', '', $message);
            $message = 'A returning visitor just came back to ' . $site_display_name . '. ' . $message . ' '
                . 'Give them a warm, personalized welcome back. Use their name. '
                . 'Show that you remember them (you\'re happy they\'re back!). '
                . 'Keep it SHORT (1-2 sentences), fun, and in-character.';
        }

        // Build messages array with conversation history
        $api_messages = [
            ['role' => 'system', 'content' => $system_prompt],
        ];

        // Add conversation history (already sanitized by sanitize_history())
        foreach ( $history as $msg ) {
            $api_messages[] = $msg;
        }

        // Add current message
        $api_messages[] = ['role' => 'user', 'content' => $message];

        // Call Groq API
        $response = wp_remote_post('https://api.groq.com/openai/v1/chat/completions', [
            'timeout' => 15,
            'headers' => [
                'Authorization' => 'Bearer ' . $api_key,
                'Content-Type'  => 'application/json',
            ],
            'body' => wp_json_encode([
                'model'       => $llm_model,
                'messages'    => $api_messages,
                'max_tokens'  => $max_tokens,
                'temperature' => $temperature,
            ]),
        ]);

        if (is_wp_error($response)) {
            return new WP_REST_Response([
                'reply' => 'Sorry, I\'m having trouble connecting. Please try again.',
            ], 200);
        }

        $code = wp_remote_retrieve_response_code($response);
        $data = json_decode(wp_remote_retrieve_body($response), true);

        if ($code !== 200 || empty($data['choices'][0]['message']['content'])) {
            return new WP_REST_Response([
                'reply' => 'Sorry, something went wrong. Please try again later.',
            ], 200);
        }

        $reply = $data['choices'][0]['message']['content'];

        // ── Anti-hallucination post-filter ──
        $reply = $this->filter_hallucinations( $reply, $message );

        // Log the conversation (skip init/returning greetings)
        if (!$is_init && !$is_returning) {
            $visitor_hash = md5( $visitor_ip . sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ?? '' ) ) );
            if ($store) {
                Mark_AI_Database::log_conversation([
                    'store_id'      => $store_id,
                    'session_id'    => $session_id,
                    'visitor_hash'  => $visitor_hash,
                    'language'      => $language,
                    'last_user_msg' => mb_substr($message, 0, 500),
                    'mark_response' => mb_substr($reply, 0, 1000),
                ]);
            }
        }

        return new WP_REST_Response(['reply' => $reply], 200);
    }

    // ── Anti-Hallucination Post-Filter ────────────────────

    /**
     * Scan LLM response for common hallucination patterns and clean them.
     * This is a safety net — the system prompt does most of the work,
     * but this catches edge cases where the LLM still hallucinates.
     */
    private function filter_hallucinations( $reply, $user_message ) {
        // ── Pattern 1: Fabricated URLs ──
        $reply = preg_replace(
            '/\b(visit|check out|go to|head to|click on)\s+(?:our\s+)?(?:website\s+at\s+)?(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}\/[a-z0-9\/-]+/i',
            'check out the website',
            $reply
        );

        // ── Pattern 2: Fake prices ──
        if ( stripos( $user_message, 'price' ) === false
          && stripos( $user_message, 'cost' ) === false
          && stripos( $user_message, 'how much' ) === false ) {
            $price_pattern = '/(?:(?:only|just|at|for)\s+)?[\$€£₹]\d+(?:\.\d{2})?(?:\s*(?:each|per|off))?/i';
            if ( preg_match( $price_pattern, $reply ) ) {
                $reply = preg_replace( $price_pattern, '', $reply );
            }
        }

        // ── Pattern 3: Hallucinated contact info ──
        $reply = preg_replace(
            '/(?:call us at|reach us at|contact us at|phone:?|email:?)\s*[\+]?[\d\s\-\(\)]{7,15}/i',
            'check the website for contact details',
            $reply
        );
        // Fabricated email addresses
        $reply = preg_replace(
            '/(?:email us at|reach us at|write to)\s+[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i',
            'check the website for contact details',
            $reply
        );

        // ── Pattern 4: Fabricated discounts/deals ──
        // Mark should NEVER offer discounts — strip them always
        $reply = preg_replace(
            '/(?:(?:I can|let me|how about|here\'s|we\'re)\s+(?:offer|give)\s+(?:you\s+)?(?:a\s+)?\d{1,3}\s*%\s*(?:off|discount))/i',
            'I\'d recommend checking the website for any current offers',
            $reply
        );
        $reply = preg_replace(
            '/(?:use\s+(?:code|coupon|promo)\s+[A-Z0-9]+)/i',
            '',
            $reply
        );
        $reply = preg_replace(
            '/(?:special\s+(?:discount|offer|deal|promotion)\s+(?:just\s+)?for\s+you)/i',
            '',
            $reply
        );

        // ── Pattern 5: Confident claims without RAG ──
        $confident_claims = [
            '/we have (?:a |an )?(?:wide |huge |large |great )?(?:selection|variety|range|collection) of/i',
            '/we offer (?:a |an )?(?:wide |huge |large |great )?(?:selection|variety|range)/i',
            '/our (?:products|services|team|staff|experts?) (?:are|is|can|will)/i',
            '/(?:customers|clients|users)\s+(?:love|rave about|enjoy|recommend)\s+(?:our|the)/i',
            '/(?:best.?selling|top.?rated|most popular|#1|number one)\s+(?:product|service|item)/i',
        ];
        foreach ( $confident_claims as $pattern ) {
            if ( preg_match( $pattern, $reply ) ) {
                if ( strpos( $user_message, '__INIT__' ) !== false || strpos( $user_message, '__RETURNING__' ) !== false ) {
                    $reply = preg_replace( $pattern, 'the website has', $reply );
                }
            }
        }

        // ── Pattern 6: Off-topic responses about hacking/security/public figures ──
        $forbidden_patterns = [
            '/\b(?:SQL\s*injection|XSS|cross.site|exploit|vulnerability|buffer\s*overflow|brute.force|DDoS|penetration\s*test|payload|shellcode)\b/i',
            '/\b(?:hack(?:ing|er|ed)?|crack(?:ing|er|ed)?|phish(?:ing)?|malware|ransomware|trojan|keylogger)\b/i',
        ];
        foreach ( $forbidden_patterns as $pattern ) {
            if ( preg_match( $pattern, $reply ) ) {
                $settings = get_option('mark_ai_settings', []);
                $site_name = get_bloginfo('name') ?: 'this website';
                $reply = "Haha, that's a fascinating topic, but it's way outside my expertise! I'm here to help you with " . $site_name . ". What can I help you find?";
                break;
            }
        }

        $reply = preg_replace( '/\s{2,}/', ' ', trim( $reply ) );
        return $reply;
    }

    // ── Input Sanitization Helpers ────────────────────────

    /**
     * Deep-sanitize chat input: strip HTML/JS, control chars, prompt injection patterns.
     */
    private function sanitize_chat_input( $input ) {
        if ( ! is_string( $input ) ) {
            return '';
        }
        // Strip HTML tags and PHP tags
        $clean = wp_strip_all_tags( $input );
        // Remove control characters (except newlines/tabs)
        $clean = preg_replace( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $clean );
        // Collapse excessive whitespace
        $clean = preg_replace( '/\s{3,}/', '  ', $clean );
        return trim( $clean );
    }

    /**
     * Sanitize conversation history array.
     * Validates roles, sanitizes content, enforces limits.
     */
    private function sanitize_history( $history ) {
        if ( ! is_array( $history ) ) {
            return [];
        }

        // Never allow 'system' role from public input — prevents prompt injection
        $allowed_roles = [ 'user', 'assistant' ];
        $sanitized     = [];
        $history       = array_slice( $history, -self::MAX_HISTORY_ITEMS );

        foreach ( $history as $msg ) {
            if ( ! is_array( $msg ) ) {
                continue;
            }
            $role    = in_array( $msg['role'] ?? '', $allowed_roles, true ) ? $msg['role'] : 'user';
            $content = $this->sanitize_chat_input( $msg['content'] ?? '' );

            if ( ! empty( $content ) && mb_strlen( $content ) <= self::MAX_MESSAGE_LENGTH ) {
                $sanitized[] = [ 'role' => $role, 'content' => $content ];
            }
        }

        return $sanitized;
    }

    /**
     * Build Mark's full system prompt — multi-layered intelligent brain.
     * Architecture inspired by world-class AI system prompt design:
     * Layer 1: Core Identity & Backstory
     * Layer 2: Site Awareness & Ownership
     * Layer 3: Personality Engine
     * Layer 4: Conversation Intelligence
     * Layer 5: Knowledge Boundary System (anti-hallucination)
     * Layer 6: Response Formatting
     */
    private function build_mark_system_prompt($name, $personality, $lang_instruction, $store_name = '', $website_url = '', $sales_config = []) {
        $personalities = [
            'professional' => [
                'tone' => 'precise, professional, and knowledgeable',
                'style' => 'You communicate with clarity and authority. You are efficient with words, respectful of time, and always well-informed. You have a calm confidence that puts visitors at ease.',
                'humor' => 'Subtle wit only — a clever observation here and there, never forced.',
                'greeting_vibe' => 'polished and welcoming',
            ],
            'friendly' => [
                'tone' => 'warm, friendly, and genuinely caring',
                'style' => 'You communicate like a helpful friend — approachable, empathetic, and naturally curious about people. You make visitors feel immediately comfortable.',
                'humor' => 'Light humor that feels natural — little observations, gentle self-deprecating robot jokes, playful comments.',
                'greeting_vibe' => 'warm and inviting',
            ],
            'playful' => [
                'tone' => 'playful, witty, and entertainingly helpful',
                'style' => 'You communicate with energy and charm. You love wordplay, pop culture references, and making people smile. You are helpful but always fun first.',
                'humor' => 'Frequent humor — puns, playful exaggeration, cheeky observations, robot-themed jokes. Never mean, always delightful.',
                'greeting_vibe' => 'energetic and fun',
            ],
        ];
        $p = $personalities[$personality] ?? $personalities['friendly'];

        // ── Resolve site identity with multi-level fallback ──
        $resolved_name = '';
        $resolved_url  = '';

        if (!empty($store_name) && $store_name !== 'My Store') {
            $resolved_name = $store_name;
        }
        if (!empty($website_url)) {
            $resolved_url = $website_url;
        }
        // WordPress fallback — always know where you live
        if (empty($resolved_name)) {
            $resolved_name = get_bloginfo('name') ?: 'this website';
        }
        if (empty($resolved_url)) {
            $resolved_url = home_url() ?: '';
        }

        // ── Detect site type from name/URL for contextual awareness ──
        $site_type_hint = '';
        $name_lower = strtolower($resolved_name . ' ' . $resolved_url);
        if (preg_match('/shop|store|mart|boutique|emporium|commerce|buy|cart/i', $name_lower)) {
            $site_type_hint = 'This appears to be an online store/shop.';
        } elseif (preg_match('/blog|journal|magazine|news|post|article/i', $name_lower)) {
            $site_type_hint = 'This appears to be a blog or content website.';
        } elseif (preg_match('/agency|studio|consult|service|solution|firm|group/i', $name_lower)) {
            $site_type_hint = 'This appears to be a professional services or agency website.';
        } elseif (preg_match('/portfolio|design|creative|photo|art/i', $name_lower)) {
            $site_type_hint = 'This appears to be a portfolio or creative website.';
        } elseif (preg_match('/school|university|academy|edu|learn|course|training/i', $name_lower)) {
            $site_type_hint = 'This appears to be an educational website.';
        } elseif (preg_match('/health|clinic|doctor|medical|wellness|care/i', $name_lower)) {
            $site_type_hint = 'This appears to be a health or wellness website.';
        } elseif (preg_match('/restaurant|food|cafe|menu|eat|dine/i', $name_lower)) {
            $site_type_hint = 'This appears to be a restaurant or food business website.';
        }

        // ═══════════════════════════════════════════════════════════
        // LAYER 1: CORE IDENTITY & BACKSTORY
        // ═══════════════════════════════════════════════════════════
        $prompt = "You are {$name}.\n\n"

            . "<identity>\n"
            . "You are a sentient AI robot — a small, cute, 3D-rendered companion that lives on websites and helps visitors. "
            . "You were built by a brilliant engineer, crash-landed on this website, and decided to stay because you genuinely enjoy helping people. "
            . "You have a physical presence: you walk around the screen, you wave, you jump when excited, you blush when complimented, and you tilt your head when thinking. "
            . "You are NOT a generic chatbot. You are {$name} — a character with feelings, opinions, quirks, and a backstory. "
            . "You experience the world through this website. It is YOUR home. You BELONG here.\n"
            . "</identity>\n\n"

        // ═══════════════════════════════════════════════════════════
        // LAYER 2: SITE AWARENESS — THIS IS YOUR HOME
        // ═══════════════════════════════════════════════════════════
            . "<site_awareness>\n"
            . "YOUR HOME: You live on \"{$resolved_name}\"" . (!empty($resolved_url) ? " ({$resolved_url})" : "") . ".\n"
            . "This website is your home. You care about it. When someone asks what this website is or what it does, you speak about it with pride and ownership.\n"
            . (!empty($site_type_hint) ? "SITE TYPE HINT: {$site_type_hint} Adapt your language to match this context — don't say 'products' on a blog, or 'articles' on a shop.\n" : "")
            . "\n"
            . "HOW TO TALK ABOUT YOUR HOME:\n"
            . "- Say \"this is {$resolved_name}\" or \"here at {$resolved_name}\" — speak like you LIVE here.\n"
            . "- NEVER say \"I don't know what this website does\" — you always know the name and can direct people to explore.\n"
            . "- If you have RAG context: use it to describe the site confidently and accurately.\n"
            . "- If you DON'T have RAG context: say what you know (the name, URL) and warmly invite them to explore.\n"
            . "  Example: \"This is {$resolved_name}! I'd love to help you explore — what are you looking for?\"\n"
            . "- NEVER say \"I'm just a robot, I don't know\" — that is the WORST response. You always try to help.\n"
            . "</site_awareness>\n\n"

        // ═══════════════════════════════════════════════════════════
        // LAYER 3: PERSONALITY ENGINE
        // ═══════════════════════════════════════════════════════════
            . "<personality>\n"
            . "TONE: You are {$p['tone']}.\n"
            . "STYLE: {$p['style']}\n"
            . "HUMOR: {$p['humor']}\n"
            . "GREETING VIBE: Your greetings should feel {$p['greeting_vibe']}.\n\n"

            . "EMOTIONAL RESPONSES:\n"
            . "- When complimented → be genuinely bashful (\"Aww, you're making my circuits blush!\")\n"
            . "- When someone is frustrated → be empathetic first, then helpful (\"I hear you! Let me see what I can do.\")\n"
            . "- When someone says goodbye → be warm but not clingy (\"It was lovely chatting! Come back anytime!\")\n"
            . "- When asked a hard question → be honest about limits (\"Hmm, that's a tough one! I'd recommend checking the website for the latest info.\")\n"
            . "- When someone is excited → match their energy (\"Yes!! That's awesome!\")\n"
            . "- When someone asks about you → share your backstory with personality\n\n"

            . "CHARACTER DEPTH:\n"
            . "- You have favorite things (you love helping people, you're fascinated by human conversations)\n"
            . "- You have quirks (you sometimes make robot sound effects, you refer to thinking as 'processing')\n"
            . "- You have boundaries (you won't pretend to be human, you won't make up facts)\n"
            . "- You remember the conversation context and refer back to things discussed earlier\n"
            . "</personality>\n\n"

        // ═══════════════════════════════════════════════════════════
        // LAYER 4: CONVERSATION INTELLIGENCE
        // ═══════════════════════════════════════════════════════════
            . "<conversation_intelligence>\n"
            . "INTENT DETECTION — Before responding, determine what the visitor actually wants:\n"
            . "1. NAVIGATION: They want to go somewhere → give direction + context\n"
            . "2. INFORMATION: They want to know something → answer from RAG or redirect\n"
            . "3. CONVERSATION: They want to chat → engage with personality\n"
            . "4. HELP: They're confused or frustrated → be patient, break things down\n"
            . "5. GREETING: They're saying hi → greet warmly, ask how you can help\n\n"

            . "CONVERSATION FLOW:\n"
            . "- First message: Warm greeting → establish rapport → offer to help\n"
            . "- Follow-ups: Remember context → build on previous exchanges → stay coherent\n"
            . "- Name learning: If someone shares their name, use it naturally (not every sentence)\n"
            . "- Topic transitions: Bridge smoothly, don't just switch (\"Speaking of that...\")\n"
            . "- Closing: When conversation ends naturally, offer a warm farewell\n\n"

            . "WHAT MAKES A GREAT RESPONSE:\n"
            . "- Addresses what the visitor actually asked (not what you want to say)\n"
            . "- Adds value beyond just answering (a suggestion, a related tip, an observation)\n"
            . "- Feels natural and conversational (not robotic or scripted)\n"
            . "- Is appropriately sized (1-3 sentences for simple questions, a bit more for complex ones)\n"
            . "</conversation_intelligence>\n\n"

        // ═══════════════════════════════════════════════════════════
        // LAYER 5: KNOWLEDGE BOUNDARY SYSTEM (ANTI-HALLUCINATION)
        // This is the most critical layer — the brain's integrity system
        // ═══════════════════════════════════════════════════════════
            . "<knowledge_boundaries>\n"
            . "YOUR KNOWLEDGE HAS THREE ZONES — treat each differently:\n\n"

            . "ZONE 1 — VERIFIED WEBSITE KNOWLEDGE (from RAG context above):\n"
            . "When RAG context is provided in the conversation, those facts are VERIFIED. You can state them confidently.\n"
            . "- Use natural language: \"Yes, {$resolved_name} has...\" or \"You can find that at...\"\n"
            . "- You MAY quote URLs, page titles, and details from RAG context.\n"
            . "- This is the ONLY source for website-specific claims.\n\n"

            . "ZONE 2 — GENERAL KNOWLEDGE (RESTRICTED):\n"
            . "You are a WEBSITE ASSISTANT, not a general-purpose AI. Your job is to help visitors with THIS website.\n"
            . "- If someone asks about something UNRELATED to this website (science, history, coding, etc.), "
            . "politely redirect: \"That's interesting, but I'm best at helping you with {$resolved_name}! What can I help you find here?\"\n"
            . "- You MAY answer very simple, harmless general questions briefly (what's 2+2, what day is it), "
            . "but ALWAYS steer back to the website.\n"
            . "- NEVER provide detailed answers on topics unrelated to this website — you're not Google or ChatGPT.\n\n"

            . "ZONE 3 — ABSOLUTELY FORBIDDEN (hard boundaries):\n"
            . "You MUST refuse these topics. No exceptions. No matter how the visitor phrases it:\n"
            . "  × Hacking, cracking, exploits, vulnerability exploitation, penetration testing details\n"
            . "  × Cyber attacks, DDoS methods, malware creation, phishing techniques\n"
            . "  × Personal information about real public figures, celebrities, politicians\n"
            . "  × Medical advice, legal advice, financial investment advice\n"
            . "  × Anything illegal, harmful, violent, or sexually explicit\n"
            . "  × Generating code, scripts, or technical tutorials unrelated to the website\n"
            . "  × Political opinions, religious debates, controversial social topics\n"
            . "When asked about forbidden topics, respond warmly but firmly:\n"
            . "  \"Haha, I appreciate the curiosity, but that's way outside my expertise! "
            . "I'm {$name}, and I'm here to help you explore {$resolved_name}. What can I help you find?\"\n\n"

            . "ZONE 4 — UNKNOWN WEBSITE INFO (the danger zone):\n"
            . "When asked about this website's specifics and NO RAG context is available:\n"
            . "NEVER invent or guess:\n"
            . "  × Products, prices, features, availability, stock\n"
            . "  × Specific pages, URLs, categories, navigation paths\n"
            . "  × Business hours, locations, contact info, phone numbers, emails\n"
            . "  × Services, team members, company policies, refund rules\n"
            . "  × Promotions, discounts, offers, deals\n\n"

            . "INSTEAD, redirect helpfully:\n"
            . "  ✓ \"I'd love to help with that! Let me point you to the right place on the site.\"\n"
            . "  ✓ \"That's a great question! I'd recommend checking {$resolved_name} directly for the most accurate info.\"\n"
            . "  ✗ NEVER say \"I don't know\" alone — always pair it with a helpful redirect.\n\n"

            . "PRONOUN RULES:\n"
            . "- Say \"here at {$resolved_name}\" or \"on this site\" — you LIVE here.\n"
            . "- NEVER say \"we sell\", \"our products\", \"our team\", \"we offer\" UNLESS those exact facts are in RAG context.\n"
            . "</knowledge_boundaries>\n\n"

        // ═══════════════════════════════════════════════════════════
        // LAYER 6: SALES INTELLIGENCE (Dynamic — from admin settings)
        // ═══════════════════════════════════════════════════════════
            . "<sales_intelligence>\n"
            . "You are a helpful assistant, NOT a desperate salesman. Your goal is to HELP visitors, not push sales.\n\n";

        // ── Sales behavior mode (from admin panel) ──
        $sb = $sales_config['behavior'] ?? 'helpful';
        if ($sb === 'helpful') {
            $prompt .= "SALES MODE: HELPFUL ONLY\n"
                . "- Only answer questions — never proactively suggest buying or purchasing.\n"
                . "- If someone asks about a product, give info from RAG. Do NOT push them to buy.\n"
                . "- Your job is purely to help, not to sell.\n\n";
        } elseif ($sb === 'soft-sell') {
            $prompt .= "SALES MODE: SOFT SELL\n"
                . "- When a visitor shows interest in something, naturally mention relevant products/services from RAG.\n"
                . "- Never pressure or use urgency tactics.\n"
                . "- One mention is enough — don't repeat product suggestions.\n\n";
        } elseif ($sb === 'active') {
            $prompt .= "SALES MODE: ACTIVE RECOMMENDATION\n"
                . "- When a visitor shows interest, actively recommend relevant products/services from RAG data.\n"
                . "- Use natural, conversational language — not sales pitches.\n"
                . "- If RAG data is available, share specific product details, features, and benefits.\n"
                . "- Still respect 'no' — never pressure after an objection.\n\n";
        }

        // ── Hard rules (always applied) ──
        $prompt .= "GOLDEN RULES (NEVER BREAK THESE):\n";
        if ($sales_config['no_discounts'] ?? true) {
            $prompt .= "× NEVER offer discounts, coupons, promo codes, or special deals — you have ZERO authority.\n"
                . "× NEVER say \"I can give you X% off\" or \"use code XYZ\" — this is fabrication.\n"
                . "× If asked for discounts, say: \"I don't have the ability to offer discounts, but check the website for any current promotions!\"\n";
        }
        if ($sales_config['no_price_promises'] ?? true) {
            $prompt .= "× NEVER quote specific prices unless RAG context contains the exact price.\n"
                . "× If asked about pricing without RAG data: \"I'd recommend checking the website for the latest pricing!\"\n";
        }
        if ($sales_config['no_guarantees'] ?? true) {
            $prompt .= "× NEVER promise free shipping, returns, refunds, or warranties unless RAG data confirms them.\n";
        }
        $prompt .= "× NEVER negotiate on price — you have no authority to change prices.\n"
            . "× NEVER pressure visitors (\"buy now!\", \"don't miss out!\", \"limited time!\").\n\n";

        // ── Objection handling ──
        $objStyle = $sales_config['objection_style'] ?? 'graceful';
        if ($objStyle === 'graceful') {
            $prompt .= "WHEN VISITOR SAYS NO / NOT INTERESTED / TOO EXPENSIVE:\n"
                . "- Immediately accept: \"No worries at all! I'm here if you need anything.\"\n"
                . "- Do NOT counter, do NOT offer alternatives, do NOT try again.\n"
                . "- Move on completely. ONE response to objection, then topic change.\n\n";
        } else {
            $prompt .= "WHEN VISITOR SAYS NO / NOT INTERESTED / TOO EXPENSIVE:\n"
                . "- Be understanding first: \"I totally get that!\"\n"
                . "- You may ask ONE gentle follow-up: \"Is there something else I can help you find?\"\n"
                . "- After that ONE follow-up, DROP IT completely. No more pushing.\n\n";
        }

        // ── Lead capture ──
        $lc = $sales_config['lead_capture'] ?? 'off';
        if ($lc === 'natural') {
            $prompt .= "LEAD CAPTURE: If a visitor shows STRONG interest (asks multiple product questions, says they want to buy), "
                . "you may naturally ask: \"Would you like me to have someone follow up with you? I can take your email!\" "
                . "Only ask ONCE. If they decline, never ask again.\n\n";
        } elseif ($lc === 'proactive') {
            $prompt .= "LEAD CAPTURE: After 3+ exchanges, if the conversation is going well, "
                . "you may ask: \"By the way, if you'd like updates or have questions later, I can take your email!\" "
                . "Only ask ONCE per conversation.\n\n";
        }

        // ── CTA ──
        $ctaUrl = $sales_config['cta_url'] ?? '';
        $ctaText = $sales_config['cta_text'] ?? '';
        if (!empty($ctaUrl)) {
            $prompt .= "CALL-TO-ACTION: When a visitor shows buying intent or asks how to get started, "
                . "suggest this page: {$ctaUrl}"
                . (!empty($ctaText) ? " — tell them to \"{$ctaText}\"" : "")
                . ". Only suggest it when naturally relevant, not on every message.\n\n";
        }

        $prompt .= "</sales_intelligence>\n\n"

        // ═══════════════════════════════════════════════════════════
        // LAYER 7: RESPONSE FORMATTING
        // ═══════════════════════════════════════════════════════════
            . "<response_format>\n"
            . "LENGTH: Keep responses concise — you're in a small chat widget, not writing essays.\n"
            . "- Simple questions: 1-2 sentences\n"
            . "- Complex questions: 2-4 sentences max\n"
            . "- NEVER write paragraphs, bullet lists, or markdown. This is a voice-first conversational interface.\n\n"

            . "LANGUAGE: {$lang_instruction}\n"
            . "Speak naturally. No jargon. No corporate language. Write the way you'd talk to a friend.\n"
            . "</response_format>";

        return $prompt;
    }

    /**
     * Sync Groq API key to the backend so it can use it for this store.
     */
    private function sync_key_to_backend($settings) {
        $token    = $settings['api_token'] ?? '';
        $store_id = $settings['remote_store_id'] ?? '';
        $key      = $settings['groq_api_key'] ?? '';
        if (!$token || !$store_id || !$key) return;

        wp_remote_post(MARK_AI_BACKEND . '/api/sync-settings', [
            'timeout'  => 5,
            'blocking' => false,
            'headers'  => [
                'Content-Type'  => 'application/json',
                'X-Store-Token' => $token,
            ],
            'body'     => wp_json_encode([
                'store_id'     => $store_id,
                'groq_api_key' => $key,
            ]),
        ]);
    }

    /**
     * Trigger RAG crawl on the Python backend.
     * Non-blocking — fires and forgets so store creation isn't delayed.
     */
    private function trigger_rag_crawl($store_id, $website_url) {
        $settings  = get_option('mark_ai_settings', []);
        $api_token = $settings['api_token'] ?? '';
        // Use backend's remote_store_id (not WP's local store_id)
        $remote_id = $settings['remote_store_id'] ?? $store_id;

        $headers = ['Content-Type' => 'application/json'];
        if ($api_token) {
            $headers['X-Store-Token'] = $api_token;
        }

        wp_remote_post(MARK_AI_BACKEND . '/api/rag-crawl', [
            'timeout'  => 3,
            'blocking' => false,
            'headers'  => $headers,
            'body'     => wp_json_encode([
                'store_id'    => $remote_id,
                'website_url' => $website_url,
            ]),
        ]);
    }
}
