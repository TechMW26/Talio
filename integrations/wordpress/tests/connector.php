<?php
// Isolated contract tests. No WordPress installation, network or real candidate data.
define('ABSPATH', '/');
$meta = array(); $posts = array(); $requests = array(); $during_request = null;
function add_action(...$args) {} function add_filter(...$args) {} function register_deactivation_hook(...$args) {}
function wp_is_post_revision($id) { return false; }
function wp_generate_uuid4() { return uniqid('generation-', true); }
function update_post_meta($id, $key, $value) { global $meta; $meta[$id][$key] = $value; }
function get_post_meta($id, $key, $single = true) { global $meta; return $meta[$id][$key] ?? ''; }
function delete_post_meta($id, $key, $value = '') { global $meta; if ($value === '' || ($meta[$id][$key] ?? null) === $value) { unset($meta[$id][$key]); } }
function get_post($id) { global $posts; return $posts[$id] ?? null; }
function get_post_type($id) { $post = get_post($id); return $post ? $post->post_type : ''; }
function get_post_field($key, $id) { return get_post($id)->$key; }
function get_posts($args) { global $posts; $found = array(); foreach ($posts as $id => $post) { if ($post->post_type === $args['post_type'] && get_post_meta($id, $args['meta_key']) === $args['meta_value']) { $found[] = $id; } } return $found; }
function wp_insert_post($input, $error = false) { global $posts; $id = $input['ID'] ?: count($posts) + 1; $input['ID'] = $id; $posts[$id] = (object) $input; Talio_Recruitment_Sync::queue($id); return $id; }
function get_option($key, $default = false) { return $key === 'talio_recruitment_connection' ? array('endpoint' => 'https://talio.test/api/integrations/wordpress/test', 'token' => 'test-only') : $default; }
function home_url() { return 'https://careers.test/'; } function untrailingslashit($v) { return rtrim($v, '/'); }
function add_query_arg($q, $url) { return $url . '?' . http_build_query($q); }
function wp_json_encode($v) { return json_encode($v); } function sanitize_text_field($v) { return strip_tags($v); }
function sanitize_textarea_field($v) { return strip_tags($v); } function wp_strip_all_tags($v) { return strip_tags($v); }
function strip_shortcodes($v) { return $v; } function esc_html($v) { return htmlspecialchars($v, ENT_QUOTES); }
function wpautop($v) { return '<p>' . $v . '</p>'; } function wp_slash($v) { return $v; }
function is_wp_error($v) { return false; } function absint($v) { return abs((int) $v); }
function wp_remote_retrieve_response_code($v) { return $v['status']; }
function wp_remote_retrieve_body($v) { return $v['body']; }
function wp_safe_remote_request($url, $args) {
    global $requests, $during_request;
    $body = json_decode($args['body'], true); $requests[] = $body;
    if ($during_request) { $during_request(); $during_request = null; }
    return array('status' => 200, 'body' => json_encode(array('success' => true, 'data' => array('id' => 'aaaaaaaaaaaaaaaaaaaaaaaa', 'revision' => '2026-01-02T00:00:00.000Z'))));
}
function check($condition, $message) { if (!$condition) { throw new RuntimeException($message); } echo 'PASS ' . $message . "\n"; }
require $argv[1];
$reflect = new ReflectionClass('Talio_Recruitment_Sync');
$invoke = function ($name, ...$args) use ($reflect) { $method = $reflect->getMethod($name); $method->setAccessible(true); return $method->invoke(null, ...$args); };

$posts[1] = (object) array('ID' => 1, 'post_type' => 'awsm_job_openings', 'post_title' => 'Engineer', 'post_content' => '<p>Build software</p>', 'post_status' => 'publish');
Talio_Recruitment_Sync::queue(1); $generation = get_post_meta(1, '_talio_dirty');
Talio_Recruitment_Sync::queue(1);
$invoke('clean', 1, $generation);
check((bool) get_post_meta(1, '_talio_dirty'), 'newer edit survives stale cleanup');
$during_request = function () { Talio_Recruitment_Sync::queue(1); };
$invoke('export_job', 1);
check((bool) get_post_meta(1, '_talio_dirty'), 'edit during HTTP request remains queued');
$invoke('export_job', 1);
check(!get_post_meta(1, '_talio_dirty'), 'successful unchanged export clears queue');
check($requests[0]['status'] === 'open' && $requests[0]['description'] === 'Build software', 'WordPress public job exports normalized fields');
check(!isset($requests[0]['salaryRange']), 'private salary absent from request');

$record = array('id' => 'bbbbbbbbbbbbbbbbbbbbbbbb', 'revision' => '2026-01-03T00:00:00.000Z', 'title' => 'Designer', 'description' => 'Design products', 'status' => 'open', 'location' => 'Indore', 'employmentType' => 'full-time', 'workMode' => 'hybrid', 'requirements' => array('Portfolio'), 'skills' => array('Research'), 'responsibilities' => array(), 'benefits' => array(), 'deadline' => null);
check($invoke('receive', 'jobs', $record), 'Talio job received');
check(count($posts) === 2 && !get_post_meta(2, '_talio_dirty'), 'incoming record does not echo into queue');
check(strpos($posts[2]->post_content, 'Portfolio') !== false && strpos($posts[2]->post_content, 'Indore') !== false, 'public page contains requirements and location');
check($invoke('receive', 'jobs', $record) && count($posts) === 2, 'feed replay does not duplicate job');
Talio_Recruitment_Sync::queue(2);
check($invoke('receive', 'jobs', $record) === false, 'incoming update cannot overwrite pending edit');
$invoke('export_job', 2);
check(end($requests)['description'] === 'Design products', 'structured fields do not duplicate into description on round trip');
echo "All PHP connector contract checks passed.\n";
