<?php
/**
 * Mark AI — Database Operations
 * All $wpdb queries for stores and conversations.
 */

defined('ABSPATH') || exit;

class Mark_AI_Database {

    /**
     * Get the stores table name.
     */
    public static function stores_table() {
        global $wpdb;
        return $wpdb->prefix . 'mark_ai_stores';
    }

    /**
     * Get the conversations table name.
     */
    public static function convos_table() {
        global $wpdb;
        return $wpdb->prefix . 'mark_ai_conversations';
    }

    // ── Store CRUD ──────────────────────────────────────────

    /**
     * Create a new store.
     */
    public static function create_store($data) {
        global $wpdb;

        $store_id = wp_generate_password(16, false);

        $defaults = [
            'store_id'             => $store_id,
            'store_name'           => 'My Store',
            'website_url'          => '',
            'assistant_name'       => 'Mark',
            'personality'          => 'friendly',
            'greeting_style'       => 'casual',
            'primary_language'     => 'en',
            'supported_languages'  => wp_json_encode(['en']),
            'groq_api_key'         => '',
            'is_active'            => 1,
            'owner_id'             => get_current_user_id(),
        ];

        $insert = wp_parse_args($data, $defaults);
        $insert['store_id'] = $store_id;

        $wpdb->insert(self::stores_table(), $insert);

        return $store_id;
    }

    /**
     * Get a single store by store_id.
     */
    public static function get_store($store_id) {
        global $wpdb;
        $table = self::stores_table();
        return $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM $table WHERE store_id = %s", $store_id),
            ARRAY_A
        );
    }

    /**
     * Get all stores for the current user (admin context).
     */
    public static function get_stores($owner_id = null) {
        global $wpdb;
        $table = self::stores_table();
        $uid = $owner_id ?: get_current_user_id();
        return $wpdb->get_results(
            $wpdb->prepare("SELECT * FROM $table WHERE owner_id = %d ORDER BY created_at DESC", $uid),
            ARRAY_A
        );
    }

    /**
     * Get all active stores (frontend context — no owner filter).
     * Used by the widget to find the store matching the current site.
     */
    public static function get_active_stores() {
        global $wpdb;
        $table = self::stores_table();
        return $wpdb->get_results(
            "SELECT * FROM $table WHERE is_active = 1 ORDER BY created_at ASC",
            ARRAY_A
        );
    }

    /**
     * Update a store.
     */
    public static function update_store($store_id, $data) {
        global $wpdb;
        return $wpdb->update(
            self::stores_table(),
            $data,
            ['store_id' => $store_id]
        );
    }

    /**
     * Delete a store and its conversations.
     */
    public static function delete_store($store_id) {
        global $wpdb;
        $wpdb->delete(self::convos_table(), ['store_id' => $store_id]);
        $wpdb->delete(self::stores_table(), ['store_id' => $store_id]);
        return true;
    }

    // ── Conversations ───────────────────────────────────────

    /**
     * Log a conversation.
     */
    public static function log_conversation($data) {
        global $wpdb;
        $wpdb->insert(self::convos_table(), $data);
    }

    /**
     * Get conversations for a store.
     */
    public static function get_conversations($store_id, $limit = 50, $offset = 0) {
        global $wpdb;
        $table = self::convos_table();
        return $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM $table WHERE store_id = %s ORDER BY created_at DESC LIMIT %d OFFSET %d",
                $store_id, $limit, $offset
            ),
            ARRAY_A
        );
    }

    /**
     * Get analytics for a store.
     */
    public static function get_analytics($store_id) {
        global $wpdb;
        $table = self::convos_table();

        $total = (int) $wpdb->get_var(
            $wpdb->prepare("SELECT COUNT(*) FROM $table WHERE store_id = %s", $store_id)
        );

        $today = (int) $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COUNT(*) FROM $table WHERE store_id = %s AND DATE(created_at) = CURDATE()",
                $store_id
            )
        );

        $this_week = (int) $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COUNT(*) FROM $table WHERE store_id = %s AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)",
                $store_id
            )
        );

        $unique_visitors = (int) $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COUNT(DISTINCT visitor_hash) FROM $table WHERE store_id = %s",
                $store_id
            )
        );

        $languages = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT language, COUNT(*) as cnt FROM $table WHERE store_id = %s GROUP BY language",
                $store_id
            ),
            ARRAY_A
        );
        $lang_map = [];
        foreach ($languages as $row) {
            $lang_map[$row['language']] = (int) $row['cnt'];
        }

        return [
            'total_conversations' => $total,
            'today'               => $today,
            'this_week'           => $this_week,
            'unique_visitors'     => $unique_visitors,
            'languages'           => $lang_map,
        ];
    }

    /**
     * Get daily conversation counts for chart data (last N days).
     */
    public static function get_daily_conversations( $store_ids = [], $days = 14 ) {
        global $wpdb;
        $table = self::convos_table();

        if ( empty( $store_ids ) ) {
            return [];
        }

        $placeholders = implode( ',', array_fill( 0, count( $store_ids ), '%s' ) );
        $args         = array_merge( $store_ids, [ $days ] );

        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT DATE(created_at) AS day, COUNT(*) AS cnt
                 FROM $table
                 WHERE store_id IN ($placeholders)
                   AND created_at >= DATE_SUB(CURDATE(), INTERVAL %d DAY)
                 GROUP BY DATE(created_at)
                 ORDER BY day ASC",
                ...$args
            ),
            ARRAY_A
        );

        // Fill missing days with zero
        $result = [];
        for ( $i = $days - 1; $i >= 0; $i-- ) {
            $date            = gmdate( 'Y-m-d', strtotime( "-{$i} days" ) );
            $result[ $date ] = 0;
        }
        foreach ( $rows as $row ) {
            $result[ $row['day'] ] = (int) $row['cnt'];
        }

        return $result;
    }

    /**
     * Get hourly conversation distribution (for peak-hours chart).
     */
    public static function get_hourly_distribution( $store_ids = [] ) {
        global $wpdb;
        $table = self::convos_table();

        if ( empty( $store_ids ) ) {
            return array_fill( 0, 24, 0 );
        }

        $placeholders = implode( ',', array_fill( 0, count( $store_ids ), '%s' ) );

        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT HOUR(created_at) AS hr, COUNT(*) AS cnt
                 FROM $table
                 WHERE store_id IN ($placeholders)
                   AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                 GROUP BY HOUR(created_at)
                 ORDER BY hr ASC",
                ...$store_ids
            ),
            ARRAY_A
        );

        $result = array_fill( 0, 24, 0 );
        foreach ( $rows as $row ) {
            $result[ (int) $row['hr'] ] = (int) $row['cnt'];
        }

        return $result;
    }

    /**
     * Get dashboard summary across all stores.
     */
    public static function get_dashboard_stats($owner_id = null) {
        global $wpdb;
        $stores_table = self::stores_table();
        $convos_table = self::convos_table();
        $uid = $owner_id ?: get_current_user_id();

        $total_stores = (int) $wpdb->get_var(
            $wpdb->prepare("SELECT COUNT(*) FROM $stores_table WHERE owner_id = %d", $uid)
        );
        $active_stores = (int) $wpdb->get_var(
            $wpdb->prepare("SELECT COUNT(*) FROM $stores_table WHERE owner_id = %d AND is_active = 1", $uid)
        );

        // Get store IDs for this owner
        $store_ids = $wpdb->get_col(
            $wpdb->prepare("SELECT store_id FROM $stores_table WHERE owner_id = %d", $uid)
        );

        $total_convos = 0;
        $today_convos = 0;
        $all_languages = [];

        if (!empty($store_ids)) {
            $placeholders = implode(',', array_fill(0, count($store_ids), '%s'));

            $total_convos = (int) $wpdb->get_var(
                $wpdb->prepare(
                    "SELECT COUNT(*) FROM $convos_table WHERE store_id IN ($placeholders)",
                    ...$store_ids
                )
            );

            $today_convos = (int) $wpdb->get_var(
                $wpdb->prepare(
                    "SELECT COUNT(*) FROM $convos_table WHERE store_id IN ($placeholders) AND DATE(created_at) = CURDATE()",
                    ...$store_ids
                )
            );

            $langs = $wpdb->get_results(
                $wpdb->prepare(
                    "SELECT language, COUNT(*) as cnt FROM $convos_table WHERE store_id IN ($placeholders) GROUP BY language",
                    ...$store_ids
                ),
                ARRAY_A
            );
            foreach ($langs as $row) {
                $all_languages[$row['language']] = (int) $row['cnt'];
            }
        }

        return [
            'total_stores'        => $total_stores,
            'active_stores'       => $active_stores,
            'total_conversations' => $total_convos,
            'today_conversations' => $today_convos,
            'languages'           => $all_languages,
        ];
    }
}
