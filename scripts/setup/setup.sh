#!/usr/bin/env bash
#
# Local Studio - Linux/macOS Setup Script
# Self-contained: no apt/yum/pacman, no global Node.js install.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
APP_DIR="$ROOT_DIR/app"
FRONTEND_DIR="$APP_DIR/frontend"
TOOLS_DIR="$APP_DIR/tools"
DIST_DIR="$APP_DIR/dist"
PLATFORM="$(uname -s)"
ARCH="$(uname -m)"

if [[ "$PLATFORM" == "Darwin" ]] && [[ "$(sysctl -in hw.optional.arm64 2>/dev/null || true)" == "1" ]]; then
  # Under Rosetta, uname reports x86_64 even though arm64 binaries are supported.
  ARCH="arm64"
fi

if [[ "$PLATFORM" == "Darwin" ]]; then
  PLATFORM_LABEL="macOS"
  NODE_DIR="$TOOLS_DIR/node-mac"
else
  PLATFORM_LABEL="Linux"
  NODE_DIR="$TOOLS_DIR/node-linux"
fi

NODE_BIN="$NODE_DIR/bin/node"
NPM_BIN="$NODE_DIR/bin/npm"

# Check if filesystem supports symlinks
USE_SYMLINKS=true
TEST_LINK="$ROOT_DIR/.test_symlink"
rm -f "$TEST_LINK"
if ln -s "test" "$TEST_LINK" 2>/dev/null; then
  rm -f "$TEST_LINK"
else
  USE_SYMLINKS=false
fi

# Release pins
NODE_VERSION="22.12.0"

if [[ "$PLATFORM" == "Darwin" ]]; then
  if [[ "$ARCH" == "arm64" ]]; then
    NODE_PLATFORM_ARCH="darwin-arm64"
  else
    NODE_PLATFORM_ARCH="darwin-x64"
  fi
  NODE_TARBALL="node-v${NODE_VERSION}-${NODE_PLATFORM_ARCH}.tar.gz"
else
  NODE_PLATFORM_ARCH="linux-x64"
  NODE_TARBALL="node-v${NODE_VERSION}-${NODE_PLATFORM_ARCH}.tar.xz"
fi
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/$NODE_TARBALL"

# ── Helpers ─────────────────────────────────────────────────────────────────
print_header() {
  echo ""
  echo "  ============================================================"
  echo "   LOCAL STUDIO - SCUOLA      -  $PLATFORM_LABEL First-Time Setup"
  echo "   100% Self-Contained  |  No System Install Required"
  echo "  ============================================================"
  echo ""
}

print_step() {
  local n="$1" total="$2" title="$3"
  echo ""
  echo "  [$n/$total] $title"
  echo "  ------------------------------------------------------------"
}

print_ok()   { echo "   OK   $1"; }
print_info() { echo "   >>   $1"; }
print_warn() { echo "   !!   $1"; }
print_fail() { echo "   XX   $1"; }

format_bytes() {
  local b="${1:-0}"
  if command -v bc >/dev/null 2>&1; then
    if (( b > 1073741824 )); then printf "%.2f GB" "$(echo "scale=4; $b / 1073741824" | bc)"; return; fi
    if (( b > 1048576 )); then printf "%.1f MB" "$(echo "scale=4; $b / 1048576" | bc)"; return; fi
    if (( b > 1024 )); then printf "%.0f KB" "$(echo "scale=4; $b / 1024" | bc)"; return; fi
  else
    if (( b > 1073741824 )); then printf "%.2f GB" "$(awk "BEGIN {printf \"%.2f\", $b/1073741824}")"; return; fi
    if (( b > 1048576 )); then printf "%.1f MB" "$(awk "BEGIN {printf \"%.1f\", $b/1048576}")"; return; fi
    if (( b > 1024 )); then printf "%.0f KB" "$(awk "BEGIN {printf \"%.0f\", $b/1024}")"; return; fi
  fi
  printf "%s B" "$b"
}

# Rich download with progress bar
download_file() {
  local url="$1" dest="$2" label="$3"
  print_info "Downloading: $label"
  echo ""

  local tmp_dest="${dest}.part"
  rm -f "$tmp_dest"

  curl -fSL --progress-bar "$url" -o "$tmp_dest" || {
    print_fail "Download failed: $url"
    rm -f "$tmp_dest"
    return 1
  }

  mv "$tmp_dest" "$dest"
  echo ""
  local fsize
  fsize="$(stat -c%s "$dest" 2>/dev/null || stat -f%z "$dest" 2>/dev/null || echo 0)"
  print_ok "Downloaded $(format_bytes "$fsize")"
}

# Extract ZIP using Python zipfile (preferred), unzip, or Node.js adm-zip

# Extract tar.xz
extract_tarxz() {
  local tar_path="$1" dest="$2" label="$3"
  print_info "Extracting: $label"
  mkdir -p "$dest"
  if [ "$USE_SYMLINKS" = false ]; then
    # On filesystems that do not support symlinks, tar will fail when attempting to create symlinks
    # (e.g. for npm/npx/corepack in Node.js bin/). We allow it to continue but verify key files.
    local tar_exit=0
    tar -xf "$tar_path" -C "$dest" || tar_exit=$?
    if [[ $tar_exit -ne 0 ]]; then
      # Check if node binary was extracted successfully
      local check_file
      check_file="$(find "$dest" -type f -name "node" | head -n 1)"
      if [[ -n "$check_file" ]]; then
        print_warn "tar returned exit code $tar_exit due to symlink failures on this filesystem, but bin/node was successfully extracted."
      else
        print_fail "tar extraction failed with exit code $tar_exit (could not find bin/node)"
        exit $tar_exit
      fi
    fi
  else
    tar -xf "$tar_path" -C "$dest"
  fi
  print_ok "Extracted $label"
}

detect_gpu_vendor() {
  local vendor=""
  if [[ -d /sys/bus/pci/devices ]]; then
    for vfile in /sys/bus/pci/devices/*/vendor; do
      if [[ -f "$vfile" ]]; then
        local vid
        vid="$(cat "$vfile" 2>/dev/null || true)"
        case "$vid" in
          "0x10de") vendor="nvidia" ;;
          "0x1002") vendor="amd" ;;
          "0x8086") [[ -z "$vendor" ]] && vendor="intel" ;;
        esac
      fi
    done
  fi
  echo "$vendor"
}

# Official Linux binaries are built on Ubuntu 24.04 and link against glibc 2.38+
# plus libstdc++ with GLIBCXX_3.4.32+. Stop early on older distributions so
# setup does not appear successful when the backend cannot start.
version_at_least() {
  local current="$1" required="$2"
  [[ "$(printf '%s\n' "$required" "$current" | sort -V | head -n1)" == "$required" ]]
}

detect_glibcxx_version() {
  local libstdcpp=""
  if command -v ldconfig >/dev/null 2>&1; then
    libstdcpp="$(ldconfig -p 2>/dev/null | awk '/libstdc\+\+\.so\.6/{print $NF; exit}')"
  fi
  if [[ -z "$libstdcpp" ]]; then
    for candidate in /usr/lib/x86_64-linux-gnu/libstdc++.so.6 /usr/lib64/libstdc++.so.6 /lib/x86_64-linux-gnu/libstdc++.so.6; do
      if [[ -f "$candidate" ]]; then
        libstdcpp="$candidate"
        break
      fi
    done
  fi
  if [[ -n "$libstdcpp" && -f "$libstdcpp" ]] && command -v strings >/dev/null 2>&1; then
    strings "$libstdcpp" 2>/dev/null | grep -oE 'GLIBCXX_[0-9]+\.[0-9]+\.[0-9]+' | sed 's/GLIBCXX_//' | sort -V | tail -n1
  fi
}

check_linux_runtime_abi() {
  local required_glibc="2.38"
  local required_glibcxx="3.4.32"
  local current_glibc=""
  local current_glibcxx=""
  local unsupported=0

  if command -v ldd >/dev/null 2>&1; then
    current_glibc="$(ldd --version 2>/dev/null | head -n1 | grep -oE '[0-9]+\.[0-9]+' | head -n1 || true)"
  fi
  current_glibcxx="$(detect_glibcxx_version || true)"

  if [[ -z "$current_glibc" ]]; then
    print_warn "Could not detect glibc version. Prebuilt Linux backends require glibc $required_glibc+ (Ubuntu 24.04)."
  elif ! version_at_least "$current_glibc" "$required_glibc"; then
    print_fail "Detected glibc $current_glibc. Prebuilt Linux backends require glibc $required_glibc+ (Ubuntu 24.04 or newer)."
    unsupported=1
  fi

  if [[ -z "$current_glibcxx" ]]; then
    print_warn "Could not detect GLIBCXX version. Prebuilt Linux backends require GLIBCXX_$required_glibcxx+."
  elif ! version_at_least "$current_glibcxx" "$required_glibcxx"; then
    print_fail "Detected GLIBCXX_$current_glibcxx. Prebuilt Linux backends require GLIBCXX_$required_glibcxx+."
    unsupported=1
  fi

  if [[ $unsupported -ne 0 ]]; then
    print_info "Models will fail before loading on this OS because the backend binary cannot start."
    print_info "Fix: use Ubuntu 24.04+, Fedora 40+, another glibc 2.38+ distro, or build llama.cpp from source on this machine."
    if [[ "${UAIS_ALLOW_UNSUPPORTED_LINUX:-0}" == "1" ]]; then
      print_warn "Continuing anyway because UAIS_ALLOW_UNSUPPORTED_LINUX=1 is set."
      return 0
    fi
    return 1
  fi

  print_ok "Linux runtime ABI ready: glibc $current_glibc, GLIBCXX_$current_glibcxx"
}

has_linux_shared_library() {
  local library="$1"
  if command -v ldconfig >/dev/null 2>&1 && grep -Fq "$library" < <(ldconfig -p 2>/dev/null); then
    return 0
  fi
  [[ -n "$(find /lib /lib64 /usr/lib /usr/lib64 -name "$library" -print -quit 2>/dev/null)" ]]
}

check_linux_runtime_dependencies() {
  if ! has_linux_shared_library "libgomp.so.1"; then
    print_fail "The required OpenMP runtime (libgomp.so.1) is missing."
    print_info "Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y libgomp1"
    print_info "Fedora: sudo dnf install libgomp"
    return 1
  fi
  print_ok "Linux OpenMP runtime ready: libgomp.so.1"
}




# ════════════════════════════════════════════════════════════════════════════
print_header

if [[ "$PLATFORM" == "Linux" ]]; then
  if ! check_linux_runtime_abi; then
    print_fail "Linux setup stopped before downloading incompatible backend binaries."
    exit 1
  fi
  if ! check_linux_runtime_dependencies; then
    print_fail "Linux setup stopped before installing backends with missing runtime libraries."
    exit 1
  fi
fi

TOTAL_STEPS=6

# ── Step 1: Portable Node.js ────────────────────────────────────────────────
print_step 1 $TOTAL_STEPS "Setting up portable Node.js ($NODE_DIR/)"

EXPECTED_NODE_ARCH="${NODE_PLATFORM_ARCH##*-}"
INSTALLED_NODE_ARCH=""
if [[ -x "$NODE_BIN" ]]; then
  INSTALLED_NODE_ARCH="$("$NODE_BIN" -p "process.arch" 2>/dev/null || true)"
fi

if [[ -x "$NODE_BIN" && -x "$NPM_BIN" && "$INSTALLED_NODE_ARCH" == "$EXPECTED_NODE_ARCH" ]]; then
  VERSION=$("$NODE_BIN" --version)
  print_ok "Portable Node.js already ready: $VERSION"
else
  if [[ -n "$INSTALLED_NODE_ARCH" && "$INSTALLED_NODE_ARCH" != "$EXPECTED_NODE_ARCH" ]]; then
    print_warn "Replacing portable Node.js $INSTALLED_NODE_ARCH with $EXPECTED_NODE_ARCH for this hardware."
    rm -rf "$NODE_DIR"
  fi
  mkdir -p "$TOOLS_DIR"
  NODE_TAR_PATH="$TOOLS_DIR/$NODE_TARBALL"

  download_file "$NODE_URL" "$NODE_TAR_PATH" "Node.js v${NODE_VERSION} LTS (Portable tarball)"
  extract_tarxz "$NODE_TAR_PATH" "$TOOLS_DIR" "Node.js"
  rm -f "$NODE_TAR_PATH"

  EXTRACTED_DIR="$(find "$TOOLS_DIR" -maxdepth 1 -type d -name "node-v*-${NODE_PLATFORM_ARCH}" | head -n 1)"
  if [[ -d "$EXTRACTED_DIR" ]]; then
    rm -rf "$NODE_DIR"
    mv "$EXTRACTED_DIR" "$NODE_DIR"
  fi

  if [ "$USE_SYMLINKS" = false ]; then
    print_info "Filesystem does not support symlinks. Creating shell wrappers for npm, npx, and corepack..."
    rm -f "$NODE_DIR/bin/npm" "$NODE_DIR/bin/npx" "$NODE_DIR/bin/corepack"
    
    cat << 'EOF' > "$NODE_DIR/bin/npm"
#!/bin/sh
basedir=$(dirname "$0")
exec "$basedir/node" "$basedir/../lib/node_modules/npm/bin/npm-cli.js" "$@"
EOF
    chmod +x "$NODE_DIR/bin/npm"

    cat << 'EOF' > "$NODE_DIR/bin/npx"
#!/bin/sh
basedir=$(dirname "$0")
exec "$basedir/node" "$basedir/../lib/node_modules/npm/bin/npx-cli.js" "$@"
EOF
    chmod +x "$NODE_DIR/bin/npx"

    cat << 'EOF' > "$NODE_DIR/bin/corepack"
#!/bin/sh
basedir=$(dirname "$0")
exec "$basedir/node" "$basedir/../lib/node_modules/corepack/dist/corepack.js" "$@"
EOF
    chmod +x "$NODE_DIR/bin/corepack"
    
    print_ok "Created shell wrappers."
  fi

  if [[ ! -x "$NODE_BIN" || ! -x "$NPM_BIN" ]]; then
    print_fail "Portable Node.js install is incomplete."
    exit 1
  fi

  VERSION=$("$NODE_BIN" --version)
  print_ok "Portable Node.js ready: $VERSION"
fi

# ── Step 3: npm install ─────────────────────────────────────────────────────
print_step 2 $TOTAL_STEPS "Setting up llama.cpp text backend"
bash "$SCRIPT_DIR/setup-llama.sh"

print_step 3 $TOTAL_STEPS "Setting up whisper.cpp speech backend"
bash "$SCRIPT_DIR/setup-whisper.sh"

print_step 4 $TOTAL_STEPS "Setting up Kokoro ONNX text-to-speech runtime"
bash "$SCRIPT_DIR/setup-tts.sh"

print_step 5 $TOTAL_STEPS "Installing frontend dependencies (app/frontend/)"

if [[ ! -x "$NPM_BIN" ]]; then
  print_fail "Portable npm was not found at $NPM_BIN"
  exit 1
fi

# Ensure correct OS-specific node_modules folder is symlinked or swapped to avoid conflicts
FRONTEND_NODE_MODULES="$FRONTEND_DIR/node_modules"
ACTIVE_OS_FILE="$FRONTEND_DIR/.active_modules_os"

if [[ "$PLATFORM" == "Darwin" ]]; then
  OS_NODE_MODULES="$FRONTEND_DIR/node_modules_mac"
  OS_LABEL="node_modules_mac"
  CURRENT_OS="mac"
else
  OS_NODE_MODULES="$FRONTEND_DIR/node_modules_linux"
  OS_LABEL="node_modules_linux"
  CURRENT_OS="linux"
fi

# Attempt to create a test symlink to check if filesystem supports symlinks
USE_SYMLINKS=true
TEST_LINK="$FRONTEND_DIR/.test_symlink"
rm -f "$TEST_LINK"
if ln -s "$OS_LABEL" "$TEST_LINK" 2>/dev/null; then
  rm -f "$TEST_LINK"
else
  USE_SYMLINKS=false
fi
# macOS fakes symlinks on exFAT/FAT drives, and Linux and Windows see them as plain
# files. Use the directory swap there too, matching mac.sh.
if [[ "$PLATFORM" == "Darwin" ]]; then
  FRONTEND_DEVICE="$(stat -f %Sd "$FRONTEND_DIR" 2>/dev/null || true)"
  case "$(mount | awk -v d="/dev/$FRONTEND_DEVICE" '$1 == d { sub(/^[^(]*\(/, ""); sub(/,.*$/, ""); print; exit }')" in
    exfat|msdos) USE_SYMLINKS=false ;;
  esac
fi

if [ "$USE_SYMLINKS" = true ]; then
  if [[ -d "$FRONTEND_NODE_MODULES" && ! -L "$FRONTEND_NODE_MODULES" ]]; then
    print_info "Migrating existing node_modules to $OS_LABEL..."
    if [[ -d "$OS_NODE_MODULES" ]]; then
      rm -rf "$FRONTEND_NODE_MODULES"
    else
      mv "$FRONTEND_NODE_MODULES" "$OS_NODE_MODULES"
    fi
  fi
  rm -rf "$FRONTEND_NODE_MODULES"
  mkdir -p "$OS_NODE_MODULES"
  ln -sf "$OS_LABEL" "$FRONTEND_NODE_MODULES"
else
  # Fallback: Filesystem does not support symlinks (e.g. FAT32/exFAT)
  print_info "Filesystem does not support symlinks. Using directory swapping fallback..."
  
  if [[ -L "$FRONTEND_NODE_MODULES" || -f "$FRONTEND_NODE_MODULES" ]]; then
    rm -rf "$FRONTEND_NODE_MODULES"
  fi
  
  PREV_OS=""
  if [[ -f "$ACTIVE_OS_FILE" ]]; then
    PREV_OS=$(cat "$ACTIVE_OS_FILE")
  fi
  
  if [[ -d "$FRONTEND_NODE_MODULES" && "$PREV_OS" != "$CURRENT_OS" ]]; then
    if [[ -n "$PREV_OS" ]]; then
      print_info "Swapping out node_modules to node_modules_$PREV_OS..."
      rm -rf "$FRONTEND_DIR/node_modules_$PREV_OS"
      mv "$FRONTEND_NODE_MODULES" "$FRONTEND_DIR/node_modules_$PREV_OS"
    else
      print_info "Saving node_modules as node_modules_windows..."
      rm -rf "$FRONTEND_DIR/node_modules_windows"
      mv "$FRONTEND_NODE_MODULES" "$FRONTEND_DIR/node_modules_windows"
    fi
  fi
  
  if [[ -d "$OS_NODE_MODULES" && ! -d "$FRONTEND_NODE_MODULES" ]]; then
    print_info "Swapping in $OS_LABEL..."
    mv "$OS_NODE_MODULES" "$FRONTEND_NODE_MODULES"
  elif [[ ! -d "$FRONTEND_NODE_MODULES" ]]; then
    mkdir -p "$FRONTEND_NODE_MODULES"
  fi
  
  echo "$CURRENT_OS" > "$ACTIVE_OS_FILE"
fi

cd "$FRONTEND_DIR"
export PATH="$NODE_DIR/bin:$PATH"

if [ "$USE_SYMLINKS" = false ]; then
  if "$NPM_BIN" install --prefer-offline --no-bin-links; then
    print_ok "Dependencies installed!"
  else
    print_fail "npm install failed."
    exit 1
  fi
else
  if "$NPM_BIN" install --prefer-offline; then
    print_ok "Dependencies installed!"
  else
    print_fail "npm install failed."
    exit 1
  fi
fi

# ── Step 4: Build frontend ──────────────────────────────────────────────────
print_step 6 $TOTAL_STEPS "Building frontend -> app/dist/"

if [ "$USE_SYMLINKS" = false ]; then
  # If symlinks are disabled, run vite directly using the local node executable.
  if "$NODE_BIN" node_modules/vite/bin/vite.js build; then
    print_ok "Frontend built!"
  else
    print_fail "Frontend build failed."
    exit 1
  fi
else
  if "$NPM_BIN" run build; then
    print_ok "Frontend built!"
  else
    print_fail "Frontend build failed."
    exit 1
  fi
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
echo "  ============================================================"
if [[ "$PLATFORM" == "Darwin" ]]; then
  echo "   Setup complete! Run ./mac.sh to launch."
else
  echo "   Setup complete! Run ./linux.sh to launch."
fi
echo "  ============================================================"
echo ""
