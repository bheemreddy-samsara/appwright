# Configuration

Appwright provides a set of configuration options that you can use to customize 
the test environment and thus the behavior of the tests.

## Device Providers

Device providers make Appium compatible mobile devices available to Appwright. These
providers are supported:

- `local-device`
- `emulator`
- `browserstack`
- `lambdatest`
- `aws-device-farm`

### BrowserStack

BrowserStack [App Automate](https://www.browserstack.com/app-automate) can be used to provide
remote devices to Appwright.

These environment variables are required for the BrowserStack

- BROWSERSTACK_USERNAME
- BROWSERSTACK_ACCESS_KEY

BrowserStack also requires `name` and `osVersion` of the device to be set in the projects in appwright config file.
If BrowserStack has not enabled Appium 3 for your account yet, set `appiumVersion` in the device config (or `BROWSERSTACK_APPIUM_VERSION` env var) to request the correct server version.

### LambdaTest

LambdaTest [Real Device Cloud](https://www.lambdatest.com/support/docs/app-testing-on-real-devices/) can be used to provide
remote devices to Appwright.

These environment variables are required for the LambdaTest

- LAMBDATEST_USERNAME
- LAMBDATEST_ACCESS_KEY

LambdaTest also requires `name` and `osVersion` of the device to be set in the projects in appwright config file.
If LambdaTest has not enabled Appium 3 for your account yet, set `appiumVersion` in the device config (or `LAMBDATEST_APPIUM_VERSION` env var) to request the correct server version.

### AWS Device Farm

AWS Device Farm can provide remote iOS and Android devices using [remote access sessions](https://docs.aws.amazon.com/devicefarm/latest/developerguide/remote-access.html).

Set these environment variables before running tests:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN` (if you are using temporary credentials)
- `AWS_REGION` (defaults to `us-west-2` if omitted)

Sample configuration:

```ts
defineConfig({
  projects: [
    {
      name: "ios-aws",
      use: {
        platform: "ios",
        appBundleId: "com.example.myapp",
        buildPath: "./build/MyApp.ipa",
        device: {
          provider: "aws-device-farm",
          projectArn: "arn:aws:devicefarm:us-west-2:123456789012:project:abc123",
          deviceArn:
            "arn:aws:devicefarm:us-west-2::device:Apple:iPhone.15:16.4.1",
          interactionMode: "VIDEO_ONLY",
          sessionName: "e2e smoke",
        },
      },
    },
  ],
});
```

If you already have an uploaded application in Device Farm, supply `appArn` to skip uploading the build during `globalSetup`. For Android tests, provide `appPackage` and `appActivity` when Device Farm should launch a specific activity. Any custom Appium capabilities can be added through `additionalCapabilities`.

Video recordings are downloaded automatically when `remoteRecordEnabled` is `true` (the default). Set it to `false` if you prefer to skip video capture.

### Android Emulator

To run tests on the Android emulator, ensure the following installations are available. If not, follow these steps:

1. **Install Android Studio**: If not installed, download and install it from [here](https://developer.android.com/studio).
2. **Set Android SDK location**: Open Android Studio, copy the Android SDK location, and set the `ANDROID_HOME` environment variable to the same path.
3. **Check Java Installation**: Verify if Java is installed by running `java -version`. If it's not installed:
   - Install Java using Homebrew: `brew install java`.
   - After installation, run the symlink command provided at the end of the installation process.


To check for available emulators, run the following command:

```sh
$ANDROID_HOME/emulator/emulator --list-avds
```

### iOS Simulator

To run tests on the iOS Simulator, ensure the following installations are available. If not, follow these steps:

1. **Install Xcode**: If not installed, download and install it from [here](https://developer.apple.com/xcode/).
2. **Download iOS Simulator**: While installing Xcode, you will be prompted to select the platform to develop for. Ensure that iOS is selected.

To check for available iOS simulators, run the following command:

```sh
xcrun simctl list
```
