// Mock React Native Reanimated to avoid loading Native Worklets
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  
  const mockAnimated = {
    View: View,
    Text: require('react-native').Text,
    Image: require('react-native').Image,
    ScrollView: require('react-native').ScrollView,
  };

  return {
    ...mockAnimated,
    default: mockAnimated,
    useSharedValue: (val) => ({ value: val }),
    useAnimatedStyle: (cb) => {
      return {};
    },
    cancelAnimation: jest.fn(),
    withRepeat: (anim) => anim,
    withTiming: (toValue) => toValue,
  };
});

// Mock Expo Haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
  },
}));

// Mock Expo Keep Awake
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn(),
}));

// Mock Expo Screen Orientation
jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn().mockResolvedValue(undefined),
  unlockAsync: jest.fn().mockResolvedValue(undefined),
  OrientationLock: {
    LANDSCAPE: 'LANDSCAPE',
  },
}));

// Mock React Native BLE Manager
jest.mock('react-native-ble-manager', () => ({
  default: {
    start: jest.fn().mockResolvedValue(undefined),
    scan: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    retrieveServices: jest.fn().mockResolvedValue(undefined),
    requestMTU: jest.fn().mockResolvedValue(undefined),
    readRSSI: jest.fn().mockResolvedValue(-65),
    writeWithoutResponse: jest.fn().mockResolvedValue(undefined),
  },
}), { virtual: true });
