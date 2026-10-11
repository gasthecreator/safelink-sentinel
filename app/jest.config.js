module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/__tests__/**/*.test.js"],
  transform: {
    "^.+\\.js$": [
      "babel-jest",
      { presets: [require.resolve("@react-native/babel-preset")], configFile: false },
    ],
  },
  transformIgnorePatterns: ["/node_modules/"],
};
