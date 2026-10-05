PressPilot Agent
=============
Version 0.2.1
By Analog Solutions

DESCRIPTION
Secure WordPress execution bridge for the PressPilot command center.

INSTALLATION
1. In WordPress, open Plugins > Add Plugin > Upload Plugin.
2. Upload the presspilot-agent.zip package.
3. Activate PressPilot Agent.
4. Open Settings > PressPilot.
5. Pair the site from the PressPilot command center using the generated pairing code.

REQUIREMENTS
- WordPress with HTTPS enabled.
- WordPress Application Passwords or the PressPilot agent pairing flow.
- PHP 7.4+ recommended.

SECURITY
The agent stores only a SHA-256 hash of the agent token. Pairing codes expire and are not stored in plaintext.
The execution endpoint accepts only an authenticated bearer token and a fixed allowlist of WordPress operations.

SUPPORTED OPERATIONS
get_site, list_posts, list_pages, create_post, update_post, create_page, update_page, list_plugins, search_content, elementor_edit_text.

SUPPORT
PressPilot is an Analog Solutions internal platform component. Do not expose credentials in browser code or logs.
