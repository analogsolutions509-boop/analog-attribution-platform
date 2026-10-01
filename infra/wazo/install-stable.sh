#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer as root."
  exit 1
fi

if ! grep -qE '^VERSION_ID="?12"?$' /etc/os-release; then
  echo "Wazo production installer expects Debian 12 Bookworm."
  exit 1
fi

apt update
apt install -yq sudo git ansible curl jq openssl

if [[ ! -d /opt/wazo-ansible/.git ]]; then
  git clone https://github.com/wazo-platform/wazo-ansible.git /opt/wazo-ansible
fi

cd /opt/wazo-ansible
ansible_tag="wazo-$(curl -fsSL https://mirror.wazo.community/version/stable)"
git fetch --tags origin
git checkout "$ansible_tag"
ansible-galaxy install -r requirements-postgresql.yml

echo "Wazo installer prepared at /opt/wazo-ansible."
echo "Configure /opt/wazo-ansible/inventories/uc-engine before running:"
echo "  ansible-playbook -i inventories/uc-engine uc-engine.yml"
