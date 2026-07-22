#!/bin/sh

set -eu

repo="v5x-dev/v5x"
version="${V5X_VERSION:-}"

fail() {
  printf 'v5x installer: %s\n' "$1" >&2
  exit 1
}

if [ -n "${V5X_INSTALL_DIR:-}" ]; then
  install_dir="$V5X_INSTALL_DIR"
elif [ -n "${HOME:-}" ]; then
  install_dir="${HOME}/.local/bin"
else
  fail "HOME or V5X_INSTALL_DIR must be set"
fi

command -v curl >/dev/null 2>&1 || fail "curl is required"

case "$(uname -s)" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *) fail "unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

if [ -z "$version" ]; then
  package_metadata="$(curl -fsSL "https://registry.npmjs.org/%40v5x%2Fcli/latest")" ||
    fail "could not determine the latest version"
  version="$(printf '%s\n' "$package_metadata" | sed -n 's/^.*"version":"\([^"]*\)".*$/\1/p')"
  [ -n "$version" ] || fail "could not determine the latest version"
fi

asset="v5x-${os}-${arch}"
release_url="https://github.com/${repo}/releases/download/%40v5x%2Fcli%40${version}"
tmp_dir="$(mktemp -d 2>/dev/null || mktemp -d -t v5x)" || fail "could not create a temporary directory"
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

printf 'Downloading v5x %s for %s-%s...\n' "$version" "$os" "$arch"
curl -fsSL "${release_url}/${asset}" -o "${tmp_dir}/${asset}" || fail "could not download ${asset}"
curl -fsSL "${release_url}/SHA256SUMS" -o "${tmp_dir}/SHA256SUMS" || fail "could not download checksums"

expected="$(awk -v asset="$asset" '$2 == asset { print $1 }' "${tmp_dir}/SHA256SUMS")"
[ -n "$expected" ] || fail "release does not contain a checksum for ${asset}"

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${tmp_dir}/${asset}" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "${tmp_dir}/${asset}" | awk '{ print $1 }')"
else
  fail "sha256sum or shasum is required"
fi

[ "$actual" = "$expected" ] || fail "checksum verification failed"

mkdir -p "$install_dir"
install -m 755 "${tmp_dir}/${asset}" "${install_dir}/v5x"

printf 'Installed v5x to %s/v5x\n' "$install_dir"
case ":${PATH:-}:" in
  *:"$install_dir":*) ;;
  *) printf 'Add %s to your PATH to run v5x.\n' "$install_dir" ;;
esac
