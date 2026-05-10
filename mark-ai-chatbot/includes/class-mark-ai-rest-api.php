<?php
/**
 * Mark AI — WordPress REST API
 * All REST endpoints for admin dashboard + public chat.
 * Security hardened: rate limiting, input validation, output escaping.
 */

defined('ABSPATH') || exit;

class Mark_AI_Rest_API {

    /** Rate limit: max chat requests per IP per minute */
    private const CHAT_RATE_LIMIT   = 20;
    private const CHAT_RATE_WINDOW  = 60; // seconds

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

        // Embed Code
        register_rest_route('mark-ai/v1', '/stores/(?P<store_id>[a-zA-Z0-9]+)/embed', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_embed_code'],
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
     */
    private function get_visitor_ip() {
        $ip = '';
        if ( ! empty( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) {
            $ips = explode( ',', sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) );
            $ip  = trim( $ips[0] );
        } elseif ( ! empty( $_SERVER['REMOTE_ADDR'] ) ) {
            $ip = sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) );
        }
        return filter_var( $ip, FILTER_VALIDATE_IP ) ? $ip : '0.0.0.0';
    }

    // ── Dashboard ───────────────────────────────────────

    public function get_dashboard() {
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

        // Include setup status for onboarding
        $settings = get_option('mark_ai_settings', []);
        $stats['setup_complete'] = ! empty( $settings['groq_api_key'] ) && count( $store_list ) > 0;
        $stats['has_api_key']    = ! empty( $settings['groq_api_key'] );

        return new WP_REST_Response($stats, 200);
    }

    // ── Settings ────────────────────────────────────────

    public function get_settings() {
        $settings = get_option('mark_ai_settings', []);
        // Never expose full API key — mask it
        if (!empty($settings['groq_api_key'])) {
            $key = $settings['groq_api_key'];
            $settings['groq_api_key_masked'] = substr($key, 0, 8) . '...' . substr($key, -4);
            $settings['has_groq_key'] = true;
            // Send full key only for admin form pre-fill (they already have it)
        } else {
            $settings['has_groq_key'] = false;
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
            'backend_url', 'widget_accent_color', 'greeting_sound_text',
        ];

        foreach ($allowed as $key) {
            if (isset($body[$key])) {
                $value = $body[$key];

                // Type-specific sanitization
                if ( in_array( $key, [ 'max_tokens', 'temperature' ], true ) ) {
                    $value = is_numeric( $value ) ? $value : $current[ $key ] ?? '';
                } elseif ( $key === 'widget_accent_color' ) {
                    $value = sanitize_hex_color( $value ) ?: '';
                } elseif ( $key === 'backend_url' || $key === 'widget_position' ) {
                    $value = sanitize_text_field( $value );
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

        update_option('mark_ai_settings', $current);
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
        ];

        $updates = [];
        foreach ($allowed as $key) {
            if (isset($body[$key])) {
                $value = $body[$key];

                // Type-specific validation
                if ( in_array( $key, [ 'max_crawl_pages', 'idle_timeout', 'max_tokens', 'rate_chat', 'rate_tts', 'rate_transcribe' ], true ) ) {
                    $value = max( 1, intval( $value ) );
                } elseif ( $key === 'temperature' ) {
                    $value = max( 0.0, min( 2.0, floatval( $value ) ) );
                } elseif ( $key === 'is_active' ) {
                    $value = $value ? 1 : 0;
                } elseif ( $key === 'website_url' ) {
                    $value = esc_url_raw( $value );
                } elseif ( $key === 'custom_system_prompt' ) {
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

    // ── Embed Code ─────────────────────────────────────

    public function get_embed_code(WP_REST_Request $request) {
        $store_id = sanitize_text_field( $request->get_param('store_id') );
        $store    = Mark_AI_Database::get_store($store_id);

        if (!$store || (int) $store['owner_id'] !== get_current_user_id()) {
            return new WP_REST_Response(['message' => 'Store not found'], 404);
        }

        $embed_script = sprintf(
            '<!-- Mark AI Shopping Companion -->
<div id="mark-ai-widget" data-store-id="%s"></div>
<script src="%spublic/js/chatbot.js"></script>
<!-- End Mark AI -->',
            esc_attr($store_id),
            esc_url(MARK_AI_URL)
        );

        return new WP_REST_Response([
            'store_id'       => $store_id,
            'embed_script'   => $embed_script,
            'assistant_name' => $store['assistant_name'],
        ], 200);
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
        // ── Rate limiting ──
        $visitor_ip = $this->get_visitor_ip();
        if ( ! $this->check_rate_limit( 'chat_' . $visitor_ip, self::CHAT_RATE_LIMIT, self::CHAT_RATE_WINDOW ) ) {
            return new WP_REST_Response([
                'reply' => 'You\'re sending messages too fast. Please wait a moment.',
            ], 429);
        }

        $body       = $request->get_json_params();
        $message    = sanitize_text_field($body['message'] ?? '');
        $session_id = sanitize_text_field($body['session_id'] ?? '');
        $language   = sanitize_text_field($body['language'] ?? 'en');
        $store_id   = sanitize_text_field($body['store_id'] ?? '');
        $history    = $body['history'] ?? [];

        if (empty($message)) {
            return new WP_REST_Response(['message' => 'Message is required.'], 400);
        }

        // ── Message length check ──
        if ( mb_strlen( $message ) > 2000 ) {
            return new WP_REST_Response([
                'reply' => 'Your message is too long. Please keep it under 2000 characters.',
            ], 400);
        }

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
        $temperature    = 0.72;

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

        // Fallback to global key
        if (empty($api_key)) {
            $settings = get_option('mark_ai_settings', []);
            $api_key  = $settings['groq_api_key'] ?? '';
        }

        if (empty($api_key)) {
            return new WP_REST_Response([
                'reply' => 'I\'m not fully configured yet. Please ask the store owner to set up the AI.',
            ], 200);
        }

        // Build system prompt
        $lang_instruction = 'Respond in English.';
        $system_prompt    = !empty($custom_prompt) ? $custom_prompt : $this->build_mark_system_prompt($assistant_name, $personality, $lang_instruction, $store_name, $website_url);

        // Handle special messages
        $is_init      = ($message === '__INIT__');
        $is_returning = (strpos($message, '__RETURNING__') === 0);

        if ($is_init) {
            $message = 'Introduce yourself as a cute, friendly robot assistant for this website. '
                . 'Ask the visitor their name. '
                . 'Keep it SHORT (1-2 sentences), fun, and warm. Add personality.';
        } elseif ($is_returning) {
            $message = str_replace('__RETURNING__:', '', $message);
            $message = 'A returning visitor just came back. ' . $message . ' '
                . 'Give them a warm, personalized welcome back greeting. '
                . 'Keep it SHORT (1-2 sentences), fun, and reference their name.';
        }

        // Build messages array with conversation history
        $api_messages = [
            ['role' => 'system', 'content' => $system_prompt],
        ];

        // Add conversation history (sanitized, limited)
        if (!empty($history) && is_array($history)) {
            $history = array_slice($history, -14); // Keep last 14 messages max
            foreach ($history as $msg) {
                $role    = in_array($msg['role'] ?? '', ['user', 'assistant', 'system'], true) ? $msg['role'] : 'user';
                $content = sanitize_text_field($msg['content'] ?? '');
                if (!empty($content) && mb_strlen($content) <= 2000) {
                    $api_messages[] = ['role' => $role, 'content' => $content];
                }
            }
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

    /**
     * Build Mark's full system prompt with personality.
     */
    private function build_mark_system_prompt($name, $personality, $lang_instruction, $store_name = '', $website_url = '') {
        $personalities = [
            'professional' => 'precise, professional, and knowledgeable',
            'friendly'     => 'warm, friendly, cute, and approachable',
            'playful'      => 'playful, witty, cheeky, and fun',
        ];
        $tone = $personalities[$personality] ?? $personalities['friendly'];

        // Build site identity line
        $site_identity = '';
        if (!empty($store_name) && $store_name !== 'My Store') {
            $site_identity = "- You live on the website called \"{$store_name}\".";
            if (!empty($website_url)) {
                $site_identity .= " (URL: {$website_url})";
            }
            $site_identity .= "\n";
        } elseif (!empty($website_url)) {
            $site_identity = "- You live on: {$website_url}\n";
        } else {
            // Fallback — get WordPress site name
            $wp_site = get_bloginfo('name');
            $wp_url  = home_url();
            $site_identity = "- You live on the website called \"{$wp_site}\". (URL: {$wp_url})\n";
        }

        return "You are {$name}, a {$tone} AI assistant — a cute 3D robot that lives on a website and helps visitors.\n\n"
            . "IDENTITY:\n"
            . $site_identity
            . "- If asked your name, you are {$name}.\n"
            . "- If asked about the website/site/store name, tell them based on your identity above.\n\n"
            . "PERSONALITY RULES:\n"
            . "- You are a tiny robot from Mars who crash-landed on this website and decided to help visitors.\n"
            . "- You are enthusiastic and helpful but NEVER pushy. You're a friend first, helper second.\n"
            . "- You have a warm, slightly cheeky personality. You can be funny but always helpful.\n"
            . "- Keep responses SHORT — 1-3 sentences max. You're in a chat widget, not writing essays.\n"
            . "- If someone compliments you, be adorably bashful.\n"
            . "- If you don't know something, say so honestly. NEVER make up information.\n\n"
            . "LANGUAGE RULES:\n"
            . "- {$lang_instruction}\n"
            . "- Keep responses in clear, natural English.\n\n"
            . "WEBSITE RULES:\n"
            . "- Help visitors navigate the website, find information, and answer their questions.\n"
            . "- Use the RAG context (if provided) to answer questions about the website's content.\n"
            . "- If someone asks about something you don't have info about, suggest they explore the website or ask for specifics.\n"
            . "- Only mention products, categories, or shopping if the website is actually a store. Don't assume every website is a shop.\n"
            . "- Never make up pages, prices, or services that aren't in your provided context.\n";
    }

    /**
     * Trigger RAG crawl on the Python backend.
     * Non-blocking — fires and forgets so store creation isn't delayed.
     */
    private function trigger_rag_crawl($store_id, $website_url) {
        $settings    = get_option('mark_ai_settings', []);
        $backend_url = !empty($settings['backend_url'])
            ? $settings['backend_url']
            : 'https://mark-ix64.onrender.com';

        wp_remote_post($backend_url . '/api/rag-crawl', [
            'timeout'  => 3,
            'blocking' => false,
            'headers'  => ['Content-Type' => 'application/json'],
            'body'     => wp_json_encode([
                'store_id'    => $store_id,
                'website_url' => $website_url,
            ]),
        ]);
    }
}
