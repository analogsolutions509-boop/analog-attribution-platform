<?php
/**
 * Plugin Name: Analog Solutions — PressPilot MainWP Bridge
 * Description: Secure MainWP bridge for installing and enrolling PressPilot Agent across selected child sites.
 * Version: 0.1.0
 * Author: Analog Solutions
 */
defined('ABSPATH') || exit;

const ANALOG_PRESSPILOT_MAINWP_BRIDGE_VERSION = '0.1.0';
const ANALOG_PRESSPILOT_MAINWP_API_URL = 'analog_presspilot_mainwp_api_url';
const ANALOG_PRESSPILOT_MAINWP_SECRET = 'analog_presspilot_mainwp_secret';
const ANALOG_PRESSPILOT_MAINWP_PACKAGE_URL = 'analog_presspilot_mainwp_package_url';

function analog_presspilot_mainwp_defaults(): void {
    if (!get_option(ANALOG_PRESSPILOT_MAINWP_API_URL, '')) {
        update_option(ANALOG_PRESSPILOT_MAINWP_API_URL, 'https://api-jyu9-production.up.railway.app');
    }
    if (!get_option(ANALOG_PRESSPILOT_MAINWP_PACKAGE_URL, '')) {
        update_option(
            ANALOG_PRESSPILOT_MAINWP_PACKAGE_URL,
            'https://raw.githubusercontent.com/analogsolutions509-boop/analog-attribution-platform/chore/presspilot-release-package/packages/PressPilot-WordPress-0.2.3-Single.zip'
        );
    }
}
register_activation_hook(__FILE__, 'analog_presspilot_mainwp_defaults');

add_action('admin_menu', static function (): void {
    add_management_page('PressPilot Fleet', 'PressPilot Fleet', 'manage_options', 'analog-presspilot-fleet', 'analog_presspilot_mainwp_admin_page');
});
add_action('admin_post_analog_presspilot_mainwp_save', 'analog_presspilot_mainwp_save_settings');
add_action('admin_post_analog_presspilot_mainwp_enroll', 'analog_presspilot_mainwp_admin_enroll');

add_action('rest_api_init', static function (): void {
    register_rest_route('analog-presspilot-mainwp/v1', '/status', [
        'methods' => 'GET',
        'permission_callback' => 'analog_presspilot_mainwp_permission',
        'callback' => 'analog_presspilot_mainwp_rest_status',
    ]);
    register_rest_route('analog-presspilot-mainwp/v1', '/sites', [
        'methods' => 'GET',
        'permission_callback' => 'analog_presspilot_mainwp_permission',
        'callback' => 'analog_presspilot_mainwp_rest_sites',
    ]);
    register_rest_route('analog-presspilot-mainwp/v1', '/enroll', [
        'methods' => 'POST',
        'permission_callback' => 'analog_presspilot_mainwp_permission',
        'callback' => 'analog_presspilot_mainwp_rest_enroll',
    ]);
});

function analog_presspilot_mainwp_permission(): bool {
    return current_user_can('manage_options');
}
function analog_presspilot_mainwp_api_url(): string {
    return untrailingslashit(trim((string) get_option(ANALOG_PRESSPILOT_MAINWP_API_URL, '')));
}
function analog_presspilot_mainwp_secret(): string {
    return trim((string) get_option(ANALOG_PRESSPILOT_MAINWP_SECRET, ''));
}
function analog_presspilot_mainwp_package_url(): string {
    return trim((string) get_option(ANALOG_PRESSPILOT_MAINWP_PACKAGE_URL, ''));
}
function analog_presspilot_mainwp_configured(): bool {
    return analog_presspilot_mainwp_api_url() !== '' && analog_presspilot_mainwp_secret() !== '' && analog_presspilot_mainwp_package_url() !== '';
}
function analog_presspilot_mainwp_mainwp_ready(): bool {
    return class_exists('MainWP_DB') || class_exists('MainWP\\Dashboard\\MainWP_DB');
}
function analog_presspilot_mainwp_db() {
    if (class_exists('MainWP_DB')) return \MainWP_DB::instance();
    if (class_exists('MainWP\\Dashboard\\MainWP_DB')) return \MainWP\Dashboard\MainWP_DB::instance();
    return null;
}

function analog_presspilot_mainwp_get_sites(): array {
    $db = analog_presspilot_mainwp_db();
    if (!$db || !method_exists($db, 'get_sites')) return [];
    $sites = $db->get_sites(null, false, ['orderby' => 'url', 'order' => 'asc']);
    if (!is_array($sites)) return [];
    $out = [];
    foreach ($sites as $site) {
        $id = is_array($site) ? ($site['id'] ?? 0) : ($site->id ?? 0);
        $url = is_array($site) ? ($site['url'] ?? '') : ($site->url ?? '');
        $name = is_array($site) ? ($site['name'] ?? '') : ($site->name ?? '');
        $sync = is_array($site) ? ($site['sync_errors'] ?? '') : ($site->sync_errors ?? '');
        if (is_numeric($id) && (int) $id > 0 && is_string($url) && $url !== '') {
            $out[] = ['id'=>(int)$id,'url'=>untrailingslashit($url),'name'=>(string)$name,'sync_errors'=>(string)$sync];
        }
    }
    return $out;
}

function analog_presspilot_mainwp_get_site(int $siteId) {
    $db = analog_presspilot_mainwp_db();
    if (!$db || !method_exists($db, 'get_website_by_id')) return null;
    $website = $db->get_website_by_id($siteId);
    if (!$website) return null;
    if (function_exists('mainwp_current_user_can') && !mainwp_current_user_can('site', $siteId)) return null;
    if (class_exists('MainWP_System_Utility') && method_exists('MainWP_System_Utility', 'can_edit_website')) {
        if (!\MainWP_System_Utility::can_edit_website($website)) return null;
    } elseif (class_exists('MainWP\\Dashboard\\MainWP_System_Utility') && method_exists('\MainWP\\Dashboard\\MainWP_System_Utility', 'can_edit_website')) {
        if (!\MainWP\Dashboard\MainWP_System_Utility::can_edit_website($website)) return null;
    }
    return $website;
}

function analog_presspilot_mainwp_child_response($data) {
    if (!is_string($data) || !preg_match('/<mainwp>(.*)<\\/mainwp>/s', $data, $matches)) {
        return new WP_Error('mainwp_unexpected_child_response', 'MainWP child returned an unexpected response.');
    }
    $decoded = base64_decode($matches[1], true);
    if ($decoded === false) return new WP_Error('mainwp_invalid_child_response', 'MainWP child response could not be decoded.');
    $utility = class_exists('MainWP_System_Utility') ? '\\MainWP_System_Utility' : '\\MainWP\\Dashboard\\MainWP_System_Utility';
    if (!class_exists(ltrim($utility, '\\')) || !method_exists($utility, 'get_child_response')) {
        return new WP_Error('mainwp_child_utility_missing', 'MainWP response utility is unavailable.');
    }
    return call_user_func([$utility, 'get_child_response'], $decoded);
}

function analog_presspilot_mainwp_call_child(string $what, $website, array $postData, callable $handler) {
    $connect = class_exists('MainWP_Connect') ? '\\MainWP_Connect' : '\\MainWP\\Dashboard\\MainWP_Connect';
    if (!class_exists(ltrim($connect, '\\')) || !method_exists($connect, 'fetch_urls_authed')) {
        return new WP_Error('mainwp_connect_missing', 'MainWP authenticated connector is unavailable.');
    }
    $output = (object)['ok'=>[],'errors'=>[],'results'=>[],'other_data'=>[]];
    $sites = [$website];
    call_user_func([$connect,'fetch_urls_authed'],$sites,$what,$postData,$handler,$output,null,['upgrade'=>true]);
    return $output;
}

function analog_presspilot_mainwp_install_agent($website) {
    $package = analog_presspilot_mainwp_package_url();
    if ($package === '' || !preg_match('#^https://#i', $package)) return new WP_Error('package_url_invalid','PressPilot Agent package URL must use HTTPS.');

    $handler = static function ($data, $site, &$output): void {
        $info = analog_presspilot_mainwp_child_response($data);
        if (is_wp_error($info)) { $output->errors[$site->id]=[$site->name,$info->get_error_code()]; return; }
        if (is_array($info) && ($info['installation'] ?? '') === 'SUCCESS') {
            $output->ok[$site->id]=[$site->name];
            $output->results[$site->id]=$info['install_results'] ?? [];
            return;
        }
        $msg = is_array($info) && !empty($info['error']) ? (string)$info['error'] : 'presspilot_agent_install_failed';
        $output->errors[$site->id]=[$site->name,sanitize_text_field($msg)];
    };

    return analog_presspilot_mainwp_call_child('installplugintheme',$website,[
        'type'=>'plugin','activatePlugin'=>'yes','overwrite'=>true,'url'=>wp_json_encode($package)
    ],$handler);
}

function analog_presspilot_mainwp_enroll_agent($website, string $apiBase, string $token) {
    $apiLiteral = wp_json_encode($apiBase);
    $tokenLiteral = wp_json_encode($token);
    $code = '$r = presspilot_agent_enroll_with_token(' . $apiLiteral . ', ' . $tokenLiteral . ');'
        . ' if (is_wp_error($r)) { echo "ERROR:" . sanitize_key($r->get_error_code()); }'
        . ' elseif (is_array($r) && !empty($r["enrolled"])) { echo "ENROLLED"; }'
        . ' else { echo "ERROR:enrollment_failed"; }';

    $handler = static function ($data, $site, &$output): void {
        $info = analog_presspilot_mainwp_child_response($data);
        if (is_wp_error($info)) { $output->errors[$site->id]=[$site->name,$info->get_error_code()]; return; }
        if (is_array($info) && ($info['status'] ?? '') === 'SUCCESS' && trim((string)($info['result'] ?? '')) === 'ENROLLED') {
            $output->ok[$site->id]=[$site->name];
            $output->results[$site->id]='ENROLLED';
            return;
        }
        $msg = is_array($info) ? sanitize_text_field((string)($info['result'] ?? 'presspilot_enrollment_failed')) : 'presspilot_enrollment_failed';
        $output->errors[$site->id]=[$site->name,$msg];
    };

    return analog_presspilot_mainwp_call_child('code_snippet',$website,[
        'action'=>'run_snippet','type'=>'R','code'=>$code
    ],$handler);
}

function analog_presspilot_mainwp_api_request(string $method, string $route, array $body = []) {
    $api = analog_presspilot_mainwp_api_url();
    $secret = analog_presspilot_mainwp_secret();
    if ($api === '' || $secret === '') return new WP_Error('bridge_not_configured','PressPilot MainWP bridge is not configured.');

    $url = $api . '/v1/presspilot/mainwp/' . ltrim($route,'/');
    $args = ['timeout'=>20,'headers'=>['Accept'=>'application/json','X-PressPilot-MainWP-Key'=>$secret]];
    if ($method === 'POST') {
        $args['headers']['Content-Type']='application/json';
        $args['body']=wp_json_encode($body);
        $response=wp_remote_post($url,$args);
    } else {
        $response=wp_remote_get(add_query_arg($body,$url),$args);
    }
    if (is_wp_error($response)) return $response;
    $status=wp_remote_retrieve_response_code($response);
    $data=json_decode(wp_remote_retrieve_body($response),true);
    if ($status<200 || $status>=300 || !is_array($data)) {
        $message=is_array($data) && !empty($data['error']) ? (string)$data['error'] : 'presspilot_api_http_'.$status;
        return new WP_Error('presspilot_api_error',sanitize_text_field($message),['status'=>$status]);
    }
    return $data;
}

function analog_presspilot_mainwp_enroll_site(int $siteId): array {
    $website=analog_presspilot_mainwp_get_site($siteId);
    if (!$website) return ['site_id'=>$siteId,'status'=>'error','error'=>'mainwp_site_not_found_or_not_allowed'];
    $siteUrl=untrailingslashit((string)$website->url);
    if (!preg_match('#^https://#i',$siteUrl)) return ['site_id'=>$siteId,'site_name'=>(string)$website->name,'site_url'=>$siteUrl,'status'=>'error','error'=>'https_required'];

    $tokenResponse=analog_presspilot_mainwp_api_request('POST','enrollment',['site_url'=>$siteUrl]);
    if (is_wp_error($tokenResponse)) return ['site_id'=>$siteId,'site_name'=>(string)$website->name,'site_url'=>$siteUrl,'status'=>'error','error'=>$tokenResponse->get_error_code()];
    $token=is_array($tokenResponse) ? (string)($tokenResponse['token'] ?? '') : '';
    if ($token==='') return ['site_id'=>$siteId,'site_name'=>(string)$website->name,'site_url'=>$siteUrl,'status'=>'error','error'=>'enrollment_token_missing'];

    $install=analog_presspilot_mainwp_install_agent($website);
    if (is_wp_error($install)) return ['site_id'=>$siteId,'site_name'=>(string)$website->name,'site_url'=>$siteUrl,'status'=>'error','error'=>$install->get_error_code()];
    if (empty($install->ok[$siteId])) {
        $error=!empty($install->errors[$siteId][1]) ? sanitize_text_field((string)$install->errors[$siteId][1]) : 'presspilot_agent_install_failed';
        return ['site_id'=>$siteId,'site_name'=>(string)$website->name,'site_url'=>$siteUrl,'status'=>'error','error'=>$error];
    }

    $enroll=analog_presspilot_mainwp_enroll_agent($website,analog_presspilot_mainwp_api_url(),$token);
    if (is_wp_error($enroll)) return ['site_id'=>$siteId,'site_name'=>(string)$website->name,'site_url'=>$siteUrl,'status'=>'error','error'=>$enroll->get_error_code()];
    if (empty($enroll->ok[$siteId])) {
        $error=!empty($enroll->errors[$siteId][1]) ? sanitize_text_field((string)$enroll->errors[$siteId][1]) : 'presspilot_enrollment_failed';
        return ['site_id'=>$siteId,'site_name'=>(string)$website->name,'site_url'=>$siteUrl,'status'=>'error','error'=>$error];
    }

    $status=analog_presspilot_mainwp_api_request('GET','status',['site_url'=>$siteUrl]);
    if (is_wp_error($status)) return ['site_id'=>$siteId,'site_name'=>(string)$website->name,'site_url'=>$siteUrl,'status'=>'enrolled','verification'=>'status_check_failed'];
    $connection=is_array($status) ? ($status['connection'] ?? null) : null;
    return [
        'site_id'=>$siteId,'site_name'=>(string)$website->name,'site_url'=>$siteUrl,
        'status'=>(is_array($connection) && (($connection['status'] ?? '') === 'verified')) ? 'verified' : 'enrolled',
        'connection_id'=>is_array($connection) ? ($connection['id'] ?? null) : null,
        'agent_version'=>is_array($connection) ? ($connection['agent_version'] ?? null) : null,
    ];
}

function analog_presspilot_mainwp_rest_status(WP_REST_Request $request): WP_REST_Response {
    return new WP_REST_Response([
        'bridge_version'=>ANALOG_PRESSPILOT_MAINWP_BRIDGE_VERSION,
        'configured'=>analog_presspilot_mainwp_configured(),
        'mainwp_ready'=>analog_presspilot_mainwp_mainwp_ready(),
        'api_base_url'=>analog_presspilot_mainwp_api_url(),
        'package_url'=>analog_presspilot_mainwp_package_url(),
        'secret_configured'=>analog_presspilot_mainwp_secret() !== '',
    ],200);
}

function analog_presspilot_mainwp_rest_sites(WP_REST_Request $request): WP_REST_Response {
    return new WP_REST_Response(['sites'=>analog_presspilot_mainwp_get_sites()],200);
}

function analog_presspilot_mainwp_rest_enroll(WP_REST_Request $request) {
    if (!analog_presspilot_mainwp_configured() || !analog_presspilot_mainwp_mainwp_ready()) {
        return new WP_Error('bridge_not_ready','PressPilot MainWP bridge is not configured or MainWP is unavailable.',['status'=>503]);
    }
    $ids=$request->get_param('site_ids');
    if (!is_array($ids) || empty($ids)) return new WP_Error('site_ids_required','site_ids must be a non-empty array.',['status'=>400]);
    $ids=array_values(array_unique(array_filter(array_map('absint',$ids))));
    if (count($ids)>50) return new WP_Error('too_many_sites','Maximum 50 sites per enrollment request.',['status'=>400]);
    $results=[];
    foreach($ids as $id) $results[]=analog_presspilot_mainwp_enroll_site((int)$id);
    return new WP_REST_Response(['requested'=>count($ids),'results'=>$results],200);
}

function analog_presspilot_mainwp_save_settings(): void {
    if (!current_user_can('manage_options')) wp_die('Forbidden',403);
    check_admin_referer('analog_presspilot_mainwp_save');
    $api=esc_url_raw((string)($_POST['api_url'] ?? ''));
    $package=esc_url_raw((string)($_POST['package_url'] ?? ''));
    $secret=trim((string)($_POST['bridge_secret'] ?? ''));
    if($api!=='') update_option(ANALOG_PRESSPILOT_MAINWP_API_URL,untrailingslashit($api));
    if($package!=='') update_option(ANALOG_PRESSPILOT_MAINWP_PACKAGE_URL,$package);
    if($secret!=='') update_option(ANALOG_PRESSPILOT_MAINWP_SECRET,$secret,false);
    wp_safe_redirect(add_query_arg(['page'=>'analog-presspilot-fleet','saved'=>'1'],admin_url('tools.php'))); exit;
}

function analog_presspilot_mainwp_admin_enroll(): void {
    if (!current_user_can('manage_options')) wp_die('Forbidden',403);
    check_admin_referer('analog_presspilot_mainwp_enroll');
    $raw=sanitize_text_field((string)($_POST['site_ids'] ?? ''));
    $ids=array_values(array_unique(array_filter(array_map('absint',preg_split('/[,\s]+/',$raw,-1,PREG_SPLIT_NO_EMPTY)))));
    $results=[]; foreach($ids as $id) $results[]=analog_presspilot_mainwp_enroll_site((int)$id);
    wp_safe_redirect(add_query_arg(['page'=>'analog-presspilot-fleet','enrolled'=>rawurlencode(wp_json_encode($results))],admin_url('tools.php'))); exit;
}

function analog_presspilot_mainwp_admin_page(): void {
    if (!current_user_can('manage_options')) return;
    $sites=analog_presspilot_mainwp_get_sites();
    $saved=isset($_GET['saved']) && $_GET['saved']==='1';
    $results=[];
    if(!empty($_GET['enrolled'])) { $decoded=json_decode(rawurldecode((string)$_GET['enrolled']),true); if(is_array($decoded)) $results=$decoded; }
    ?>
    <div class="wrap">
      <h1>PressPilot Fleet</h1>
      <?php if($saved): ?><div class="notice notice-success"><p>PressPilot bridge settings saved.</p></div><?php endif; ?>
      <p>Install and enroll PressPilot Agent on selected MainWP child sites. Enrollment is one-time; the agent credential is then used for ongoing operation.</p>
      <h2>Bridge configuration</h2>
      <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="max-width:900px">
        <input type="hidden" name="action" value="analog_presspilot_mainwp_save">
        <?php wp_nonce_field('analog_presspilot_mainwp_save'); ?>
        <table class="form-table" role="presentation">
          <tr><th scope="row"><label for="pp-api-url">Analog API URL</label></th><td><input id="pp-api-url" name="api_url" type="url" class="regular-text code" value="<?php echo esc_attr(analog_presspilot_mainwp_api_url()); ?>"></td></tr>
          <tr><th scope="row"><label for="pp-package-url">PressPilot Agent ZIP</label></th><td><input id="pp-package-url" name="package_url" type="url" class="large-text code" value="<?php echo esc_attr(analog_presspilot_mainwp_package_url()); ?>"></td></tr>
          <tr><th scope="row"><label for="pp-secret">Bridge secret</label></th><td><input id="pp-secret" name="bridge_secret" type="password" class="regular-text code" autocomplete="new-password" placeholder="<?php echo analog_presspilot_mainwp_secret() !== '' ? 'Already configured — leave blank to keep it' : 'Paste the bridge secret'; ?>"></td></tr>
        </table>
        <?php submit_button('Save Bridge Settings'); ?>
      </form>
      <h2>MainWP child sites</h2>
      <?php if(!$sites): ?><p>No MainWP child sites are available to this administrator.</p><?php else: ?>
        <table class="widefat striped"><thead><tr><th>ID</th><th>Site</th><th>URL</th><th>Sync status</th></tr></thead><tbody>
        <?php foreach($sites as $site): ?><tr><td><?php echo esc_html((string)$site['id']); ?></td><td><?php echo esc_html($site['name']); ?></td><td><?php echo esc_html($site['url']); ?></td><td><?php echo $site['sync_errors']==='' ? 'Connected' : esc_html($site['sync_errors']); ?></td></tr><?php endforeach; ?>
        </tbody></table>
        <h2>Enroll sites</h2>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="max-width:700px">
          <input type="hidden" name="action" value="analog_presspilot_mainwp_enroll">
          <?php wp_nonce_field('analog_presspilot_mainwp_enroll'); ?>
          <p><label for="pp-site-ids">Site IDs (comma or space separated)</label><br><input id="pp-site-ids" name="site_ids" type="text" class="large-text code" placeholder="12, 13, 14"></p>
          <?php submit_button('Install & Enroll PressPilot','primary'); ?>
        </form>
      <?php endif; ?>
      <?php if($results): ?><h2>Latest enrollment results</h2><pre style="background:#fff;padding:12px;max-width:900px;overflow:auto"><?php echo esc_html(wp_json_encode($results,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)); ?></pre><?php endif; ?>
    </div>
    <?php
}
