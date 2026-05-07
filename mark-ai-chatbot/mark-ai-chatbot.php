<?php
/**
 * Plugin Name: Mark AI — Shopping Companion
 * Plugin URI:  https://github.com/muhammadroohullah110/mark.git
 * Description: AI-powered 3D robot shopping companion. Voice-first, multilingual, friend-first salesman. Installs a floating chatbot widget on your store.
 * Version:     1.0.0
 * Author:      Muhammad Roohullah
 * Author URI:  https://www.linkedin.com/in/medicalairesearcher
 * License:     GPL v2 or later
 * Text Domain: mark-ai-chatbot
 * Requires at least: 5.8
 * Requires PHP: 7.4
 */

defined('ABSPATH') || exit;

// ── Plugin Constants ────────────────────────────────────────
define('MARK_AI_VERSION', '1.0.0');
define('MARK_AI_PATH', plugin_dir_path(__FILE__));
define('MARK_AI_URL', plugin_dir_url(__FILE__));
define('MARK_AI_BASENAME', plugin_basename(__FILE__));
define('MARK_AI_SLUG', 'mark-ai');

// ── Autoload Classes ────────────────────────────────────────
require_once MARK_AI_PATH . 'includes/class-mark-ai-activator.php';
require_once MARK_AI_PATH . 'includes/class-mark-ai-database.php';
require_once MARK_AI_PATH . 'includes/class-mark-ai-admin.php';
require_once MARK_AI_PATH . 'includes/class-mark-ai-rest-api.php';
require_once MARK_AI_PATH . 'includes/class-mark-ai-widget.php';
require_once MARK_AI_PATH . 'includes/class-mark-ai-updater.php';

// ── Activation / Deactivation ───────────────────────────────
register_activation_hook(__FILE__, ['Mark_AI_Activator', 'activate']);
register_deactivation_hook(__FILE__, ['Mark_AI_Activator', 'deactivate']);

// ── Load Text Domain for i18n ───────────────────────────────
function mark_ai_load_textdomain() {
    load_plugin_textdomain( 'mark-ai-chatbot', false, dirname( MARK_AI_BASENAME ) . '/languages/' );
}
add_action( 'init', 'mark_ai_load_textdomain' );

// ── Initialize Plugin ───────────────────────────────────────
function mark_ai_init() {
    // Admin panel (only loads on admin pages)
    if (is_admin()) {
        new Mark_AI_Admin();
    }

    // REST API endpoints (always loaded)
    new Mark_AI_Rest_API();

    // Auto-updater (checks GitHub for new releases)
    new Mark_AI_Updater();

    // Frontend widget (only loads on frontend)
    if (!is_admin()) {
        new Mark_AI_Widget();
    }
}
add_action('plugins_loaded', 'mark_ai_init');

// ── Add "Settings" link on Plugins page ─────────────────────
add_filter('plugin_action_links_' . MARK_AI_BASENAME, function($links) {
    $settings_link = '<a href="' . admin_url('admin.php?page=mark-ai') . '">Settings</a>';
    array_unshift($links, $settings_link);
    return $links;
});
