#!/usr/bin/env bash
# Builds the Android app: build/desktop/AgesOfCommand-<v>-android.apk (installable by hand;
# Android 7.0 or newer). No Gradle or Android Studio: javac, dx, aapt, zipalign and apksigner
# from Debian/Ubuntu's Android SDK packages:
#   apt-get install android-sdk-platform-23 dalvik-exchange aapt zipalign apksigner openjdk-17-jdk-headless
# Signing: the key in $AOC_KEYSTORE (default ~/.aoc/android-release.jks, password in
# $AOC_KEYSTORE_PASS, default "agesofcommand") is created on first use. Keep it: Android only
# installs an update over an existing install when it is signed with the same key.
# Usage: tools/build_android.sh [version]   (default: package.json's version)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
V=${1:-$(node -p "require('./package.json').version")}
SDK=${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
KS=${AOC_KEYSTORE:-$HOME/.aoc/android-release.jks}
PASS=${AOC_KEYSTORE_PASS:-agesofcommand}
OUT=$ROOT/build/desktop
W=$ROOT/build/android
rm -rf "$W"; mkdir -p "$W/classes" "$W/gen/com/agesofcommand/game" "$W/apk/assets" "$OUT"

# version code from the version: 1.2.3 -> 10203
IFS=. read -r MA MI PA <<< "$V"
CODE=$(( ${MA:-0} * 10000 + ${MI:-0} * 100 + ${PA:-0} ))
sed -e "s/package=\"com.agesofcommand.game\">/package=\"com.agesofcommand.game\" android:versionCode=\"$CODE\" android:versionName=\"$V\">/" \
  android/AndroidManifest.xml > "$W/AndroidManifest.xml"
cat > "$W/gen/com/agesofcommand/game/BuildConfig.java" <<JAVA
package com.agesofcommand.game;
final class BuildConfig { static final String VERSION = "$V"; }
JAVA

# the game, as in the desktop packages
G=$W/apk/assets/game; mkdir -p "$G/docs"
cp index.html "$G/"; cp -r src styles data "$G/"; cp docs/*.md README.md "$G/docs/"
find "$G" -name '__pycache__' -prune -exec rm -rf {} +

aapt package -f -m -J "$W/gen" -M "$W/AndroidManifest.xml" -S android/res -I "$SDK"
javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$SDK" -d "$W/classes" \
  $(find android/src "$W/gen" -name '*.java')
DX=$(command -v dx || command -v dalvik-exchange || echo /usr/lib/android-sdk/build-tools/debian/dx)
"$DX" --dex --output="$W/apk/classes.dex" "$W/classes"
aapt package -f -M "$W/AndroidManifest.xml" -S android/res -A "$W/apk/assets" -I "$SDK" -F "$W/unsigned.apk"
(cd "$W/apk" && aapt add "$W/unsigned.apk" classes.dex > /dev/null)
zipalign -f -p 4 "$W/unsigned.apk" "$W/aligned.apk"

if [ ! -f "$KS" ]; then
  mkdir -p "$(dirname "$KS")"
  keytool -genkeypair -keystore "$KS" -storepass "$PASS" -keypass "$PASS" -alias aoc -keyalg RSA \
    -keysize 3072 -validity 10000 -dname "CN=Ages of Command" > /dev/null 2>&1
  echo "created signing key $KS (back it up: updates must be signed with it)"
fi
APK=$OUT/AgesOfCommand-$V-android.apk
apksigner sign --v4-signing-enabled false --ks "$KS" --ks-pass "pass:$PASS" --ks-key-alias aoc --min-sdk-version 24 --out "$APK" "$W/aligned.apk"
apksigner verify "$APK"
rm -rf "$W"
ls -la "$APK"
