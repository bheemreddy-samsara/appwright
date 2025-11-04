---
"appwright": minor
---

Add AWS Device Farm provider support for mobile testing

This release introduces comprehensive AWS Device Farm integration for mobile app testing, enabling teams to run tests on real devices in AWS's device cloud.

### Features
- **AWS Device Farm Provider**: Complete implementation with support for both Android and iOS testing
- **Automated App Upload**: Automatically uploads APK/IPA files to Device Farm during test setup
- **ARN Persistence**: Intelligently reuses uploaded builds across test runs to minimize upload time
- **Remote Session Management**: Creates and manages Device Farm remote access sessions
- **Video Recording**: Automatic video capture of test sessions with download capability
- **Flexible Configuration**: Support for custom capabilities, interaction modes, and session settings

### Technical Details
- Added comprehensive test suite with 15 tests covering all functionality
- Implemented proper async cleanup callbacks for resource management
- Enhanced error handling with descriptive error messages
- Added support for AWS region configuration
- Improved WebDriver connection handling with query parameter support

### Configuration Example
```typescript
export default defineConfig({
  use: {
    platform: Platform.ANDROID,
    buildPath: "./app.apk",
    device: {
      provider: "aws-device-farm",
      projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
      deviceArn: "arn:aws:devicefarm:us-west-2::device:789",
      region: "us-west-2",
      sessionName: "My Test Session",
      remoteRecordEnabled: true,
    },
  },
});
```

This provider enables teams to leverage AWS Device Farm's extensive device library for comprehensive mobile testing without maintaining physical device labs.