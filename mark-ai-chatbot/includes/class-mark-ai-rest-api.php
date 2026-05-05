<?php
/**
 * Mark AI — WordPress REST API
 * All REST endpoints for admin dashboard (stores CRUD, analytics, settings).
 */

defined('ABSPATH') || exit;

class Mark_AI_Rest_API {

    public function __construct() {
        add_action('rest_api_init', [$this, 'register_routes']);
    }

    /**
     * Register all REST routes under /wp-json/mark-ai/v1/
     */
    public function register_routes() {

        // ── Dashboard ─────────────────────────────────
        register_rest_route('mark-ai/v1', '/dashboard', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_dashboard'],
            'permission_callback' => [$this, 'admin_check'],
        ]);

        // ── Settings ──────────────────────────────────
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

        // ── Stores CRUD ───────────────────────────────
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

        // ── Store Analytics ───────────────────────────
        register_rest_route('mark-ai/v1', '/stores/(?P<store_id>[a-zA-Z0-9]+)/analytics', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_store_analytics'],
            'permission_callback' => [$this, 'admin_check'],
        ]);

        // ── Conversations ─────────────────────────────
        register_rest_route('mark-ai/v1', '/stores/(?P<store_id>[a-zA-Z0-9]+)/conversations', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_conversations'],
            'permission_callback' => [$this, 'admin_check'],
        ]);

        // ── Embed Code ────────────────────────────────
        register_rest_route('mark-ai/v1', '/stores/(?P<store_id>[a-zA-Z0-9]+)/embed', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_embed_code'],
            'permission_callback' => [$this, 'admin_check'],
        ]);

        // ── Backend Health Check ──────────────────────
        register_rest_route('mark-ai/v1', '/health', [
            'methods'             => 'GET',
            'callback'            => [$this, 'health_check'],
            'permission_callback' => [$this, 'admin_check'],
        ]);

        // ── Test Voice (calls backend TTS) ────────────
        register_rest_route('mark-ai/v1', '/test-voice', [
            'methods'             => 'POST',
            'callback'            => [$this, 'test_voice'],
            'permission_callback' => [$this, 'admin_check'],
        ]);
    }

    /**
     * Permission check — must be logged-in admin.
     */
    public function admin_check() {
        return current_user_can('manage_options');
    }

    // ── Dashboard ───────────────────────────────────────

    public function get_dashboard() {
        $stats = Mark_AI_Database::get_dashboard_stats();
        $stores = Mark_AI_Database::get_stores();

        // Add analytics to each store
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
        return new WP_REST_Response($stats, 200);
    }

    // ── Settings ────────────────────────────────────────

    public function get_settings() {
        $settings = get_option('mark_ai_settings', []);
        // Mask the Groq API key for security
        if (!empty($settings['groq_api_key'])) {
            $key = $settings['groq_api_key'];
            $settings['groq_api_key_masked'] = substr($key, 0, 8) . '...' . substr($key, -4);
        }
        return new WP_REST_Response($settings, 200);
    }

    public function save_settings(WP_REST_Request $request) {
        $body = $request->get_json_params();
        $current = get_option('mark_ai_settings', []);

        // Whitelist allowed settings
        $allowed = [
            'backend_url', 'groq_api_key', 'default_voice', 'default_voice_ur',
            'tts_rate', 'tts_pitch', 'llm_model', 'max_tokens', 'temperature',
            'widget_enabled', 'widget_position', 'auto_greet', 'primary_language',
        ];

        foreach ($allowed as $key) {
            if (isset($body[$key])) {
                $current[$key] = sanitize_text_field($body[$key]);
            }
        }

        update_option('mark_ai_settings', $current);
        return new WP_REST_Response(['message' => 'Settings saved!', 'settings' => $current], 200);
    }

    // ── Stores ──────────────────────────────────────────

    public function list_stores() {
        $stores = Mark_AI_Database::get_stores();

        // Mask API keys
        foreach ($stores as &$s) {
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

        // Use global Groq key if not provided per-store
        $settings = get_option('mark_ai_settings', []);
        $groq_key = !empty($body['groq_api_key']) ? $body['groq_api_key'] : ($settings['groq_api_key'] ?? '');

        $data = [
            'store_name'     => sanitize_text_field($body['store_name']),
            'website_url'    => esc_url_raw($body['website_url']),
            'assistant_name' => sanitize_text_field($body['assistant_name'] ?? 'Mark'),
            'groq_api_key'   => sanitize_text_field($groq_key),
        ];

        $store_id = Mark_AI_Database::create_store($data);
        return new WP_REST_Response(['store_id' => $store_id, 'message' => 'Store created!'], 201);
    }

    public function get_store(WP_REST_Request $request) {
        $store_id = $request->get_param('store_id');
        $store = Mark_AI_Database::get_store($store_id);

        if (!$store || (int) $store['owner_id'] !== get_current_user_id()) {
            return new WP_REST_Response(['message' => 'Store not found'], 404);
        }

        return new WP_REST_Response(['store' => $store], 200);
    }

    public function update_store(WP_REST_Request $request) {
        $store_id = $request->get_param('store_id');
        $store = Mark_AI_Database::get_store($store_id);

        if (!$store || (int) $store['owner_id'] !== get_current_user_id()) {
            return new WP_REST_Response(['message' => 'Store not found'], 404);
        }

        $body = $request->get_json_params();

        // Whitelist updatable fields
        $allowed = [
            'store_name', 'website_url', 'assistant_name', 'personality',
            'greeting_style', 'primary_language', 'supported_languages',
            'max_crawl_pages', 'idle_timeout', 'walking_enabled', 'sound_effects',
            'tts_voice', 'tts_voice_urdu', 'tts_rate', 'tts_pitch',
            'groq_api_key', 'llm_model', 'max_tokens', 'temperature',
            'rate_chat', 'rate_tts', 'rate_transcribe',
            'custom_system_prompt', 'is_active',
        ];

        $updates = [];
        foreach ($allowed as $key) {
            if (isset($body[$key])) {
                $updates[$key] = is_string($body[$key]) ? sanitize_text_field($body[$key]) : $body[$key];
            }
        }

        // Allow longtext for custom_system_prompt
        if (isset($body['custom_system_prompt'])) {
            $updates['custom_system_prompt'] = wp_kses_post($body['custom_system_prompt']);
        }

        if (!empty($updates)) {
            Mark_AI_Database::update_store($store_id, $updates);
        }

        return new WP_REST_Response(['message' => 'Store updated!', 'store_id' => $store_id], 200);
    }

    public function delete_store(WP_REST_Request $request) {
        $store_id = $request->get_param('store_id');
        $store = Mark_AI_Database::get_store($store_id);

        if (!$store || (int) $store['owner_id'] !== get_current_user_id()) {
            return new WP_REST_Response(['message' => 'Store not found'], 404);
        }

        Mark_AI_Database::delete_store($store_id);
        return new WP_REST_Response(['message' => 'Store deleted', 'store_id' => $store_id], 200);
    }

    // ── Analytics ───────────────────────────────────────

    public function get_store_analytics(WP_REST_Request $request) {
        $store_id = $request->get_param('store_id');
        $store = Mark_AI_Database::get_store($store_id);

        if (!$store || (int) $store['owner_id'] !== get_current_user_id()) {
            return new WP_REST_Response(['message' => 'Store not found'], 404);
        }

        return new WP_REST_Response(Mark_AI_Database::get_analytics($store_id), 200);
    }

    // ── Conversations ──────────────────────────────────

    public function get_conversations(WP_REST_Request $request) {
        $store_id = $request->get_param('store_id');
        $store = Mark_AI_Database::get_store($store_id);

        if (!$store || (int) $store['owner_id'] !== get_current_user_id()) {
            return new WP_REST_Response(['message' => 'Store not found'], 404);
        }

        $limit = (int) ($request->get_param('limit') ?? 50);
        $offset = (int) ($request->get_param('offset') ?? 0);

        $convos = Mark_AI_Database::get_conversations($store_id, $limit, $offset);
        return new WP_REST_Response(['conversations' => $convos], 200);
    }

    // ── Embed Code ─────────────────────────────────────

    public function get_embed_code(WP_REST_Request $request) {
        $store_id = $request->get_param('store_id');
        $store = Mark_AI_Database::get_store($store_id);

        if (!$store || (int) $store['owner_id'] !== get_current_user_id()) {
            return new WP_REST_Response(['message' => 'Store not found'], 404);
        }

        $settings = get_option('mark_ai_settings', []);
        $backend = $settings['backend_url'] ?? 'http://localhost:8000';

        $embed_script = sprintf(
            '<!-- Mark AI Shopping Companion -->
<div id="mark-ai-widget" data-store-id="%s" data-backend="%s"></div>
<script src="%spublic/js/chatbot.js"></script>
<!-- End Mark AI -->',
            esc_attr($store_id),
            esc_url($backend),
            esc_url(MARK_AI_URL)
        );

        return new WP_REST_Response([
            'store_id'       => $store_id,
            'embed_script'   => $embed_script,
            'assistant_name' => $store['assistant_name'],
        ], 200);
    }

    // ── Health Check ───────────────────────────────────

    public function health_check() {
        $settings = get_option('mark_ai_settings', []);
        $backend_url = $settings['backend_url'] ?? 'http://localhost:8000';

        $response = wp_remote_get($backend_url . '/api/status', [
            'timeout' => 5,
            'sslverify' => false,
        ]);

        if (is_wp_error($response)) {
            return new WP_REST_Response([
                'backend_online' => false,
                'error'          => $response->get_error_message(),
            ], 200);
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        return new WP_REST_Response([
            'backend_online' => true,
            'backend_status' => $body,
        ], 200);
    }

    // ── Test Voice ─────────────────────────────────────

    public function test_voice(WP_REST_Request $request) {
        $settings = get_option('mark_ai_settings', []);
        $backend_url = $settings['backend_url'] ?? 'http://localhost:8000';

        $body = $request->get_json_params();
        $text = $body['text'] ?? 'Hello! I am Mark, your shopping companion.';
        $language = $body['language'] ?? 'en';

        $response = wp_remote_post($backend_url . '/api/tts', [
            'timeout' => 15,
            'sslverify' => false,
            'headers' => ['Content-Type' => 'application/json'],
            'body' => wp_json_encode([
                'text'     => $text,
                'language' => $language,
            ]),
        ]);

        if (is_wp_error($response)) {
            return new WP_REST_Response(['error' => $response->get_error_message()], 502);
        }

        $audio = wp_remote_retrieve_body($response);
        $audio_b64 = base64_encode($audio);

        return new WP_REST_Response([
            'audio_base64' => $audio_b64,
            'content_type' => 'audio/mpeg',
        ], 200);
    }
}
