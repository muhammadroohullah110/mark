<?php
/**
 * Mark AI — Auto-Updater via GitHub Releases
 *
 * How it works:
 * 1. WordPress checks for plugin updates periodically
 * 2. This class hooks into that check
 * 3. Fetches latest release from your GitHub repo
 * 4. If GitHub version > installed version → shows "Update Available"
 * 5. User clicks Update → downloads ZIP from GitHub Release
 *
 * To release an update:
 * 1. Update version in mark-ai-chatbot.php header
 * 2. Push to GitHub
 * 3. Create a Release (e.g. v1.1.0) and attach the plugin ZIP
 * 4. All users see the update automatically!
 */

defined('ABSPATH') || exit;

class Mark_AI_Updater {

    private $slug;
    private $plugin_file;
    private $github_user   = 'muhammadroohullah110';
    private $github_repo   = 'mark';
    private $plugin_folder = 'mark-ai-chatbot';
    private $cache_key     = 'mark_ai_update_check';
    private $cache_ttl     = 21600; // 6 hours

    public function __construct() {
        $this->slug        = 'mark-ai-chatbot/mark-ai-chatbot.php';
        $this->plugin_file = MARK_AI_PATH . 'mark-ai-chatbot.php';

        // Hook into WordPress update system
        add_filter('pre_set_site_transient_update_plugins', [$this, 'check_for_update']);
        add_filter('plugins_api', [$this, 'plugin_info'], 20, 3);
        add_filter('upgrader_post_install', [$this, 'after_install'], 10, 3);
    }

    /**
     * Fetch latest release info from GitHub API.
     */
    private function get_github_release() {
        $cached = get_transient($this->cache_key);
        if ($cached !== false) {
            return $cached;
        }

        $url = sprintf(
            'https://api.github.com/repos/%s/%s/releases/latest',
            $this->github_user,
            $this->github_repo
        );

        $response = wp_remote_get($url, [
            'timeout' => 10,
            'headers' => [
                'Accept'     => 'application/vnd.github.v3+json',
                'User-Agent' => 'Mark-AI-Updater/' . MARK_AI_VERSION,
            ],
        ]);

        if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
            return false;
        }

        $release = json_decode(wp_remote_retrieve_body($response));
        if (empty($release->tag_name)) {
            return false;
        }

        $data = [
            'version'     => ltrim($release->tag_name, 'v'),
            'name'        => $release->name ?? ('Mark AI v' . ltrim($release->tag_name, 'v')),
            'description' => $release->body ?? '',
            'zip_url'     => $this->get_zip_url($release),
            'published'   => $release->published_at ?? '',
            'html_url'    => $release->html_url ?? '',
        ];

        set_transient($this->cache_key, $data, $this->cache_ttl);
        return $data;
    }

    /**
     * Get the ZIP download URL from release assets or fallback to zipball.
     */
    private function get_zip_url($release) {
        // First check for an attached ZIP asset (preferred)
        if (!empty($release->assets)) {
            foreach ($release->assets as $asset) {
                if (str_ends_with($asset->name, '.zip')) {
                    return $asset->browser_download_url;
                }
            }
        }

        // Fallback: GitHub's auto-generated zipball
        return $release->zipball_url ?? '';
    }

    /**
     * Hook: Check if an update is available.
     */
    public function check_for_update($transient) {
        if (empty($transient->checked)) {
            return $transient;
        }

        $release = $this->get_github_release();
        if (!$release || empty($release['version'])) {
            return $transient;
        }

        // Compare versions
        if (version_compare($release['version'], MARK_AI_VERSION, '>')) {
            $transient->response[$this->slug] = (object) [
                'slug'        => $this->plugin_folder,
                'plugin'      => $this->slug,
                'new_version' => $release['version'],
                'url'         => $release['html_url'],
                'package'     => $release['zip_url'],
                'icons'       => [
                    '1x' => MARK_AI_URL . 'assets/icon-128.png',
                ],
            ];
        }

        return $transient;
    }

    /**
     * Hook: Show plugin info in the "View Details" popup.
     */
    public function plugin_info($result, $action, $args) {
        if ($action !== 'plugin_information' || ($args->slug ?? '') !== $this->plugin_folder) {
            return $result;
        }

        $release = $this->get_github_release();
        if (!$release) {
            return $result;
        }

        return (object) [
            'name'          => 'Mark AI — Shopping Companion',
            'slug'          => $this->plugin_folder,
            'version'       => $release['version'],
            'author'        => '<a href="https://www.linkedin.com/in/medicalairesearcher">Muhammad Roohullah</a>',
            'homepage'      => 'https://github.com/' . $this->github_user . '/' . $this->github_repo,
            'download_link' => $release['zip_url'],
            'requires'      => '5.8',
            'tested'        => '6.7',
            'requires_php'  => '7.4',
            'last_updated'  => $release['published'],
            'sections'      => [
                'description'  => 'AI-powered 3D robot shopping companion. Voice-first, multilingual, friend-first salesman.',
                'changelog'    => nl2br(esc_html($release['description'])),
            ],
        ];
    }

    /**
     * Hook: After install, rename folder if GitHub zipball has weird name.
     */
    public function after_install($response, $hook_extra, $result) {
        if (!isset($hook_extra['plugin']) || $hook_extra['plugin'] !== $this->slug) {
            return $result;
        }

        global $wp_filesystem;

        $install_dir = $result['destination'];
        $proper_dir  = WP_PLUGIN_DIR . '/' . $this->plugin_folder;

        // GitHub zipball extracts to "user-repo-hash/" — rename to our plugin folder
        if ($install_dir !== $proper_dir) {
            $wp_filesystem->move($install_dir, $proper_dir);
            $result['destination'] = $proper_dir;
        }

        // Re-activate if it was active
        if (is_plugin_active($this->slug)) {
            activate_plugin($this->slug);
        }

        // Clear update cache
        delete_transient($this->cache_key);

        return $result;
    }
}
