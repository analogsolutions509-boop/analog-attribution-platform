<?php
/**
 * Plugin Name: Analog Attribution Collector
 * Description: First-party visitor/session/event collector for the Analog Attribution Platform.
 * Version: 0.2.0
 * Author: Analog Solutions
 */

if (!defined('ABSPATH')) exit;

final class Analog_Attribution_Collector {
  private const OPTION_KEY = 'analog_attribution_config';

  public static function boot(): void {
    add_action('rest_api_init', [__CLASS__, 'register_routes']);
    add_action('wp_enqueue_scripts', [__CLASS__, 'enqueue']);
  }

  public static function register_routes(): void {
    register_rest_route('analog/v1', '/event', [
      'methods' => 'POST',
      'permission_callback' => '__return_true',
      'callback' => [__CLASS__, 'event_endpoint'],
    ]);
    register_rest_route('analog/v1', '/phone', [
      'methods' => 'POST',
      'permission_callback' => '__return_true',
      'callback' => [__CLASS__, 'phone_endpoint'],
    ]);
    register_rest_route('analog/v1', '/health', [
      'methods' => 'GET',
      'permission_callback' => '__return_true',
      'callback' => fn() => rest_ensure_response(['status' => 'ok', 'plugin' => 'analog-attribution-collector']),
    ]);
  }

  private static function upstream(string $path, array $body): WP_REST_Response {
    $config = get_option(self::OPTION_KEY, []);
    $api = isset($config['api_url']) ? esc_url_raw($config['api_url']) : '';
    $site_key = isset($config['site_key']) ? (string) $config['site_key'] : '';
    if (!$api || !$site_key) return new WP_REST_Response(['error' => 'collector_not_configured'], 503);
    $response = wp_remote_post(trailingslashit($api) . ltrim($path, '/'), [
      'timeout' => 5,
      'headers' => ['Content-Type' => 'application/json', 'X-Analog-Site-Key' => $site_key],
      'body' => wp_json_encode($body),
    ]);
    if (is_wp_error($response)) return new WP_REST_Response(['error' => 'upstream_unavailable'], 502);
    $status = wp_remote_retrieve_response_code($response);
    $upstream = json_decode(wp_remote_retrieve_body($response), true);
    return new WP_REST_Response(is_array($upstream) ? $upstream : ['ok' => $status < 300], $status ?: 502);
  }

  public static function event_endpoint(WP_REST_Request $request): WP_REST_Response {
    $body = $request->get_json_params();
    if (!is_array($body)) return new WP_REST_Response(['error' => 'invalid_json'], 400);
    return self::upstream('v1/events', $body);
  }

  public static function phone_endpoint(WP_REST_Request $request): WP_REST_Response {
    $body = $request->get_json_params();
    if (!is_array($body)) return new WP_REST_Response(['error' => 'invalid_json'], 400);
    return self::upstream('v1/phone-pool/assign', $body);
  }

  public static function enqueue(): void {
    if (is_admin()) return;
    $config = get_option(self::OPTION_KEY, []);
    if (empty($config['enabled'])) return;
    wp_enqueue_script(
      'analog-attribution-collector',
      plugins_url('assets/collector.js', __FILE__),
      [],
      '0.2.0',
      true
    );
    wp_localize_script('analog-attribution-collector', 'AnalogCollectorConfig', [
      'eventEndpoint' => esc_url_raw(rest_url('analog/v1/event')),
      'phoneEndpoint' => esc_url_raw(rest_url('analog/v1/phone')),
      'site' => home_url('/'),
      'debug' => !empty($config['debug']),
    ]);
  }

  public static function configure(string $api_url, string $site_key, bool $enabled = true): void {
    update_option(self::OPTION_KEY, [
      'api_url' => esc_url_raw($api_url),
      'site_key' => sanitize_text_field($site_key),
      'enabled' => $enabled,
      'debug' => false,
    ], false);
  }
}

Analog_Attribution_Collector::boot();
