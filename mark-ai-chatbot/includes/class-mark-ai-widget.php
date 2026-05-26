<?php
/**
 * Mark AI — Frontend 3D Robot Widget
 * Injects the walking 3D robot chatbot on the store's frontend pages.
 * Loads Three.js, GLTFLoader, mark-animator, mark-brain, and chatbot scripts.
 *
 * Performance optimizations:
 * - All scripts loaded with defer (non-render-blocking)
 * - Google Fonts: preconnect + font-display:swap
 * - 3D model loaded from CDN (keeps plugin under 10MB)
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

        // Add defer to all Mark AI scripts (non-render-blocking)
        add_filter('script_loader_tag', [$this, 'add_defer_attribute'], 10, 3);

        // Preconnect to CDN origins for faster loading
        add_action('wp_head', [$this, 'add_preconnect'], 1);
    }

    /**
     * Add defer attribute to Mark AI scripts for non-blocking load.
     */
    public function add_defer_attribute($tag, $handle, $src) {
        $defer_handles = [
            'three-js',
            'three-gltf-loader',
            'three-draco-loader',
            'mark-ai-animator',
            'mark-ai-brain',
            'mark-ai-chatbot',
        ];

        if (in_array($handle, $defer_handles, true)) {
            // Don't double-add defer
            if (strpos($tag, 'defer') === false) {
                $tag = str_replace(' src=', ' defer src=', $tag);
            }
        }

        return $tag;
    }

    /**
     * Add preconnect hints for CDN origins (fonts, Three.js CDN).
     */
    public function add_preconnect() {
        echo '<link rel="preconnect" href="' . esc_url( 'https://fonts.googleapis.com' ) . '" crossorigin>' . "\n";
        echo '<link rel="preconnect" href="' . esc_url( 'https://fonts.gstatic.com' ) . '" crossorigin>' . "\n";
        echo '<link rel="preconnect" href="' . esc_url( 'https://cdnjs.cloudflare.com' ) . '" crossorigin>' . "\n";
        echo '<link rel="preconnect" href="' . esc_url( 'https://cdn.jsdelivr.net' ) . '" crossorigin>' . "\n";
        echo '<link rel="preconnect" href="' . esc_url( MARK_AI_BACKEND ) . '" crossorigin>' . "\n";
    }

    /**
     * Enqueue frontend chatbot assets.
     */
    public function enqueue_assets() {
        $settings = get_option('mark_ai_settings', []);

        // Google Fonts (Outfit for the robot UI) — display=swap already set
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

        // DRACOLoader (decompresses Draco-compressed meshes in optimized .glb)
        wp_enqueue_script(
            'three-draco-loader',
            'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/DRACOLoader.js',
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
            ['three-js', 'three-gltf-loader', 'three-draco-loader', 'mark-ai-animator', 'mark-ai-brain'],
            MARK_AI_VERSION,
            true
        );

        // Get all active stores (not owner-filtered — this runs on the frontend for visitors)
        $stores = Mark_AI_Database::get_active_stores();
        $active_store = null;
        $site_url = home_url();

        foreach ($stores as $store) {
            if (!empty($store['is_active'])) {
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

        // Resolve idle timeout: store-level → global → default (60s)
        $idle_timeout = 60;
        if ( $active_store && ! empty( $active_store['idle_timeout'] ) ) {
            $idle_timeout = max( 15, intval( $active_store['idle_timeout'] ) );
        } elseif ( ! empty( $settings['idle_timeout'] ) ) {
            $idle_timeout = max( 15, intval( $settings['idle_timeout'] ) );
        }

        // 3D model URL — use CDN if configured, otherwise serve from plugin
        // To use CDN: set 'model_cdn_url' in settings to your CDN base path
        // For WordPress.org: upload models to GitHub Releases and set CDN URL
        $model_cdn = !empty($settings['model_cdn_url'])
            ? trailingslashit($settings['model_cdn_url'])
            : MARK_AI_URL . 'public/model/';

        // Pass config to mark-brain (loaded before chatbot, so both can read it)
        wp_localize_script('mark-ai-brain', 'markAIConfig', [
            'restUrl'     => rest_url('mark-ai/v1/'),
            'nonce'       => wp_create_nonce('wp_rest'),
            'pluginUrl'   => MARK_AI_URL,
            'modelCdnUrl' => $model_cdn,
            'language'    => $settings['primary_language'] ?? 'en',
            'autoGreet'   => !empty($settings['auto_greet']),
            'position'    => $settings['widget_position'] ?? 'bottom-right',
            'storeId'     => !empty($settings['remote_store_id']) ? $settings['remote_store_id'] : ($active_store ? $active_store['store_id'] : ''),
            'backendUrl'  => MARK_AI_BACKEND,
            'accentColor'      => sanitize_hex_color( $settings['widget_accent_color'] ?? '' ) ?: '#954921',
            'greetingSoundText' => sanitize_text_field( $settings['greeting_sound_text'] ?? 'Ayie!' ),
            'idleTimeout'      => $idle_timeout,
            'scaleDesktop'     => max( 1, min( 10, intval( $active_store['widget_scale_desktop'] ?? 5 ) ) ),
            'scaleMobile'      => max( 1, min( 10, intval( $active_store['widget_scale_mobile']  ?? 5 ) ) ),
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
