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
