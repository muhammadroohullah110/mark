<?php
/**
 * Mark AI — Admin Panel
 * Registers WP admin menu, enqueues assets, renders dashboard SPA.
 */

defined('ABSPATH') || exit;

class Mark_AI_Admin {

    public function __construct() {
        add_action('admin_menu', [$this, 'register_menu']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_assets']);
    }

    /**
     * Register top-level menu + submenus.
     */
    public function register_menu() {
        // Main menu item
        add_menu_page(
            'Mark AI',
            'Mark AI',
            'manage_options',
            'mark-ai',
            [$this, 'render_dashboard'],
            $this->get_robot_icon(),
            26
        );

        // Submenus
        add_submenu_page('mark-ai', 'Dashboard', 'Dashboard', 'manage_options', 'mark-ai', [$this, 'render_dashboard']);
        add_submenu_page('mark-ai', 'My Store', 'My Store', 'manage_options', 'mark-ai-stores', [$this, 'render_stores']);
        add_submenu_page('mark-ai', 'Conversations', 'Conversations', 'manage_options', 'mark-ai-conversations', [$this, 'render_conversations']);
        add_submenu_page('mark-ai', 'Settings', 'Settings', 'manage_options', 'mark-ai-settings', [$this, 'render_settings']);
    }

    /**
     * Custom robot SVG icon for WordPress admin menu (base64 data URI).
     */
    private function get_robot_icon() {
        $svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none">'
            // antenna
            . '<line x1="10" y1="1" x2="10" y2="3.5" stroke="black" stroke-width="1.2" stroke-linecap="round"/>'
            . '<circle cx="10" cy="1" r="1" fill="black"/>'
            // head
            . '<rect x="3.5" y="3.5" width="13" height="9" rx="3" fill="black"/>'
            // eyes
            . '<circle cx="7.2" cy="8" r="1.8" fill="white"/>'
            . '<circle cx="12.8" cy="8" r="1.8" fill="white"/>'
            . '<circle cx="7.2" cy="8" r="0.8" fill="black"/>'
            . '<circle cx="12.8" cy="8" r="0.8" fill="black"/>'
            // mouth
            . '<path d="M7.5 10.5 Q10 12.5 12.5 10.5" stroke="white" stroke-width="0.8" fill="none" stroke-linecap="round"/>'
            // body
            . '<rect x="5.5" y="13.5" width="9" height="4.5" rx="1.5" fill="black"/>'
            // arms
            . '<line x1="3" y1="14.5" x2="5.5" y2="15.5" stroke="black" stroke-width="1.2" stroke-linecap="round"/>'
            . '<line x1="17" y1="14.5" x2="14.5" y2="15.5" stroke="black" stroke-width="1.2" stroke-linecap="round"/>'
            // chest light
            . '<circle cx="10" cy="15.8" r="1.2" fill="white" opacity="0.6"/>'
            . '</svg>';

        return 'data:image/svg+xml;base64,' . base64_encode($svg);
    }

    /**
     * Enqueue CSS/JS only on Mark AI admin pages.
     */
    public function enqueue_assets($hook) {
        // Only load on our pages
        if (strpos($hook, 'mark-ai') === false) {
            return;
        }

        // Preconnect to Google Fonts for faster loading
        add_action('admin_head', function() {
            echo '<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>' . "\n";
            echo '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' . "\n";
        }, 1);

        // Google Fonts — Open Sans (Celestial High-Key design system)
        wp_enqueue_style('mark-ai-fonts', 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap', [], null);

        // Material Icons (only the weights we use: 400, filled=0)
        wp_enqueue_style('material-icons', 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap', [], null);

        // Our admin CSS
        wp_enqueue_style('mark-ai-admin', MARK_AI_URL . 'admin/css/admin.css', [], MARK_AI_VERSION);

        // Chart.js for analytics (loaded async — not render-blocking)
        wp_enqueue_script('chartjs', 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js', [], null, true);

        // Our admin JS (no jQuery dependency — pure vanilla JS)
        wp_enqueue_script('mark-ai-admin', MARK_AI_URL . 'admin/js/admin.js', [], MARK_AI_VERSION, true);

        // Pass config to JS
        wp_localize_script('mark-ai-admin', 'markAI', [
            'ajaxUrl'    => admin_url('admin-ajax.php'),
            'restUrl'    => rest_url('mark-ai/v1/'),
            'nonce'      => wp_create_nonce('wp_rest'),
            'pluginUrl'  => MARK_AI_URL,
            'version'    => MARK_AI_VERSION,
            'currentPage'=> isset($_GET['page']) ? sanitize_text_field( wp_unslash( $_GET['page'] ) ) : 'mark-ai', // phpcs:ignore WordPress.Security.NonceVerification.Recommended
        ]);
    }

    /**
     * All pages render a single container — the JS SPA takes over.
     */
    public function render_dashboard() {
        $this->render_app_shell('dashboard');
    }

    public function render_stores() {
        $this->render_app_shell('stores');
    }

    public function render_conversations() {
        $this->render_app_shell('conversations');
    }

    public function render_settings() {
        $this->render_app_shell('settings');
    }

    /**
     * Render the SPA shell — JS handles everything.
     */
    private function render_app_shell($page) {
        ?>
        <div id="mark-ai-app" data-page="<?php echo esc_attr($page); ?>">
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:400px;color:#4f6169;gap:16px;">
                <div class="mark-robot-loader">
                    <svg width="56" height="56" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <line x1="10" y1="1" x2="10" y2="3.5" stroke="#954921" stroke-width="1.2" stroke-linecap="round"/>
                        <circle cx="10" cy="1" r="1" fill="#fc9b6c"/>
                        <rect x="3.5" y="3.5" width="13" height="9" rx="3" fill="#954921"/>
                        <circle cx="7.2" cy="8" r="1.8" fill="white"/>
                        <circle cx="12.8" cy="8" r="1.8" fill="white"/>
                        <circle cx="7.2" cy="8" r="0.8" fill="#1a1a1a"/>
                        <circle cx="12.8" cy="8" r="0.8" fill="#1a1a1a"/>
                        <path d="M7.5 10.5 Q10 12.5 12.5 10.5" stroke="#fc9b6c" stroke-width="0.8" fill="none" stroke-linecap="round"/>
                    </svg>
                </div>
                <span style="font-family:'Open Sans',sans-serif;font-size:16px;font-weight:400;color:#4f6169;">Loading Mark AI...</span>
            </div>
        </div>
        <style>
            .mark-robot-loader{animation:markRobotBob 1s ease-in-out infinite;}
            @keyframes markRobotBob{0%,100%{transform:translateY(0) rotate(0deg)}25%{transform:translateY(-8px) rotate(-5deg)}50%{transform:translateY(0) rotate(0deg)}75%{transform:translateY(-8px) rotate(5deg)}}
        </style>
        <?php
    }
}
