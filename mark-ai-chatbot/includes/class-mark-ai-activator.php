<?php
/**
 * Mark AI — Activation & Deactivation
 * Creates custom database tables on plugin activation.
 * Auto-creates a default store for the site.
 */

defined('ABSPATH') || exit;

class Mark_AI_Activator {

    /**
     * Runs on plugin activation.
     */
    public static function activate() {
        self::create_tables();
        self::set_defaults();
        self::auto_create_store();
        flush_rewrite_rules();
    }

    /**
     * Runs on plugin deactivation.
     */
    public static function deactivate() {
        flush_rewrite_rules();
    }

    /**
     * Create custom database tables using dbDelta.
     */
    private static function create_tables() {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();

        $stores_table = $wpdb->prefix . 'mark_ai_stores';
        $convos_table = $wpdb->prefix . 'mark_ai_conversations';

        $sql = "CREATE TABLE $stores_table (
            id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            store_id varchar(32) NOT NULL,
            store_name varchar(255) NOT NULL DEFAULT 'My Store',
            website_url varchar(500) NOT NULL,
            assistant_name varchar(100) NOT NULL DEFAULT 'Mark',
            personality varchar(50) NOT NULL DEFAULT 'friendly',
            greeting_style varchar(50) NOT NULL DEFAULT 'casual',
            primary_language varchar(10) NOT NULL DEFAULT 'en',
            supported_languages text NOT NULL,
            max_crawl_pages int(11) NOT NULL DEFAULT 120,
            idle_timeout int(11) NOT NULL DEFAULT 10,
            walking_enabled tinyint(1) NOT NULL DEFAULT 1,
            sound_effects tinyint(1) NOT NULL DEFAULT 1,
            tts_voice varchar(100) DEFAULT 'en-US-GuyNeural',
            tts_rate varchar(20) DEFAULT '+0%%',
            tts_pitch varchar(20) DEFAULT '+0Hz',
            groq_api_key varchar(255) DEFAULT '',
            llm_model varchar(100) DEFAULT 'llama-3.3-70b-versatile',
            max_tokens int(11) DEFAULT 150,
            temperature float DEFAULT 0.72,
            max_audio_mb int(11) DEFAULT 10,
            max_message_length int(11) DEFAULT 2000,
            rate_transcribe int(11) DEFAULT 15,
            rate_chat int(11) DEFAULT 30,
            rate_rag int(11) DEFAULT 40,
            rate_tts int(11) DEFAULT 20,
            custom_system_prompt longtext DEFAULT '',
            sales_behavior varchar(20) DEFAULT 'helpful',
            sales_no_discounts tinyint(1) DEFAULT 1,
            sales_no_price_promises tinyint(1) DEFAULT 1,
            sales_no_guarantees tinyint(1) DEFAULT 1,
            sales_objection_style varchar(20) DEFAULT 'graceful',
            sales_lead_capture varchar(20) DEFAULT 'off',
            sales_cta_url varchar(500) DEFAULT '',
            sales_cta_text varchar(200) DEFAULT '',
            is_active tinyint(1) NOT NULL DEFAULT 1,
            owner_id bigint(20) UNSIGNED NOT NULL,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            updated_at datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY store_id (store_id),
            KEY owner_id (owner_id)
        ) $charset;

        CREATE TABLE $convos_table (
            id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            store_id varchar(32) NOT NULL,
            session_id varchar(64) NOT NULL DEFAULT '',
            visitor_hash varchar(64) NOT NULL DEFAULT '',
            language varchar(10) DEFAULT 'en',
            exchange_count int(11) DEFAULT 0,
            last_user_msg text DEFAULT '',
            mark_response text DEFAULT '',
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY store_id (store_id),
            KEY session_id (session_id),
            KEY created_at (created_at)
        ) $charset;";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);

        update_option('mark_ai_db_version', '1.1.0');
    }

    /**
     * Set default plugin settings on first activation.
     */
    private static function set_defaults() {
        $defaults = [
            'groq_api_key'     => '',
            'default_voice'    => 'en-US-GuyNeural',
            'tts_rate'         => '+0%',
            'tts_pitch'        => '+0Hz',
            'llm_model'        => 'llama-3.3-70b-versatile',
            'max_tokens'       => 150,
            'temperature'      => 0.72,
            'widget_enabled'   => 1,
            'widget_position'  => 'bottom-right',
            'auto_greet'          => 1,
            'primary_language'    => 'en',
            'widget_accent_color' => '#667eea',
        ];

        // Only set defaults if not already configured
        if (!get_option('mark_ai_settings')) {
            update_option('mark_ai_settings', $defaults);
        }
    }

    /**
     * Auto-create a default store for this WordPress site.
     * Only creates if no stores exist yet for the current admin.
     */
    private static function auto_create_store() {
        global $wpdb;
        $table = $wpdb->prefix . 'mark_ai_stores';
        $uid = get_current_user_id();

        // Skip if user not logged in (CLI activation) or stores already exist
        if (!$uid) return;

        $count = (int) $wpdb->get_var(
            $wpdb->prepare("SELECT COUNT(*) FROM $table WHERE owner_id = %d", $uid)
        );
        if ($count > 0) return;

        // Create default store with site info
        $store_id = wp_generate_password(16, false);
        $wpdb->insert($table, [
            'store_id'            => $store_id,
            'store_name'          => get_bloginfo('name') ?: 'My Store',
            'website_url'         => home_url(),
            'assistant_name'      => 'Mark',
            'personality'         => 'friendly',
            'greeting_style'      => 'casual',
            'primary_language'    => 'en',
            'supported_languages' => wp_json_encode(['en']),
            'is_active'           => 1,
            'owner_id'            => $uid,
        ]);
    }
}
