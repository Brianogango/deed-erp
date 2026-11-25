#!/usr/bin/env bash
# Builds mobile/barcode-scanner into an installable APK without Gradle:
# aapt2 -> javac -> d8 -> zipalign -> apksigner.
#
#   ANDROID_HOME=~/android-sdk ./scripts/build.sh
#
# Needs: Android SDK platform 34, build-tools 35.0.0 or newer, and a JDK (17 or 21).
# build-tools 34.0.0 is not enough: its d8 (R8 8.2.2) crashes while dexing this
# app with "NullPointerException: Cannot invoke String.length()".
set -euo pipefail

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/android-sdk}}"
# newest installed build-tools wins (sort -V puts e.g. 36.0.0 above 35.0.0)
BT="$(ls -d "$SDK"/build-tools/*/ 2>/dev/null | sort -V | tail -1)"
BT="${BT%/}"
ANDROID_JAR="$SDK/platforms/android-34/android.jar"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/app/src/main"
OUT="$ROOT/build"
KS="$ROOT/keystore/debug.keystore"
KS_PASS="android"
KS_ALIAS="deedscan"
APK="$OUT/deed-scan.apk"

echo "==> build-tools: ${BT:-<none found>}"
for f in "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner" "$ANDROID_JAR"; do
  [ -e "$f" ] || { echo "Missing: $f" >&2; echo "Install with: sdkmanager 'platforms;android-34' 'build-tools;35.0.0'" >&2; exit 1; }
done

rm -rf "$OUT"
mkdir -p "$OUT/res" "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "==> resources"
"$BT/aapt2" compile --dir "$SRC/res" -o "$OUT/res/res.zip"

echo "==> link"
"$BT/aapt2" link \
  -o "$OUT/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$SRC/AndroidManifest.xml" \
  -R "$OUT/res/res.zip" \
  --java "$OUT/gen" \
  -A "$SRC/assets" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --auto-add-overlay

echo "==> java"
find "$SRC/java" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -nowarn -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$ANDROID_JAR" \
  -d "$OUT/classes" "@$OUT/sources.txt" 2>&1 | grep -v 'bootstrap class path' || true

echo "==> dex"
find "$OUT/classes" -name '*.class' > "$OUT/classlist.txt"
"$BT/d8" --release --min-api 24 --lib "$ANDROID_JAR" \
  --output "$OUT/dex" @"$OUT/classlist.txt"

echo "==> package"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
( cd "$OUT/dex" && zip -q -X "$OUT/unsigned.apk" classes.dex )
"$BT/zipalign" -p -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

if [ ! -f "$KS" ]; then
  echo "==> generating a local signing key (never committed)"
  mkdir -p "$(dirname "$KS")"
  keytool -genkeypair -keystore "$KS" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias "$KS_ALIAS" -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=Deed Scan, OU=Mobile, O=Deed, C=KE" >/dev/null 2>&1
fi

echo "==> sign"
"$BT/apksigner" sign --ks "$KS" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --ks-key-alias "$KS_ALIAS" --min-sdk-version 24 --out "$APK" "$OUT/aligned.apk"
"$BT/apksigner" verify --print-certs "$APK" | head -4

rm -f "$OUT/unsigned.apk" "$OUT/aligned.apk" "$OUT/base.apk"
echo
echo "APK: $APK  ($(du -h "$APK" | cut -f1))"
