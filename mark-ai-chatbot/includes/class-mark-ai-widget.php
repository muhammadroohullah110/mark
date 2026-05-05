<?php
/**
 * Mark AI — Frontend Widget
 * Injects the 3D chatbot widget on the store's frontend pages.
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
        // Three.js for 3D robot
        wp_enqueue_script('threejs', MARK_AI_URL . 'public/js/three.min.js', [], '128', true);

        // Chatbot CSS
        wp_enqueue_style('mark-ai-chatbot', MARK_AI_URL . 'public/css/chatbot.css', [], MARK_AI_VERSION);

        // Chatbot JS
        wp_enqueue_script('mark-ai-chatbot', MARK_AI_URL . 'public/js/chatbot.js', ['threejs'], MARK_AI_VERSION, true);

        // Pass config to chatbot
        $settings = get_option('mark_ai_settings', []);
        wp_localize_script('mark-ai-chatbot', 'markAIConfig', [
            'backendUrl'  => $settings['backend_url'] ?? 'http://localhost:8000',
            'pluginUrl'   => MARK_AI_URL,
            'language'    => $settings['primary_language'] ?? 'en',
            'autoGreet'   => !empty($settings['auto_greet']),
            'position'    => $settings['widget_position'] ?? 'bottom-right',
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
