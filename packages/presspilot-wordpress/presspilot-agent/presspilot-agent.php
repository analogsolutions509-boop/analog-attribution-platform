<?php
/**
 * Plugin Name: PressPilot Agent
 * Description: Secure WordPress execution bridge for Analog Solutions PressPilot.
 * Version: 0.2.1
 * Author: Analog Solutions
 */
defined('ABSPATH') || exit;

const PRESSPILOT_AGENT_VERSION = '0.2.1';
const PRESSPILOT_AGENT_TOKEN_HASH = 'presspilot_agent_token_hash';
const PRESSPILOT_AGENT_CONNECTION_ID = 'presspilot_agent_connection_id';
const PRESSPILOT_AGENT_API_BASE = 'presspilot_agent_api_base';
const PRESSPILOT_AGENT_PAIRED_AT = 'presspilot_agent_paired_at';

add_action('rest_api_init', static function () {
    register_rest_route('presspilot/v1', '/pair', [
        'methods' => 'POST',
        'permission_callback' => '__return_true',
        'callback' => 'presspilot_agent_pair',
    ]);
    register_rest_route('presspilot/v1', '/agent', [
        'methods' => 'POST',
        'permission_callback' => '__return_true',
        'callback' => 'presspilot_agent_execute',
    ]);
});

add_action('admin_menu', static function () {
    add_options_page(
        'PressPilot Agent', 'PressPilot', 'manage_options', 'presspilot-agent',
        'presspilot_agent_settings_page'
    );
});function presspilot_agent_hash_token(string $token): string {
    return hash('sha256', $token);
}

function presspilot_agent_bearer_token(): string {
    $header = isset($_SERVER['HTTP_AUTHORIZATION'])
        ? trim(wp_unslash((string) $_SERVER['HTTP_AUTHORIZATION'])) : '';
    if ($header === '' && function_exists('getallheaders')) {
        $headers = getallheaders();
        $header = isset($headers['Authorization']) ? trim((string) $headers['Authorization']) : '';
    }
    return preg_match('/^Bearer\s+(.+)$/i', $header, $matches) ? trim($matches[1]) : '';
}

function presspilot_agent_json_error(string $code, string $message, int $status = 400): WP_Error {
    return new WP_Error($code, $message, ['status' => $status]);
}

function presspilot_agent_is_paired(): bool {
    return (bool) get_option(PRESSPILOT_AGENT_TOKEN_HASH, '');
}

function presspilot_agent_pair(WP_REST_Request $request) {
    $code = sanitize_text_field((string) $request->get_param('code'));
    $site_url = esc_url_raw((string) $request->get_param('site_url'));
    $api_base = esc_url_raw((string) $request->get_param('api_base_url'));
    if ($code === '' || $site_url === '' || $api_base === '') {
        return presspilot_agent_json_error('pairing_input_required', 'code, site_url and api_base_url are required.');
    }
    if (!is_ssl() || wp_parse_url($site_url, PHP_URL_SCHEME) !== 'https') {
        return presspilot_agent_json_error('https_required', 'PressPilot pairing requires HTTPS.');
    }    $response = wp_remote_post(trailingslashit($api_base) . 'v1/presspilot/pair', [
        'timeout' => 20,
        'headers' => ['Accept' => 'application/json'],
        'body' => [
            'code' => $code,
            'site_url' => home_url('/'),
            'agent_name' => 'presspilot-agent',
            'agent_version' => PRESSPILOT_AGENT_VERSION,
        ],
    ]);
    if (is_wp_error($response)) {
        return presspilot_agent_json_error('pairing_request_failed', $response->get_error_message(), 502);
    }
    $status = wp_remote_retrieve_response_code($response);
    $data = json_decode(wp_remote_retrieve_body($response), true);
    if ($status < 200 || $status >= 300 || !is_array($data) || empty($data['agent_token'])) {
        $message = is_array($data) && !empty($data['error']) ? (string) $data['error'] : 'PressPilot pairing was rejected.';
        return presspilot_agent_json_error('pairing_rejected', $message, 400);
    }
    update_option(PRESSPILOT_AGENT_TOKEN_HASH, presspilot_agent_hash_token((string) $data['agent_token']), false);
    update_option(PRESSPILOT_AGENT_CONNECTION_ID, sanitize_text_field((string) ($data['connection']['id'] ?? '')), false);
    update_option(PRESSPILOT_AGENT_API_BASE, trailingslashit($api_base), false);
    update_option(PRESSPILOT_AGENT_PAIRED_AT, current_time('mysql', true), false);

    return new WP_REST_Response([
        'paired' => true,
        'connection_id' => get_option(PRESSPILOT_AGENT_CONNECTION_ID, ''),
        'agent_version' => PRESSPILOT_AGENT_VERSION,
    ], 201);
}

function presspilot_agent_execute(WP_REST_Request $request) {
    $token = presspilot_agent_bearer_token();
    $stored = (string) get_option(PRESSPILOT_AGENT_TOKEN_HASH, '');
    if ($token === '' || $stored === '' || !hash_equals($stored, presspilot_agent_hash_token($token))) {
        return presspilot_agent_json_error('unauthorized', 'Invalid PressPilot agent token.', 401);
    }    $operation = sanitize_key((string) $request->get_param('operation'));
    $args = $request->get_param('args');
    if (!is_array($args)) $args = [];
    try {
        return new WP_REST_Response(['result' => presspilot_agent_dispatch($operation, $args)], 200);
    } catch (Throwable $error) {
        return presspilot_agent_json_error('agent_operation_failed', substr($error->getMessage(), 0, 500));
    }
}

function presspilot_agent_dispatch(string $operation, array $args): array {
    switch ($operation) {
        case 'get_site':
            return [
                'name' => get_bloginfo('name'),
                'url' => home_url('/'),
                'wp_version' => get_bloginfo('version'),
                'locale' => get_locale(),
                'timezone' => wp_timezone_string(),
                'agent_version' => PRESSPILOT_AGENT_VERSION,
                'paired' => presspilot_agent_is_paired(),
            ];
        case 'list_posts': return presspilot_agent_list_content('post', $args);
        case 'list_pages': return presspilot_agent_list_content('page', $args);
        case 'create_post': return presspilot_agent_mutate_content('post', $args, 0);
        case 'update_post': return presspilot_agent_mutate_content('post', $args, presspilot_agent_id($args));
        case 'create_page': return presspilot_agent_mutate_content('page', $args, 0);
        case 'update_page': return presspilot_agent_mutate_content('page', $args, presspilot_agent_id($args));
        case 'list_plugins': return presspilot_agent_list_plugins();
        case 'search_content': return presspilot_agent_search_content($args);
        case 'get_post': return presspilot_agent_get_content('post', presspilot_agent_id($args));
        case 'get_page': return presspilot_agent_get_content('page', presspilot_agent_id($args));
        default: throw new RuntimeException('unsupported_operation');
    }
}

function presspilot_agent_id(array $args): int {
    $id = filter_var($args['id'] ?? null, FILTER_VALIDATE_INT);
    if (!$id || $id < 1) throw new InvalidArgumentException('wordpress_id_required');
    return (int) $id;
}

function presspilot_agent_list_content(string $post_type, array $args): array {
    $allowed_statuses = ['publish', 'draft', 'pending', 'private', 'future'];
    $status = sanitize_key((string) ($args['status'] ?? 'publish'));
    if (!in_array($status, $allowed_statuses, true)) $status = 'publish';
    $query = [
        'post_type' => $post_type,
        'post_status' => $status,
        'posts_per_page' => min(20, max(1, (int) ($args['per_page'] ?? 20))),
        'paged' => max(1, (int) ($args['page'] ?? 1)),
        'orderby' => sanitize_key((string) ($args['orderby'] ?? 'date')),
        'order' => strtoupper((string) ($args['order'] ?? 'DESC')) === 'ASC' ? 'ASC' : 'DESC',
    ];
    if (!empty($args['search'])) $query['s'] = sanitize_text_field((string) $args['search']);
    if (!empty($args['slug'])) $query['name'] = sanitize_title((string) $args['slug']);
    if (!empty($args['author'])) $query['author'] = (int) $args['author'];
    return array_map('presspilot_agent_content_shape', get_posts($query));
}

function presspilot_agent_content_shape(WP_Post $post): array {
    return [
        'id' => $post->ID,
        'slug' => $post->post_name,
        'status' => $post->post_status,
        'type' => $post->post_type,
        'link' => get_permalink($post),
        'title' => ['rendered' => get_the_title($post)],
        'content' => ['rendered' => apply_filters('the_content', $post->post_content)],
        'excerpt' => ['rendered' => get_the_excerpt($post)],
        'parent' => (int) $post->post_parent,
    ];
}function presspilot_agent_mutate_content(string $post_type, array $args, int $id): array {
    $status = sanitize_key((string) ($args['status'] ?? 'draft'));
    if (!in_array($status, ['draft', 'publish', 'pending', 'private', 'future'], true)) $status = 'draft';
    $payload = [
        'post_type' => $post_type,
        'post_title' => sanitize_text_field((string) ($args['title'] ?? '')),
        'post_content' => wp_kses_post((string) ($args['content'] ?? '')),
        'post_status' => $status,
    ];
    if (array_key_exists('slug', $args)) $payload['post_name'] = sanitize_title((string) $args['slug']);
    if (array_key_exists('excerpt', $args)) $payload['post_excerpt'] = wp_kses_post((string) $args['excerpt']);
    if ($post_type === 'page' && array_key_exists('parent', $args)) {
        $payload['post_parent'] = presspilot_agent_id(['id' => $args['parent']]);
    }
    if ($id > 0) $payload['ID'] = $id;
    if ($payload['post_title'] === '' && $payload['post_content'] === '' && empty($payload['post_name'])) {
        throw new InvalidArgumentException('content_required');
    }
    $saved = $id > 0 ? wp_update_post(wp_slash($payload), true) : wp_insert_post(wp_slash($payload), true);
    if (is_wp_error($saved)) throw new RuntimeException($saved->get_error_message());
    return presspilot_agent_get_content($post_type, (int) $saved);
}

function presspilot_agent_get_content(string $post_type, int $id): array {
    $post = get_post($id);
    if (!$post || $post->post_type !== $post_type) throw new RuntimeException('wordpress_content_not_found');
    return presspilot_agent_content_shape($post);
}

function presspilot_agent_list_plugins(): array {
    if (!function_exists('get_plugins')) require_once ABSPATH . 'wp-admin/includes/plugin.php';
    $active = (array) get_option('active_plugins', []);
    $items = [];
    foreach (get_plugins() as $file => $plugin) {
        $items[] = [
            'plugin' => $file,
            'name' => (string) ($plugin['Name'] ?? $file),
            'version' => (string) ($plugin['Version'] ?? ''),
            'status' => in_array($file, $active, true) ? 'active' : 'inactive',
        ];
    }
    return $items;
}

function presspilot_agent_search_content(array $args): array {
    $search = sanitize_text_field((string) ($args['search'] ?? ''));
    if ($search === '') throw new InvalidArgumentException('search_required');
    $posts = get_posts([
        'post_type' => ['post', 'page'],
        'post_status' => 'any',
        'posts_per_page' => 20,
        's' => $search,
    ]);
    return array_map(static function (WP_Post $post): array {
        return [
            'id' => $post->ID,
            'title' => ['rendered' => get_the_title($post)],
            'type' => $post->post_type,
            'status' => $post->post_status,
            'slug' => $post->post_name,
            'url' => get_permalink($post),
        ];
    }, $posts);
}function presspilot_agent_admin_pair(): void {
    if (!current_user_can('manage_options')) wp_die('Forbidden', 403);
    check_admin_referer('presspilot_pair');
    $code = sanitize_text_field((string) ($_POST['code'] ?? ''));
    $api_base = esc_url_raw((string) ($_POST['api_base_url'] ?? ''));
    $request = new WP_REST_Request('POST', '/presspilot/v1/pair');
    $request->set_body_params([
        'code' => $code,
        'site_url' => home_url('/'),
        'api_base_url' => $api_base,
    ]);
    $response = presspilot_agent_pair($request);
    $paired = is_wp_error($response) ? '0' : '1';
    wp_safe_redirect(add_query_arg([
        'page' => 'presspilot-agent',
        'paired' => $paired,
    ], admin_url('options-general.php')));
    exit;
}

function presspilot_agent_disconnect(): void {
    if (!current_user_can('manage_options')) wp_die('Forbidden', 403);
    check_admin_referer('presspilot_disconnect');
    delete_option(PRESSPILOT_AGENT_TOKEN_HASH);
    delete_option(PRESSPILOT_AGENT_CONNECTION_ID);
    delete_option(PRESSPILOT_AGENT_API_BASE);
    delete_option(PRESSPILOT_AGENT_PAIRED_AT);
    wp_safe_redirect(admin_url('options-general.php?page=presspilot-agent'));
    exit;
}

function presspilot_agent_settings_page(): void {
    if (!current_user_can('manage_options')) return;
    $paired = presspilot_agent_is_paired();
    $message = isset($_GET['paired']) && $_GET['paired'] === '1' ? 'PressPilot Agent paired.' : '';
    ?>
    <div class="wrap">
      <h1>PressPilot Agent</h1>
      <p>Secure AI execution bridge for this WordPress site.</p>
      <?php if ($message): ?><div class="notice notice-success"><p><?php echo esc_html($message); ?></p></div><?php endif; ?>
      <p><strong>Status:</strong> <?php echo $paired ? 'PAIRED' : 'NOT PAIRED'; ?></p>
      <?php if ($paired): ?>
        <p><strong>Connection ID:</strong> <?php echo esc_html(get_option(PRESSPILOT_AGENT_CONNECTION_ID, '')); ?></p>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
          <input type="hidden" name="action" value="presspilot_disconnect">
          <?php wp_nonce_field('presspilot_disconnect'); ?>
          <?php submit_button('Disconnect Agent', 'delete'); ?>
        </form>
      <?php else: ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="max-width:640px">
          <input type="hidden" name="action" value="presspilot_pair">
          <?php wp_nonce_field('presspilot_pair'); ?>
          <p><label for="presspilot-code"><strong>Pairing code</strong></label><br>
          <input id="presspilot-code" name="code" type="text" class="regular-text" placeholder="ABCD-234567" required></p>
          <p><label for="presspilot-api"><strong>PressPilot API base URL</strong></label><br>
          <input id="presspilot-api" name="api_base_url" type="url" class="regular-text" placeholder="https://api-jyu9-production.up.railway.app/" required></p>
          <?php submit_button('Pair PressPilot'); ?>
        </form>
      <?php endif; ?>
    </div>
    <?php
}
