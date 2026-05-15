<?php
/**
 * Mark AI — Uninstall
 * Cleans up all plugin data when deleted (not deactivated).
 */

// Exit if not called by WordPress
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

global $wpdb;

// Drop custom tables
$wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}mark_ai_conversations");
$wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}mark_ai_stores");

// Remove options
delete_option('mark_ai_settings');
delete_option('mark_ai_db_version');

// Clean up transients
delete_transient('mark_ai_update_check');
delete_transient('mark_cache_dashboard');

// Clean up rate limiter transients (pattern: mark_rl_*)
$wpdb->query(
    "DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_mark_rl_%' OR option_name LIKE '_transient_timeout_mark_rl_%' OR option_name LIKE '_transient_mark_cache_%' OR option_name LIKE '_transient_timeout_mark_cache_%'"
);
