# iOS App Settings (BrowserStack)

Configure iOS app settings and permissions when testing on BrowserStack devices.

## Quick Start: Location Permissions by Default

Configure location permissions in `appwright.config.ts` so all tests have location access:

```typescript
import { defineConfig, Platform } from "@samsara-dev/appwright";

export default defineConfig({
  projects: [{
    name: "ios",
    use: {
      platform: Platform.IOS,
      device: {
        provider: "browserstack",
        name: "iPhone 16 Pro",
        osVersion: "18",
        updateAppSettings: {
          "Permission Settings": {
            Location: {
              "ALLOW LOCATION ACCESS": "Always",
              "Precise Location": "ON"
            }
          }
        }
      },
      buildPath: "bs://<app-id>",
    }
  }]
});
```

With this configuration, all tests will start with location permissions granted - no setup code needed!

## Configuration Options

### 1. Config-Based Settings (Recommended)

Set default permissions and settings that apply to all tests:

```typescript
// appwright.config.ts
device: {
  provider: "browserstack",
  name: "iPhone 16 Pro",
  osVersion: "18",
  updateAppSettings: {
    // iOS Permissions
    "Permission Settings": {
      Location: {
        "ALLOW LOCATION ACCESS": "Always",
        "Precise Location": "ON"
      },
      Camera: "Allow",
      Photos: "All Photos",
      Notifications: { "Allow Notifications": "ON" }
    },
    // Custom App Settings
    "Environment": "staging",
    "DarkMode": 1,
    "DebugMode": true
  }
}
```

### 2. Mid-Session Updates

Change settings during test execution (useful for testing permission flows):

```typescript
// Revoke permission to test error handling
await device.updatePermissionSettings({
  Location: { "ALLOW LOCATION ACCESS": "Never" }
});

// Grant permission to test feature
await device.updatePermissionSettings({
  Location: {
    "ALLOW LOCATION ACCESS": "Always",
    "Precise Location": "ON"
  }
});
```

### 3. Environment Variable Override

Override settings for CI/CD without changing code:

```bash
export APPWRIGHT_BS_UPDATE_APP_SETTINGS_JSON='{
  "Permission Settings": {
    "Location": {
      "ALLOW LOCATION ACCESS": "Always",
      "Precise Location": "ON"
    }
  }
}'
npm test
```

## Permission Settings Reference

| Permission | Valid Values |
|------------|-------------|
| **Location** | |
| `ALLOW LOCATION ACCESS` | `"Always"`, `"While Using the App"`, `"Never"` |
| `Precise Location` | `"ON"`, `"OFF"` |
| **Camera** | `"Allow"`, `"Deny"` |
| **Contacts** | `"Allow"`, `"Deny"` |
| **Photos** | `"Add Photos Only"`, `"Selected Photos"`, `"All Photos"`, `"None"` |
| **Notifications** | `{ "Allow Notifications": "ON" \| "OFF" }` |
| **Language** | Any valid language code (e.g., `"en"`, `"es"`, `"fr"`) |

## Examples

### Test with Pre-configured Location

```typescript
// Location already granted via config - test runs immediately
test("use location features", async ({ device }) => {
  await device.tap({ selector: { text: "Find Nearby" } });

  // Location is already available - no permission code needed!
  const screen = await device.screenshot();
  await expect(screen).toContain("Nearby Places");
});
```

### Test Permission Flow

```typescript
test("test permission denial and recovery", async ({ device }) => {
  // Start with location (from config)

  // Revoke permission to test error state
  await device.updatePermissionSettings({
    Location: { "ALLOW LOCATION ACCESS": "Never" }
  });

  await device.tap({ selector: { text: "Find Nearby" } });
  await expect(device.screenshot()).toContain("Location Required");

  // Grant permission to test recovery
  await device.updatePermissionSettings({
    Location: {
      "ALLOW LOCATION ACCESS": "Always",
      "Precise Location": "ON"
    }
  });

  await device.tap({ selector: { text: "Find Nearby" } });
  await expect(device.screenshot()).toContain("Nearby Places");
});
```

### Update Custom Settings Bundle

```typescript
// Update custom app settings mid-session
await device.updateAppSettings({
  "Environment": "production",
  "DarkMode": 1,
  "Child Settings": {
    "Child Setting 1": "abc"
  }
});
```

## Best Practices

1. **Use Config for Defaults**: Set permissions in `appwright.config.ts` for cleaner tests
2. **Override When Needed**: Use mid-session updates only for permission flow testing
3. **Environment Variables for CI**: Use `APPWRIGHT_BS_UPDATE_APP_SETTINGS_JSON` for CI/CD
4. **Document Your Settings**: Comment your config to explain why certain permissions are needed

## Requirements

- **Platform**: iOS only
- **Provider**: BrowserStack only
- **iOS Version**: iOS 13+
- **Limitations**: Sliders and groups cannot be configured via API

## See Also

- [BrowserStack iOS App Settings Documentation](https://www.browserstack.com/docs/app-automate/appium/advanced-features/ios-app-settings)
- [Configuration Guide](./config.md)

