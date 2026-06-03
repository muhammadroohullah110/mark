<?php
/**
 * Plugin Name: Mark AI — Website Companion
 * Plugin URI:  https://github.com/muhammadroohullah110/mark
 * Description: AI-powered 3D robot website companion with voice chat, intelligent navigation, and anti-hallucination. Installs a floating 3D chatbot widget on your site.
 * Version:     1.2.6
 * Author:      Muhammad Roohullah
 * Author URI:  https://www.linkedin.com/in/medicalairesearcher
 * License:     GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: mark-ai-chatbot
 * Requires at least: 5.8
 * Requires PHP: 7.4
 */

defined('ABSPATH') || exit;

// ── Prevent duplicate loading (if multiple plugin copies exist) ──
if (defined('MARK_AI_VERSION')) {
    return;
}

// ── Plugin Constants ────────────────────────────────────────
define('MARK_AI_VERSION', '1.2.6');
define('MARK_AI_PATH', plugin_dir_path(__FILE__));
define('MARK_AI_URL', plugin_dir_url(__FILE__));
define('MARK_AI_BASENAME', plugin_basename(__FILE__));
define('MARK_AI_SLUG', 'mark-ai');
define('MARK_AI_BACKEND', 'https://mark-udfz.onrender.com');

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

    // ── DB upgrade check — only runs dbDelta (NOT full activate) ──
    $current_db_version = get_option('mark_ai_db_version', '1.0.0');
    if (version_compare($current_db_version, MARK_AI_VERSION, '<')) {
        Mark_AI_Activator::upgrade_tables();
    }

    // Auto-register with backend if not done yet (handles Render cold start)
    $settings = get_option('mark_ai_settings', []);
    if (empty($settings['api_token']) || empty($settings['remote_store_id'])) {
        Mark_AI_Activator::auto_register_retry();
    }

    // REST API endpoints (always loaded)
    new Mark_AI_Rest_API();

    // Auto-updater — only for GitHub-distributed copies (WP.org handles its own updates)
    if (defined('MARK_AI_SELF_UPDATE') && MARK_AI_SELF_UPDATE) {
        new Mark_AI_Updater();
    }

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
