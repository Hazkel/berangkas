# Berangkas Android

## Build APK via GitHub Actions
1. Extract this ZIP.
2. Upload the contents of the `berangkas` directory to the root of a GitHub repository.
3. Open the repository's **Actions** tab and run **Android CI** (or push a commit).
4. When the workflow finishes, open the run and download the `berangkas-debug-apk` artifact.

The Gradle Wrapper launcher and `gradle/wrapper/gradle-wrapper.properties` are included. To keep this ZIP small, the official `gradle-wrapper.jar` is bootstrapped from the Gradle project's version-pinned v8.9.0 source by the launcher/workflow if it is absent. A network connection is required for that first bootstrap and for downloading the Gradle distribution.

Build configuration: Android Gradle Plugin 8.7.3, Gradle 8.9, JDK 17, compile SDK 35.
