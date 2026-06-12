<?php
/**
 * Plugin Name: Theatre Maniac Automation
 * Description: Triggers the Theatre Maniac GitHub Actions post-processing workflow when Ulysses uploads a new Chinese post.
 * Version: 0.1.0
 * Author: Theatre Maniac
 */

if (!defined('ABSPATH')) {
    exit;
}

const TM_AUTOMATION_OPTION = 'tm_automation_settings';
const TM_AUTOMATION_META = '_tm_automation_dispatched';
const TM_AUTOMATION_EVENT = 'wordpress_post_uploaded';

function tm_automation_defaults(): array {
    return [
        'enabled' => '1',
        'github_repo' => 'bancesun/theatremaniac-headless',
        'github_token' => '',
        'source_lang' => 'zh',
        'target_lang' => 'en',
        'translation_status' => 'draft',
    ];
}

function tm_automation_settings(): array {
    $saved = get_option(TM_AUTOMATION_OPTION, []);
    return array_merge(tm_automation_defaults(), is_array($saved) ? $saved : []);
}

function tm_automation_admin_menu(): void {
    add_options_page(
        'Theatre Maniac Automation',
        'Theatre Maniac Automation',
        'manage_options',
        'theatre-maniac-automation',
        'tm_automation_settings_page'
    );
}
add_action('admin_menu', 'tm_automation_admin_menu');

function tm_automation_register_settings(): void {
    register_setting('tm_automation', TM_AUTOMATION_OPTION, [
        'sanitize_callback' => 'tm_automation_sanitize_settings',
    ]);
}
add_action('admin_init', 'tm_automation_register_settings');

function tm_automation_sanitize_settings($input): array {
    $input = is_array($input) ? $input : [];
    $current = tm_automation_settings();
    $token = isset($input['github_token']) ? trim((string) $input['github_token']) : '';

    if ($token === '' && !empty($current['github_token'])) {
        $token = $current['github_token'];
    }

    return [
        'enabled' => empty($input['enabled']) ? '0' : '1',
        'github_repo' => sanitize_text_field($input['github_repo'] ?? $current['github_repo']),
        'github_token' => sanitize_text_field($token),
        'source_lang' => sanitize_key($input['source_lang'] ?? $current['source_lang']),
        'target_lang' => sanitize_key($input['target_lang'] ?? $current['target_lang']),
        'translation_status' => sanitize_key($input['translation_status'] ?? $current['translation_status']),
    ];
}

function tm_automation_settings_page(): void {
    $settings = tm_automation_settings();
    ?>
    <div class="wrap">
        <h1>Theatre Maniac Automation</h1>
        <p>When a new Chinese post is saved from Ulysses, this plugin triggers the GitHub Actions post-processing workflow.</p>
        <form method="post" action="options.php">
            <?php settings_fields('tm_automation'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row">Enabled</th>
                    <td>
                        <label>
                            <input type="checkbox" name="<?php echo esc_attr(TM_AUTOMATION_OPTION); ?>[enabled]" value="1" <?php checked($settings['enabled'], '1'); ?>>
                            Trigger automation for new source-language posts
                        </label>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="tm_github_repo">GitHub repository</label></th>
                    <td><input id="tm_github_repo" class="regular-text" type="text" name="<?php echo esc_attr(TM_AUTOMATION_OPTION); ?>[github_repo]" value="<?php echo esc_attr($settings['github_repo']); ?>"></td>
                </tr>
                <tr>
                    <th scope="row"><label for="tm_github_token">GitHub token</label></th>
                    <td>
                        <input id="tm_github_token" class="regular-text" type="password" name="<?php echo esc_attr(TM_AUTOMATION_OPTION); ?>[github_token]" value="" autocomplete="new-password">
                        <p class="description">Leave blank to keep the saved token. The token needs permission to create repository dispatch events.</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="tm_source_lang">Source language</label></th>
                    <td><input id="tm_source_lang" type="text" name="<?php echo esc_attr(TM_AUTOMATION_OPTION); ?>[source_lang]" value="<?php echo esc_attr($settings['source_lang']); ?>"></td>
                </tr>
                <tr>
                    <th scope="row"><label for="tm_target_lang">Target language</label></th>
                    <td><input id="tm_target_lang" type="text" name="<?php echo esc_attr(TM_AUTOMATION_OPTION); ?>[target_lang]" value="<?php echo esc_attr($settings['target_lang']); ?>"></td>
                </tr>
                <tr>
                    <th scope="row"><label for="tm_translation_status">Generated translation status</label></th>
                    <td>
                        <select id="tm_translation_status" name="<?php echo esc_attr(TM_AUTOMATION_OPTION); ?>[translation_status]">
                            <?php foreach (['draft', 'pending', 'publish'] as $status): ?>
                                <option value="<?php echo esc_attr($status); ?>" <?php selected($settings['translation_status'], $status); ?>><?php echo esc_html($status); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

function tm_automation_detect_source_language(int $post_id, WP_Post $post, string $source_lang, string $target_lang): bool {
    if (function_exists('pll_get_post_language')) {
        $lang = pll_get_post_language($post_id);
        if ($lang === $source_lang) {
            return true;
        }
        if ($lang === $target_lang) {
            return false;
        }
    }

    return (bool) preg_match('/[\x{3400}-\x{9FFF}]/u', $post->post_title . ' ' . wp_strip_all_tags($post->post_content));
}

function tm_automation_should_dispatch(int $post_id, WP_Post $post): bool {
    $settings = tm_automation_settings();

    if ($settings['enabled'] !== '1') {
        return false;
    }
    if (empty($settings['github_repo']) || empty($settings['github_token'])) {
        return false;
    }
    if ($post->post_type !== 'post') {
        return false;
    }
    if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) {
        return false;
    }
    if (in_array($post->post_status, ['auto-draft', 'trash', 'inherit'], true)) {
        return false;
    }
    if (get_post_meta($post_id, TM_AUTOMATION_META, true)) {
        return false;
    }
    if (!tm_automation_detect_source_language($post_id, $post, $settings['source_lang'], $settings['target_lang'])) {
        return false;
    }

    return trim(wp_strip_all_tags($post->post_content)) !== '';
}

function tm_automation_dispatch(int $post_id, WP_Post $post): void {
    if (!tm_automation_should_dispatch($post_id, $post)) {
        return;
    }

    $settings = tm_automation_settings();
    update_post_meta($post_id, TM_AUTOMATION_META, current_time('mysql'));

    $repo = trim($settings['github_repo'], " \t\n\r\0\x0B/");

    $response = wp_remote_post(
        sprintf('https://api.github.com/repos/%s/dispatches', $repo),
        [
            'timeout' => 15,
            'headers' => [
                'Accept' => 'application/vnd.github+json',
                'Authorization' => 'Bearer ' . $settings['github_token'],
                'Content-Type' => 'application/json',
                'User-Agent' => 'Theatre-Maniac-Automation',
                'X-GitHub-Api-Version' => '2022-11-28',
            ],
            'body' => wp_json_encode([
                'event_type' => TM_AUTOMATION_EVENT,
                'client_payload' => [
                    'post_id' => $post_id,
                    'source_lang' => $settings['source_lang'],
                    'target_lang' => $settings['target_lang'],
                    'status' => $settings['translation_status'],
                    'post_status' => $post->post_status,
                    'post_title' => $post->post_title,
                    'site_url' => home_url('/'),
                ],
            ]),
        ]
    );

    if (is_wp_error($response)) {
        delete_post_meta($post_id, TM_AUTOMATION_META);
        error_log('Theatre Maniac automation failed: ' . $response->get_error_message());
        return;
    }

    $code = wp_remote_retrieve_response_code($response);
    if ($code < 200 || $code >= 300) {
        delete_post_meta($post_id, TM_AUTOMATION_META);
        error_log('Theatre Maniac automation failed with GitHub status ' . $code . ': ' . wp_remote_retrieve_body($response));
    }
}
add_action('save_post_post', 'tm_automation_dispatch', 99, 2);
