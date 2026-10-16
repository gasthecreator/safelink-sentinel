#!/usr/bin/env bash
# Makes the private key that signs your Android releases.
#
#   bash scripts/android-release-key.sh [--out ~/.safelink/android-release.keystore]
#
# Creates the keystore (random passwords) and writes android/keystore.properties pointing at it, so
# `./gradlew assembleRelease` signs with it. BACK THE KEYSTORE UP somewhere safe and private: with a
# different key, phones will refuse to update an app installed from an earlier build, and the passwords
# in keystore.properties are the only record of them. Never commit either file (they are gitignored).
set -euo pipefail

OUT="$HOME/.safelink/android-release.keystore"
if [ "${1:-}" = "--out" ] && [ -n "${2:-}" ]; then OUT="$2"; fi
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PROPS="$HERE/android/keystore.properties"

command -v keytool >/dev/null 2>&1 || { echo "keytool not found: install a JDK (the one used for the Android build)." >&2; exit 1; }
if [ -e "$OUT" ]; then echo "Refusing to overwrite $OUT. Move it away first if you really want a new key." >&2; exit 1; fi
if [ -e "$PROPS" ]; then echo "Refusing to overwrite $PROPS." >&2; exit 1; fi

mkdir -p "$(dirname "$OUT")"
chmod 700 "$(dirname "$OUT")"
command -v openssl >/dev/null 2>&1 || { echo "openssl not found." >&2; exit 1; }
PASS="$(openssl rand -hex 16)"
ALIAS="safelink-release"
keytool -genkeypair -v -storetype PKCS12 -keystore "$OUT" -alias "$ALIAS" -keyalg RSA -keysize 4096 \
  -validity 10000 -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=SafeLink Mesh, O=SafeLink, C=US" >/dev/null 2>"$OUT.log" || { echo "keytool failed:" >&2; cat "$OUT.log" >&2; rm -f "$OUT" "$OUT.log"; exit 1; }
rm -f "$OUT.log"
chmod 600 "$OUT"

umask 077
cat > "$PROPS" <<PROPS_EOF
storeFile=$OUT
storePassword=$PASS
keyAlias=$ALIAS
keyPassword=$PASS
PROPS_EOF

echo "Keystore written to $OUT"
echo "Settings written to $PROPS (private; gitignored)"
echo
echo "Certificate fingerprint (note it down; it identifies your releases):"
keytool -list -keystore "$OUT" -storepass "$PASS" -alias "$ALIAS" 2>/dev/null | grep -i "SHA-256\|Certificate fingerprint" || true
echo
echo "NOW: copy $OUT and the passwords in $PROPS to a safe, private backup."
