<?php
/**
 * Mark AI — Frontend 3D Robot Widget
 * Injects the walking 3D robot chatbot on the store's frontend pages.
 * Loads Three.js, GLTFLoader, mark-animator, mark-brain, and chatbot scripts.
 */

defined('ABSPATH') || exit;

class Mark_AI_Widget {

    public function __construct() {
        $settings = get_option('mark_ai_settings', []);

        // Only load if widget is enabled
        if (empty($settings['widget_enabled'])) {
            return;
        }

        add_action('wp_enqueue_scripts', [$this, 'enqueue_assets']);
        add_action('wp_footer', [$this, 'inject_widget']);
    }

    /**
     * Enqueue frontend chatbot assets.
     */
    public function enqueue_assets() {
        $settings = get_option('mark_ai_settings', []);

        // Google Fonts (Outfit for the robot UI)
        wp_enqueue_style(
            'mark-ai-outfit-font',
            'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap',
            [],
            null
        );

        // Chatbot CSS
        wp_enqueue_style(
            'mark-ai-chatbot',
            MARK_AI_URL . 'public/css/chatbot.css',
            ['mark-ai-outfit-font'],
            MARK_AI_VERSION
        );

        // Three.js (r128 — matches original robot code)
        wp_enqueue_script(
            'three-js',
            'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
            [],
            'r128',
            true
        );

        // GLTFLoader (loads .glb robot model)
        wp_enqueue_script(
            'three-gltf-loader',
            'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
            ['three-js'],
            'r128',
            true
        );

        // Mark Animator (procedural robot animations)
        wp_enqueue_script(
            'mark-ai-animator',
            MARK_AI_URL . 'public/js/mark-animator.js',
            ['three-js'],
            MARK_AI_VERSION,
            true
        );

        // Mark Brain (RAG + navigation intent detection)
        wp_enqueue_script(
            'mark-ai-brain',
            MARK_AI_URL . 'public/js/mark-brain.js',
            [],
            MARK_AI_VERSION,
            true
        );

        // Main Chatbot JS (3D robot widget — depends on all above)
        wp_enqueue_script(
            'mark-ai-chatbot',
            MARK_AI_URL . 'public/js/chatbot.js',
            ['three-js', 'three-gltf-loader', 'mark-ai-animator', 'mark-ai-brain'],
            MARK_AI_VERSION,
            true
        );

        // Get the first active store for this site
        $stores = Mark_AI_Database::get_stores();
        $active_store = null;
        $site_url = home_url();

        foreach ($stores as $store) {
            if (!empty($store['is_active'])) {
                // Match by URL or just use the first active one
                if (empty($store['website_url']) || strpos($site_url, $store['website_url']) !== false || strpos($store['website_url'], $site_url) !== false) {
                    $active_store = $store;
                    break;
                }
            }
        }

        // Fallback: use first active store regardless
        if (!$active_store) {
            foreach ($stores as $store) {
                if (!empty($store['is_active'])) {
                    $active_store = $store;
                    break;
                }
            }
        }

        // Pass config to mark-brain (loaded before chatbot, so both can read it)
        wp_localize_script('mark-ai-brain', 'markAIConfig', [
            'restUrl'     => rest_url('mark-ai/v1/'),
            'nonce'       => wp_create_nonce('wp_rest'),
            'pluginUrl'   => MARK_AI_URL,
            'language'    => $settings['primary_language'] ?? 'en',
            'autoGreet'   => !empty($settings['auto_greet']),
            'position'    => $settings['widget_position'] ?? 'bottom-right',
            'storeId'     => $active_store ? $active_store['store_id'] : '',
            'backendUrl'  => !empty($settings['backend_url']) ? $settings['backend_url'] : 'https://mark-ix64.onrender.com',
            'accentColor' => sanitize_hex_color( $settings['widget_accent_color'] ?? '' ) ?: '#954921',
        ]);
    }

    /**
     * Inject the chatbot container into the footer.
     */
    public function inject_widget() {
        $settings = get_option('mark_ai_settings', []);
        $position = $settings['widget_position'] ?? 'bottom-right';

        echo '<div id="mark-ai-chatbot-root" data-position="' . esc_attr($position) . '"></div>';
    }
}
