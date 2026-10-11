#!/usr/bin/env sh
# Gradle Wrapper launcher for Berangkas.
set -eu
APP_HOME=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WRAPPER_JAR="$APP_HOME/gradle/wrapper/gradle-wrapper.jar"
if [ ! -f "$WRAPPER_JAR" ]; then
  mkdir -p "$APP_HOME/gradle/wrapper"
  echo "Gradle Wrapper JAR missing; downloading official Gradle 8.9 wrapper..."
  curl -fL --retry 3 \
    "https://raw.githubusercontent.com/gradle/gradle/v8.9.0/gradle/wrapper/gradle-wrapper.jar" \
    -o "$WRAPPER_JAR"
fi
exec java ${JAVA_OPTS:-} ${GRADLE_OPTS:-} -classpath "$WRAPPER_JAR" org.gradle.wrapper.GradleWrapperMain "$@"
