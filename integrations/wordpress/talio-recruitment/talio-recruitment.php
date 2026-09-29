<?php
/**
 * Plugin Name: Talio Recruitment Sync
 * Description: Two-way WP Job Openings jobs, applications and private resumes for Talio. Runs alongside TalentLens.
 * Version: 1.0.0
 * Author: Mushroom World Group
 * Requires PHP: 7.4
 */
if (!defined('ABSPATH')) { exit; }

final class Talio_Recruitment_Sync {
    const OPTION = 'talio_recruitment_connection';
    const HOOK = 'talio_recruitment_sync_tick';
    private static $applying = false;

    public static function boot() {
        add_filter('cron_schedules', function ($schedules) { $schedules['talio_minute'] = array('interval' => 60, 'display' => 'Every minute (Talio)'); return $schedules; });
        add_action('init', function () { if (!wp_next_scheduled(self::HOOK)) { wp_schedule_event(time() + 30, 'talio_minute', self::HOOK); } });
        add_action(self::HOOK, array(__CLASS__, 'run'));
        add_action('awsm_job_application_submitted', array(__CLASS__, 'queue'));
        add_action('wp_after_insert_post', function ($id, $post) { if (in_array($post->post_type, array('awsm_job_openings', 'awsm_job_application'), true)) { self::queue($id); } }, 100, 2);
        add_action('updated_post_meta', array(__CLASS__, 'meta_changed'), 100, 4);
        add_action('added_post_meta', array(__CLASS__, 'meta_changed'), 100, 4);
        add_action('admin_menu', function () { add_options_page('Talio Recruitment', 'Talio Recruitment', 'manage_options', 'talio-recruitment', array(__CLASS__, 'settings')); });
        add_action('admin_post_talio_recruitment_settings', array(__CLASS__, 'save_settings'));
        add_action('admin_post_talio_recruitment_resume', array(__CLASS__, 'download_resume'));
        add_filter('wp_get_attachment_url', array(__CLASS__, 'attachment_url'), 10, 2);
        add_filter('manage_awsm_job_application_posts_columns', function ($columns) { $columns['talio_sync'] = 'Talio sync'; return $columns; });
        add_action('manage_awsm_job_application_posts_custom_column', function ($column, $id) { if ($column === 'talio_sync') { echo esc_html(get_post_meta($id, '_talio_error', true) ?: (get_post_meta($id, '_talio_dirty', true) ? 'Pending sync' : (get_post_meta($id, '_talio_id', true) ? 'Synced · ' . get_post_meta($id, '_talio_stage', true) : 'Not synced'))); } }, 10, 2);
    }
    public static function meta_changed($meta_id, $post_id, $key, $value) {
        if (strpos($key, 'awsm_') === 0 && in_array(get_post_type($post_id), array('awsm_job_openings', 'awsm_job_application'), true)) { self::queue($post_id); }
    }
    public static function queue($id) {
        if (self::$applying || wp_is_post_revision($id)) { return; }
        update_post_meta($id, '_talio_dirty', wp_generate_uuid4());
        update_post_meta($id, '_talio_next_retry', 0);
    }
    private static function config() { return get_option(self::OPTION, array()); }
    private static function site() { return untrailingslashit(home_url()); }
    private static function api($data = null, $query = array(), $binary = false) {
        $config = self::config();
        if (empty($config['endpoint']) || empty($config['token'])) { throw new RuntimeException('Configure the Talio endpoint and connection token first.'); }
        $url = add_query_arg($query, $config['endpoint']);
        $response = wp_safe_remote_request($url, array(
            'method' => $data === null ? 'GET' : 'POST', 'timeout' => 25, 'redirection' => 0,
            'limit_response_size' => $binary ? 25 * 1024 * 1024 + 1 : 2 * 1024 * 1024,
            'headers' => array('Authorization' => 'Bearer ' . $config['token'], 'X-Talio-Site' => self::site(), 'Content-Type' => 'application/json'),
            'body' => $data === null ? null : wp_json_encode($data),
        ));
        if (is_wp_error($response)) { throw new RuntimeException('Talio connection failed. The queued record will retry.'); }
        $code = wp_remote_retrieve_response_code($response);
        if ($binary && $code === 200) { return $response; }
        $result = json_decode(wp_remote_retrieve_body($response), true);
        if ($code < 200 || $code >= 300 || empty($result['success'])) {
            throw new RuntimeException(isset($result['message']) ? sanitize_text_field($result['message']) : 'Talio returned HTTP ' . $code, $code);
        }
        return $result['data'];
    }
    private static function link($id, $record) {
        update_post_meta($id, '_talio_id', sanitize_text_field($record['id']));
        update_post_meta($id, '_talio_revision', sanitize_text_field($record['revision']));
    }
    private static function clean($id, $generation = null) {
        // A local edit while a network request is in flight must remain queued.
        if ($generation !== null && get_post_meta($id, '_talio_dirty', true) !== $generation) { return; }
        delete_post_meta($id, '_talio_dirty', $generation === null ? '' : $generation); delete_post_meta($id, '_talio_error'); delete_post_meta($id, '_talio_attempts'); delete_post_meta($id, '_talio_next_retry');
    }
    private static function export_job($id) {
        $generation = get_post_meta($id, '_talio_dirty', true);
        $post = get_post($id);
        if (!$post || $post->post_type !== 'awsm_job_openings') { throw new RuntimeException('Job record is unavailable.'); }
        $expiry = get_post_meta($id, 'awsm_job_expiry', true);
        $expires = $expiry && strtotime($expiry) ? gmdate('c', strtotime($expiry . ' 23:59:59')) : null;
        $status = $post->post_status === 'publish' ? 'open' : ($post->post_status === 'trash' ? 'cancelled' : 'draft');
        if ($status === 'open' && $expires && strtotime($expires) < time()) { $status = 'closed'; }
        $payload = array('action' => 'job', 'externalId' => (string) $id, 'id' => get_post_meta($id, '_talio_id', true) ?: null,
            'baseRevision' => get_post_meta($id, '_talio_revision', true) ?: null,
            'title' => $post->post_title, 'description' => wp_strip_all_tags(strip_shortcodes($post->post_content)), 'status' => $status,
            'location' => get_post_meta($id, '_talio_location', true), 'deadline' => $expires,
        );
        // Retain structured Talio fields without putting internal salary or interview notes online.
        $structured = get_post_meta($id, '_talio_job_fields', true);
        if (is_array($structured) && $post->post_content === get_post_meta($id, '_talio_rendered_content', true)) { $payload['description'] = $structured['description']; }
        if (is_array($structured)) { foreach (array('employmentType', 'workMode', 'requirements', 'responsibilities', 'skills', 'benefits') as $key) { if (isset($structured[$key])) { $payload[$key] = $structured[$key]; } } }
        $result = self::api($payload); self::link($id, $result); self::clean($id, $generation); return $result;
    }
    private static function export_application($id) {
        $generation = get_post_meta($id, '_talio_dirty', true);
        $post = get_post($id);
        $job_id = absint(get_post_meta($id, 'awsm_job_id', true)) ?: absint($post->post_parent);
        if (!$job_id) { throw new RuntimeException('Application has no related job. Set its job before retrying.'); }
        $job = get_post_meta($job_id, '_talio_id', true);
        if (!$job || get_post_meta($job_id, '_talio_dirty', true)) { $job = self::export_job($job_id)['id']; }
        $attachment_id = absint(get_post_meta($id, 'awsm_attachment_id', true));
        $path = $attachment_id ? get_attached_file($attachment_id) : false;
        $remote_resume = $attachment_id && get_post_meta($attachment_id, '_talio_resume_candidate', true);
        if ($attachment_id && !$remote_resume && (!$path || !is_readable($path))) { throw new RuntimeException('The application resume is missing or unreadable. Restore it before retrying.'); }
        $result = self::api(array('action' => 'application', 'externalId' => (string) $id,
            'id' => get_post_meta($id, '_talio_id', true) ?: null, 'baseRevision' => get_post_meta($id, '_talio_revision', true) ?: null,
            'jobId' => $job, 'fullName' => get_post_meta($id, 'awsm_applicant_name', true), 'email' => get_post_meta($id, 'awsm_applicant_email', true),
            'phone' => get_post_meta($id, 'awsm_applicant_phone', true), 'coverLetter' => get_post_meta($id, 'awsm_applicant_letter', true),
            'appliedAt' => get_post_time(DATE_ATOM, true, $id), 'hasResume' => (bool) $attachment_id,
            'stage' => get_post_meta($id, '_talio_stage', true) ?: 'applied',
        ));
        self::link($id, $result);
        if ($path && !$remote_resume) {
            $sha = hash_file('sha256', $path);
            if (get_post_meta($id, '_talio_resume_sha', true) !== $sha) {
                $upload = get_post_meta($id, '_talio_resume_upload', true);
                if (!is_array($upload) || $upload['sha'] !== $sha) {
                    $upload = self::api(array('action' => 'resume-prepare', 'candidateId' => $result['id'], 'name' => basename($path), 'size' => filesize($path), 'sha256' => $sha));
                    $upload['sha'] = $sha; $upload['next'] = 0;
                    update_post_meta($id, '_talio_resume_upload', $upload);
                }
                $handle = fopen($path, 'rb'); if (!$handle) { throw new RuntimeException('Resume could not be opened.'); }
                try {
                    for ($attempt = 0; $attempt < 4 && $upload['next'] < $upload['chunks']; $attempt++) {
                        fseek($handle, $upload['next'] * $upload['chunkSize']);
                        self::api(array('action' => 'resume-chunk', 'uploadId' => $upload['uploadId'], 'index' => $upload['next'], 'data' => base64_encode(fread($handle, $upload['chunkSize']))));
                        $upload['next']++; update_post_meta($id, '_talio_resume_upload', $upload);
                    }
                } finally { fclose($handle); }
                if ($upload['next'] < $upload['chunks']) { return false; }
                try { $result = self::api(array('action' => 'resume-complete', 'uploadId' => $upload['uploadId'])); }
                catch (Throwable $error) { if ($error->getCode() === 409) { delete_post_meta($id, '_talio_resume_upload'); } throw $error; }
                self::link($id, $result); update_post_meta($id, '_talio_resume_sha', $sha); delete_post_meta($id, '_talio_resume_upload');
            }
        }
        self::clean($id, $generation); return true;
    }
    private static function find_link($type, $id) {
        $ids = get_posts(array('post_type' => $type, 'post_status' => array('publish', 'draft', 'private', 'pending', 'future', 'trash'), 'numberposts' => 1, 'fields' => 'ids', 'meta_key' => '_talio_id', 'meta_value' => $id));
        return $ids ? $ids[0] : 0;
    }
    private static function receive($kind, $record) {
        $is_job = $kind === 'jobs'; $type = $is_job ? 'awsm_job_openings' : 'awsm_job_application';
        $id = self::find_link($type, $record['id']);
        if (!$id && !empty($record['externalId'])) { $existing = get_post(absint($record['externalId'])); if ($existing && $existing->post_type === $type) { $id = $existing->ID; } }
        if ($id && get_post_meta($id, '_talio_dirty', true)) { return false; } // Never overwrite queued local edits.
        if ($id && get_post_meta($id, '_talio_revision', true) === $record['revision']) { return true; }
        $previous_applying = self::$applying; self::$applying = true;
        try {
            $post = array('ID' => $id, 'post_type' => $type);
            if ($is_job) {
                $post['post_title'] = sanitize_text_field($record['title']);
                $post['post_content'] = wpautop(esc_html($record['description']));
                foreach (array('location' => 'Location', 'employmentType' => 'Employment type', 'workMode' => 'Work mode') as $key => $label) {
                    if (!empty($record[$key])) { $post['post_content'] .= '<p><strong>' . esc_html($label) . ':</strong> ' . esc_html($record[$key]) . '</p>'; }
                }
                foreach (array('responsibilities', 'requirements', 'skills', 'benefits') as $key) {
                    if (!empty($record[$key])) { $post['post_content'] .= '<h3>' . esc_html(ucfirst($key)) . '</h3><ul>'; foreach ($record[$key] as $item) { $post['post_content'] .= '<li>' . esc_html($item) . '</li>'; } $post['post_content'] .= '</ul>'; }
                }
                $post['post_status'] = $record['status'] === 'open' ? 'publish' : 'draft';
            } else {
                $job_id = self::find_link('awsm_job_openings', $record['jobId']);
                if (!$job_id) { self::receive('jobs', self::api(null, array('action' => 'job', 'id' => $record['jobId']))); $job_id = self::find_link('awsm_job_openings', $record['jobId']); }
                if (!$job_id) { throw new RuntimeException('Sync the parent job before this application.'); }
                $post['post_title'] = sanitize_text_field($record['fullName']); $post['post_content'] = sanitize_textarea_field($record['coverLetter']);
                $post['post_status'] = 'publish'; $post['post_parent'] = $job_id;
                if (!$id && !empty($record['appliedAt'])) { $post['post_date_gmt'] = gmdate('Y-m-d H:i:s', strtotime($record['appliedAt'])); $post['post_date'] = get_date_from_gmt($post['post_date_gmt']); }
            }
            $id = wp_insert_post(wp_slash($post), true);
            if (is_wp_error($id)) { throw new RuntimeException('WordPress could not save the synced record.'); }
            if ($is_job) {
                update_post_meta($id, '_talio_job_fields', $record);
                update_post_meta($id, '_talio_rendered_content', get_post_field('post_content', $id));
                update_post_meta($id, '_talio_location', sanitize_text_field($record['location']));
                update_post_meta($id, 'awsm_job_expiry', empty($record['deadline']) ? '' : gmdate('Y-m-d', strtotime($record['deadline'])));
            } else {
                $meta = array('awsm_job_id' => $job_id, 'awsm_apply_for' => get_the_title($job_id), 'awsm_applicant_name' => $record['fullName'], 'awsm_applicant_email' => $record['email'], 'awsm_applicant_phone' => $record['phone'], 'awsm_applicant_letter' => $record['coverLetter'], '_talio_stage' => $record['stage']);
                foreach ($meta as $key => $value) { update_post_meta($id, $key, $value); }
                $current_attachment = absint(get_post_meta($id, 'awsm_attachment_id', true));
                if (!empty($record['resume']['available']) && (!$current_attachment || !get_post_meta($current_attachment, '_talio_resume_candidate', true))) {
                    $attachment = wp_insert_attachment(array('post_title' => sanitize_file_name($record['resume']['name']), 'post_status' => 'inherit', 'post_mime_type' => 'application/octet-stream'), false, $id, true);
                    if (is_wp_error($attachment)) { throw new RuntimeException('Resume link could not be saved.'); }
                    update_post_meta($attachment, '_talio_resume_candidate', $record['id']);
                    update_post_meta($attachment, 'awsm_actual_file_name', sanitize_file_name($record['resume']['name']));
                    if ($current_attachment) { update_post_meta($id, '_talio_original_attachment', $current_attachment); }
                    update_post_meta($id, 'awsm_attachment_id', $attachment);
                }
            }
            self::link($id, $record); self::clean($id); return true;
        } finally { self::$applying = $previous_applying; }
    }
    public static function run() {
        $config = self::config();
        if (empty($config['token']) || !post_type_exists('awsm_job_openings')) { return; }
        global $wpdb;
        $lock_name = 'talio_recruitment_lock';
        $lock = get_option($lock_name);
        if ($lock && (int) $lock > time()) { return; }
        if ($lock) { $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s", $lock_name, $lock)); wp_cache_delete($lock_name, 'options'); }
        $owner = (time() + 900) . ':' . wp_generate_uuid4();
        if (!add_option($lock_name, $owner, '', false)) { return; }
        $errors = array(); $start = time();
        try {
            $backfill = get_option('talio_recruitment_backfill', false);
            if ($backfill !== false) {
                $ids = get_posts(array('post_type' => array('awsm_job_openings', 'awsm_job_application'), 'post_status' => array('publish', 'draft', 'private', 'pending', 'future', 'trash'), 'numberposts' => 100, 'offset' => absint($backfill), 'orderby' => 'ID', 'order' => 'ASC', 'fields' => 'ids'));
                foreach ($ids as $id) { self::queue($id); }
                if (count($ids) < 100) { delete_option('talio_recruitment_backfill'); } else { update_option('talio_recruitment_backfill', absint($backfill) + 100, false); }
            }
            $ids = get_posts(array('post_type' => array('awsm_job_openings', 'awsm_job_application'), 'post_status' => array('publish', 'draft', 'private', 'pending', 'future', 'trash'), 'numberposts' => 10, 'fields' => 'ids', 'orderby' => 'ID', 'order' => 'ASC', 'meta_query' => array(array('key' => '_talio_dirty', 'compare' => 'EXISTS'), array('relation' => 'OR', array('key' => '_talio_next_retry', 'compare' => 'NOT EXISTS'), array('key' => '_talio_next_retry', 'value' => time(), 'compare' => '<=', 'type' => 'NUMERIC')))));
            foreach ($ids as $id) {
                if (time() - $start > 40) { break; }
                try { if (get_post_type($id) === 'awsm_job_openings') { self::export_job($id); } else { self::export_application($id); } }
                catch (Throwable $error) {
                    $attempt = absint(get_post_meta($id, '_talio_attempts', true)) + 1;
                    update_post_meta($id, '_talio_attempts', $attempt); update_post_meta($id, '_talio_error', sanitize_text_field($error->getMessage()));
                    update_post_meta($id, '_talio_next_retry', time() + min(3600, 30 * pow(2, min($attempt, 7))));
                    $errors[] = 'Record ' . $id . ': ' . $error->getMessage();
                }
            }
            foreach (array('jobs', 'applications') as $kind) {
                if (time() - $start > 40) { break; }
                $cursor = get_option('talio_recruitment_cursor_' . $kind, '');
                $feed = self::api(null, array('kind' => $kind, 'cursor' => $cursor));
                foreach ($feed['records'] as $record) {
                    if (!self::receive($kind, $record)) { throw new RuntimeException('Pending WordPress edits must sync before the incoming feed continues. Review the retry list.'); }
                }
                update_option('talio_recruitment_cursor_' . $kind, $feed['cursor'], false);
            }
            self::api(array('action' => 'checkpoint', 'error' => $errors ? 'Some WordPress records need retry. See WordPress Settings → Talio Recruitment.' : ''));
            update_option('talio_recruitment_last_run', gmdate('c'), false);
        } catch (Throwable $error) { $errors[] = $error->getMessage(); }
        finally { update_option('talio_recruitment_error', sanitize_text_field(implode(' | ', array_slice($errors, 0, 3))), false); $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s", $lock_name, $owner)); wp_cache_delete($lock_name, 'options'); }
    }
    public static function attachment_url($url, $attachment_id) {
        if (get_post_meta($attachment_id, '_talio_resume_candidate', true)) {
            return wp_nonce_url(admin_url('admin-post.php?action=talio_recruitment_resume&attachment=' . absint($attachment_id)), 'talio_resume_' . absint($attachment_id));
        }
        return $url;
    }
    public static function download_resume() {
        $id = absint($_GET['attachment'] ?? 0); check_admin_referer('talio_resume_' . $id);
        $attachment = get_post($id);
        if (!$attachment || !current_user_can('edit_post', $attachment->post_parent)) { wp_die('Not allowed', '', array('response' => 403)); }
        $candidate = get_post_meta($id, '_talio_resume_candidate', true);
        if (!$candidate) { wp_die('Resume not found'); }
        try {
            $response = self::api(null, array('action' => 'resume', 'candidateId' => $candidate), true);
            $body = wp_remote_retrieve_body($response);
            if (strlen($body) > 25 * 1024 * 1024) { throw new RuntimeException('Resume exceeds 25 MB'); }
            nocache_headers(); header('X-Content-Type-Options: nosniff'); header('Content-Type: application/octet-stream');
            header('Content-Disposition: attachment; filename="' . sanitize_file_name(get_post_meta($id, 'awsm_actual_file_name', true) ?: 'resume') . '"');
            echo $body; exit;
        } catch (Throwable $error) { wp_die(esc_html($error->getMessage())); }
    }
    public static function save_settings() {
        if (!current_user_can('manage_options')) { wp_die('Not allowed'); }
        check_admin_referer('talio_recruitment_settings'); $action = sanitize_key($_POST['operation'] ?? 'save');
        $config = self::config();
        if ($action === 'save') {
            $endpoint = esc_url_raw(wp_unslash($_POST['endpoint'] ?? ''));
            if (!preg_match('#^https://[^/?\#@]+/api/integrations/wordpress/[a-zA-Z0-9-]+$#', $endpoint)) { wp_die('Copy the HTTPS connection endpoint from Talio Settings.'); }
            if (!empty($config['endpoint']) && $config['endpoint'] !== $endpoint) { wp_die('Changing the connected organisation requires a separate migration.'); }
            $token = trim(wp_unslash($_POST['token'] ?? ''));
            if (!$token) { $token = $config['token'] ?? ''; }
            if (!preg_match('/^[a-zA-Z0-9_-]{40,100}$/', $token)) { wp_die('Enter the connection token generated by Talio.'); }
            update_option(self::OPTION, array('endpoint' => $endpoint, 'token' => $token), false);
            try { self::api(null, array('action' => 'ping')); update_option('talio_recruitment_error', '', false); }
            catch (Throwable $error) { update_option('talio_recruitment_error', sanitize_text_field($error->getMessage()), false); }
        } elseif ($action === 'backfill') { update_option('talio_recruitment_backfill', 0, false); delete_option('talio_recruitment_cursor_jobs'); delete_option('talio_recruitment_cursor_applications'); }
        elseif ($action === 'use_talio') {
            $id = absint($_POST['record'] ?? 0);
            if (!in_array(get_post_type($id), array('awsm_job_openings', 'awsm_job_application'), true) || !get_post_meta($id, '_talio_id', true)) { wp_die('No linked Talio record. Fix this record in its editor.'); }
            self::clean($id); delete_post_meta($id, '_talio_revision'); delete_option('talio_recruitment_cursor_jobs'); delete_option('talio_recruitment_cursor_applications');
        }
        if ($action !== 'save') { self::run(); }
        wp_safe_redirect(admin_url('options-general.php?page=talio-recruitment')); exit;
    }
    public static function settings() {
        if (!current_user_can('manage_options')) { return; }
        $config = self::config();
        echo '<div class="wrap"><h1>Talio Recruitment</h1><p>Two-way jobs and applications with private resume access. TalentLens can remain active alongside this connector.</p>';
        if (!post_type_exists('awsm_job_openings')) { echo '<div class="notice notice-error"><p>Activate WP Job Openings first.</p></div>'; }
        echo '<p>Last completed sync: ' . esc_html(get_option('talio_recruitment_last_run') ?: 'Not connected yet') . '</p>';
        if (get_option('talio_recruitment_error')) { echo '<div class="notice notice-error"><p>' . esc_html(get_option('talio_recruitment_error')) . '</p></div>'; }
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">'; wp_nonce_field('talio_recruitment_settings');
        echo '<input type="hidden" name="action" value="talio_recruitment_settings"><input type="hidden" name="operation" value="save"><table class="form-table"><tr><th><label for="talio-endpoint">Talio endpoint</label></th><td><input id="talio-endpoint" class="large-text" name="endpoint" type="url" required value="' . esc_attr($config['endpoint'] ?? '') . '"></td></tr><tr><th><label for="talio-token">Connection token</label></th><td><input id="talio-token" class="large-text" name="token" type="password" autocomplete="new-password"><p>Leave empty to retain the saved token. Generate or rotate it in Talio → Settings → Recruitment.</p></td></tr></table>';
        submit_button('Save & test connection'); echo '</form>';
        foreach (array('sync' => 'Sync now', 'backfill' => 'Import existing jobs and applications / rescan') as $operation => $label) { echo '<form style="display:inline-block;margin-right:12px" method="post" action="' . esc_url(admin_url('admin-post.php')) . '">'; wp_nonce_field('talio_recruitment_settings'); echo '<input type="hidden" name="action" value="talio_recruitment_settings"><input type="hidden" name="operation" value="' . esc_attr($operation) . '">'; submit_button($label, 'secondary'); echo '</form>'; }
        echo '<p>Automatic sync is queued every minute. Configure your hosting scheduler to run WordPress cron every minute for reliable delivery when the site has no visitors. Large resumes transfer over several runs. Closed jobs become drafts on the website. Permanent deletions are not propagated.</p><h2>Records needing attention</h2>';
        $errors = get_posts(array('post_type' => array('awsm_job_openings', 'awsm_job_application'), 'post_status' => 'any', 'numberposts' => 30, 'meta_query' => array(array('key' => '_talio_error', 'compare' => 'EXISTS'))));
        if (!$errors) { echo '<p>No record errors.</p>'; }
        foreach ($errors as $post) {
            echo '<p><a href="' . esc_url(get_edit_post_link($post->ID)) . '">' . esc_html($post->post_title) . '</a>: ' . esc_html(get_post_meta($post->ID, '_talio_error', true)) . '</p>';
            if (get_post_meta($post->ID, '_talio_id', true)) { echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">'; wp_nonce_field('talio_recruitment_settings'); echo '<input type="hidden" name="action" value="talio_recruitment_settings"><input type="hidden" name="operation" value="use_talio"><input type="hidden" name="record" value="' . absint($post->ID) . '">'; submit_button('Discard queued edits and use Talio version', 'secondary small'); echo '</form>'; }
        }
        echo '</div>';
    }
}
Talio_Recruitment_Sync::boot();
register_deactivation_hook(__FILE__, function () { wp_clear_scheduled_hook(Talio_Recruitment_Sync::HOOK); });
